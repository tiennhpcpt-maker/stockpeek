"""
stockPeek - server nội bộ lấy giá cổ phiếu (VPS data feed) và tin tức (RSS)
Chạy: python3 server.py
Mở trình duyệt: http://127.0.0.1:8787
"""
import base64
import difflib
import hashlib
import hmac
import html
import json
import os
import re
import secrets
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs, urlencode, quote

PORT = int(os.environ.get("PORT", 8787))
HOST = "0.0.0.0" if os.environ.get("PORT") else "127.0.0.1"
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PUBLIC_DIR = os.path.join(BASE_DIR, "public")

DEFAULT_TICKERS = ["VIC", "VNM", "FPT", "VCB", "HPG"]

DEFAULT_SOURCES = [
    {"name": "24hMoney", "url": "https://24hmoney.vn/rss/chung-khoan.rss"},
    {"name": "VnEconomy", "url": "https://vneconomy.vn/thi-truong-chung-khoan.rss"},
]

MAX_SOURCES = 15
NEWS_CACHE_TTL = 180  # 3 phút
_news_cache = {}  # key: tuple(sorted urls) -> {"data":[...], "ts": float}

# Danh sách nguồn tin được lưu chung trong file sources.json của chính repo GitHub
# (qua GitHub Contents API), để mọi thiết bị (điện thoại, máy tính...) đều thấy
# cùng một danh sách, và không bị mất khi server khởi động lại (đĩa của Render
# free bị xoá mỗi lần restart, nhưng dữ liệu trong git thì không).
GITHUB_TOKEN = os.environ.get("GITHUB_TOKEN", "")
GITHUB_REPO = os.environ.get("GITHUB_REPO", "tiennhpcpt-maker/stockpeek")
# Repo RIÊNG TƯ khác với repo code công khai ở trên — chỉ dùng để lưu tài khoản
# người dùng (email, mật khẩu đã băm, danh mục/nguồn riêng). Tuyệt đối không
# được lưu các thông tin này trong GITHUB_REPO vì repo đó là Public.
GITHUB_USERS_REPO = os.environ.get("GITHUB_USERS_REPO", "tiennhpcpt-maker/stockpeek-users")
SOURCES_PATH = "sources.json"
SECTOR_ANALYSIS_PATH = "sector_analysis.json"
MARKET_OVERVIEW_PATH = "market_overview.json"
USERS_PATH = "users.json"
GITHUB_FILE_CACHE_TTL = 20  # giây

_github_file_cache = {}  # (repo, path) -> {"data":..., "sha":..., "ts": float}


def _github_request(method, url, body=None):
    headers = {"User-Agent": "stockPeek", "Accept": "application/vnd.github+json"}
    if GITHUB_TOKEN:
        headers["Authorization"] = f"Bearer {GITHUB_TOKEN}"
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read())


def load_github_file(path, default, force=False, repo=None):
    repo = repo or GITHUB_REPO
    cache_key = (repo, path)
    now = time.time()
    if not force:
        cached = _github_file_cache.get(cache_key)
        if cached and now - cached["ts"] < GITHUB_FILE_CACHE_TTL:
            return cached["data"], cached["sha"]

    url = f"https://api.github.com/repos/{repo}/contents/{path}"
    try:
        resp = _github_request("GET", url)
        content = base64.b64decode(resp["content"]).decode("utf-8")
        data = json.loads(content)
        sha = resp["sha"]
    except urllib.error.HTTPError as e:
        if e.code == 404:
            data = default
            sha = None
        else:
            raise

    _github_file_cache[cache_key] = {"data": data, "sha": sha, "ts": now}
    return data, sha


def _put_github_file(path, data, sha, message, repo=None):
    repo = repo or GITHUB_REPO
    url = f"https://api.github.com/repos/{repo}/contents/{path}"
    content_b64 = base64.b64encode(
        json.dumps(data, ensure_ascii=False, indent=2).encode("utf-8")
    ).decode("ascii")
    body = {"message": message, "content": content_b64}
    if sha:
        body["sha"] = sha
    resp = _github_request("PUT", url, body)
    _github_file_cache[(repo, path)] = {"data": data, "sha": resp["content"]["sha"], "ts": time.time()}


def update_github_file(path, default, mutate_fn, message, max_retries=3, repo=None):
    """Đọc file mới nhất, áp dụng mutate_fn(data) -> data_moi, rồi ghi lên GitHub.
    Nếu có ai khác ghi đè đồng thời (409 conflict), tự động đọc lại bản mới nhất
    và thử lại, tránh mất dữ liệu người dùng vừa thêm."""
    if not GITHUB_TOKEN:
        raise RuntimeError("Server chưa cấu hình GITHUB_TOKEN nên không thể lưu dữ liệu")
    repo = repo or GITHUB_REPO
    last_err = None
    for attempt in range(max_retries):
        data, sha = load_github_file(path, default, force=True, repo=repo)
        new_data = mutate_fn(data)
        try:
            _put_github_file(path, new_data, sha, message, repo=repo)
            return new_data
        except urllib.error.HTTPError as e:
            last_err = e
            if e.code == 409:
                continue
            raise
    raise RuntimeError(f"Không thể lưu do xung đột ghi liên tục: {last_err}")


def load_sources():
    data, sha = load_github_file(SOURCES_PATH, [dict(s) for s in DEFAULT_SOURCES])
    if not isinstance(data, list):
        data = [dict(s) for s in DEFAULT_SOURCES]
    return data, sha


def add_source_entry(name, url, lang="vi"):
    def mutate(sources):
        if not isinstance(sources, list):
            sources = [dict(s) for s in DEFAULT_SOURCES]
        if any(s.get("name", "").lower() == name.lower() for s in sources):
            raise ValueError("DUP")
        if len(sources) >= MAX_SOURCES:
            raise ValueError("MAX")
        entry = {"name": name, "url": url}
        if lang != "vi":
            entry["lang"] = lang
        return sources + [entry]

    return update_github_file(SOURCES_PATH, [dict(s) for s in DEFAULT_SOURCES], mutate, "Cập nhật nguồn tin (stockPeek)")


def remove_source_entry(name):
    def mutate(sources):
        if not isinstance(sources, list):
            sources = [dict(s) for s in DEFAULT_SOURCES]
        return [s for s in sources if s.get("name") != name]

    return update_github_file(SOURCES_PATH, [dict(s) for s in DEFAULT_SOURCES], mutate, "Cập nhật nguồn tin (stockPeek)")


def load_sector_analysis():
    data, _ = load_github_file(SECTOR_ANALYSIS_PATH, None)
    return data


def load_market_overview():
    data, _ = load_github_file(MARKET_OVERVIEW_PATH, None)
    return data


# ===================== Đăng nhập / tài khoản =====================
# Mật khẩu KHÔNG bao giờ lưu dạng thường — chỉ lưu salt + hash (PBKDF2-SHA256).
# Toàn bộ dữ liệu tài khoản (email, hash mật khẩu, danh mục/nguồn riêng) nằm
# trong GITHUB_USERS_REPO (repo riêng tư), tách biệt hoàn toàn với repo code
# công khai.
SESSION_SECRET = os.environ.get("SESSION_SECRET", "")
SESSION_MAX_AGE = 30 * 86400  # 30 ngày

GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET", "")

PBKDF2_ITERATIONS = 200_000


def hash_password(password, salt_hex=None):
    salt_hex = salt_hex or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), bytes.fromhex(salt_hex), PBKDF2_ITERATIONS
    )
    return salt_hex, digest.hex()


def verify_password(password, salt_hex, expected_hash_hex):
    _, computed = hash_password(password, salt_hex)
    return hmac.compare_digest(computed, expected_hash_hex)


def _b64url_encode(raw_bytes):
    return base64.urlsafe_b64encode(raw_bytes).decode("ascii").rstrip("=")


def _b64url_decode(s):
    padded = s + "=" * (-len(s) % 4)
    return base64.urlsafe_b64decode(padded.encode("ascii"))


def create_session_token(user_id):
    if not SESSION_SECRET:
        raise RuntimeError("Server chưa cấu hình SESSION_SECRET")
    payload = json.dumps({"uid": user_id, "exp": int(time.time()) + SESSION_MAX_AGE})
    payload_b64 = _b64url_encode(payload.encode("utf-8"))
    sig = hmac.new(SESSION_SECRET.encode("utf-8"), payload_b64.encode("ascii"), hashlib.sha256).hexdigest()
    return f"{payload_b64}.{sig}"


def verify_session_token(token):
    if not token or "." not in token or not SESSION_SECRET:
        return None
    payload_b64, _, sig = token.rpartition(".")
    expected = hmac.new(SESSION_SECRET.encode("utf-8"), payload_b64.encode("ascii"), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(sig, expected):
        return None
    try:
        payload = json.loads(_b64url_decode(payload_b64))
    except Exception:
        return None
    if payload.get("exp", 0) < time.time():
        return None
    return payload.get("uid")


def _public_user(user):
    """Trả về thông tin user an toàn để gửi cho client (không có mật khẩu)."""
    if not user:
        return None
    return {
        "id": user.get("id"),
        "email": user.get("email"),
        "name": user.get("name"),
        "provider": user.get("provider"),
    }


def load_users():
    data, _ = load_github_file(USERS_PATH, {"users": []}, repo=GITHUB_USERS_REPO)
    if not isinstance(data, dict) or not isinstance(data.get("users"), list):
        data = {"users": []}
    return data["users"]


def find_user_by_email(email):
    email = (email or "").lower()
    for u in load_users():
        if (u.get("email") or "").lower() == email:
            return u
    return None


def find_user_by_google_id(google_id):
    for u in load_users():
        if u.get("google_id") == google_id:
            return u
    return None


def find_user_by_id(user_id):
    for u in load_users():
        if u.get("id") == user_id:
            return u
    return None


def create_local_user(email, password, name):
    if find_user_by_email(email):
        raise ValueError("EMAIL_EXISTS")
    if len(password) < 6:
        raise ValueError("WEAK_PASSWORD")

    salt_hex, pwd_hash = hash_password(password)
    result = {}

    def mutate(data):
        if not isinstance(data, dict) or not isinstance(data.get("users"), list):
            data = {"users": []}
        users = data["users"]
        if any((u.get("email") or "").lower() == email.lower() for u in users):
            raise ValueError("EMAIL_EXISTS")
        new_user = {
            "id": secrets.token_hex(12),
            "email": email,
            "name": name or email.split("@")[0],
            "password_hash": pwd_hash,
            "salt": salt_hex,
            "provider": "local",
            "google_id": None,
            "watchlist": list(DEFAULT_TICKERS),
            "sources": [dict(s) for s in DEFAULT_SOURCES],
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        users.append(new_user)
        result["user"] = new_user
        return {"users": users}

    update_github_file(USERS_PATH, {"users": []}, mutate, "Tao tai khoan moi", repo=GITHUB_USERS_REPO)
    return result["user"]


def find_or_create_google_user(google_id, email, name):
    existing = find_user_by_google_id(google_id)
    if existing:
        return existing
    existing_by_email = find_user_by_email(email)
    if existing_by_email:
        # Tài khoản email này đã tồn tại (đăng ký thường) -> liên kết thêm Google.
        return update_user_data(existing_by_email["id"], lambda u: {**u, "google_id": google_id})

    result = {}

    def mutate(data):
        if not isinstance(data, dict) or not isinstance(data.get("users"), list):
            data = {"users": []}
        users = data["users"]
        if any(u.get("google_id") == google_id for u in users):
            result["user"] = next(u for u in users if u.get("google_id") == google_id)
            return data
        new_user = {
            "id": secrets.token_hex(12),
            "email": email,
            "name": name or (email.split("@")[0] if email else "Người dùng Google"),
            "password_hash": None,
            "salt": None,
            "provider": "google",
            "google_id": google_id,
            "watchlist": list(DEFAULT_TICKERS),
            "sources": [dict(s) for s in DEFAULT_SOURCES],
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        users.append(new_user)
        result["user"] = new_user
        return {"users": users}

    update_github_file(USERS_PATH, {"users": []}, mutate, "Dang nhap Google - tao tai khoan", repo=GITHUB_USERS_REPO)
    return result["user"]


def update_user_data(user_id, mutate_user_fn):
    """mutate_user_fn(user_dict) -> user_dict_moi. Ghi lại vào users.json, tự
    thử lại nếu xung đột ghi đồng thời."""
    result = {}

    def mutate(data):
        if not isinstance(data, dict) or not isinstance(data.get("users"), list):
            data = {"users": []}
        users = data["users"]
        found = False
        new_users = []
        for u in users:
            if u.get("id") == user_id:
                u = mutate_user_fn(dict(u))
                found = True
            new_users.append(u)
        if not found:
            raise ValueError("USER_NOT_FOUND")
        result["user"] = next(u for u in new_users if u.get("id") == user_id)
        return {"users": new_users}

    update_github_file(USERS_PATH, {"users": []}, mutate, "Cap nhat du lieu nguoi dung", repo=GITHUB_USERS_REPO)
    return result["user"]


def google_oauth_redirect_uri(handler):
    host = handler.headers.get("Host", "localhost")
    scheme = "https" if os.environ.get("PORT") else "http"
    return f"{scheme}://{host}/auth/google/callback"


# ===================== Danh mục / nguồn tin riêng theo tài khoản =====================

def add_user_source(user_id, name, url, lang="vi"):
    def mutate(user):
        sources = user.get("sources") or []
        if any(s.get("name", "").lower() == name.lower() for s in sources):
            raise ValueError("DUP")
        if len(sources) >= MAX_SOURCES:
            raise ValueError("MAX")
        entry = {"name": name, "url": url}
        if lang != "vi":
            entry["lang"] = lang
        user["sources"] = sources + [entry]
        return user

    updated = update_user_data(user_id, mutate)
    return updated["sources"]


def remove_user_source(user_id, name):
    def mutate(user):
        user["sources"] = [s for s in (user.get("sources") or []) if s.get("name") != name]
        return user

    updated = update_user_data(user_id, mutate)
    return updated["sources"]


def add_user_ticker(user_id, ticker):
    def mutate(user):
        watchlist = user.get("watchlist") or []
        if ticker not in watchlist:
            watchlist = watchlist + [ticker]
        user["watchlist"] = watchlist
        return user

    updated = update_user_data(user_id, mutate)
    return updated["watchlist"]


def remove_user_ticker(user_id, ticker):
    def mutate(user):
        user["watchlist"] = [t for t in (user.get("watchlist") or []) if t != ticker]
        return user

    updated = update_user_data(user_id, mutate)
    return updated["watchlist"]


def validate_feed(url):
    raw = fetch_url(url, timeout=8)
    root = ET.fromstring(raw)
    if len(root.findall(".//item")) == 0:
        raise ValueError("Không tìm thấy bài viết nào — có thể URL không phải định dạng RSS")


def fetch_url(url, timeout=8):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def get_quotes(tickers):
    key = ",".join(tickers)
    url = f"https://bgapidatafeed.vps.com.vn/getliststockdata/{key}"
    raw = fetch_url(url)
    data = json.loads(raw)
    out = []
    for item in data:
        sym = item.get("sym")
        try:
            last = float(item.get("lastPrice") or 0)
            ref = float(item.get("r") or 0)
            ceil_ = float(item.get("c") or 0)
            floor_ = float(item.get("f") or 0)
            high = float(item.get("highPrice") or 0)
            low = float(item.get("lowPrice") or 0)
            vol = int(float(item.get("lot") or 0))
        except (TypeError, ValueError):
            continue

        change = last - ref
        change_pct = (change / ref * 100) if ref else 0
        if ceil_ > 0 and last >= ceil_:
            status = "ceil"
        elif floor_ > 0 and last <= floor_:
            status = "floor"
        elif last > ref:
            status = "up"
        elif last < ref:
            status = "down"
        else:
            status = "ref"

        out.append({
            "ticker": sym,
            "last": round(last * 1000),
            "ref": round(ref * 1000),
            "change": round(change * 1000),
            "changePct": round(change_pct, 2),
            "high": round(high * 1000),
            "low": round(low * 1000),
            "volume": vol,
            "foreignBuyVol": item.get("fBVol"),
            "foreignSellVol": item.get("fSVolume"),
            "status": status,
        })
    return out


INDEX_CONFIGS = [
    {"name": "VN-INDEX", "slug": "vn-index", "chartSymbol": "VNINDEX"},
    {"name": "VN30-INDEX", "slug": "vn30-index", "chartSymbol": "VN30"},
    {"name": "HNX-INDEX", "slug": "hnx-index", "chartSymbol": "HNX"},
    {"name": "UPCOM", "slug": "upcom-index", "chartSymbol": "UPCOM"},
]
INDICES_CACHE_TTL = 30  # giây
_indices_cache = {"data": None, "ts": 0}


def _extract_num(pattern, text):
    m = re.search(pattern, text)
    return float(m.group(1)) if m else None


def _fetch_index_summary(slug):
    raw = fetch_url(f"https://24hmoney.vn/indices/{slug}", timeout=10)
    text = raw.decode("utf-8", errors="ignore")
    idx = text.find("indicesDetail:{")
    segment = text[idx : idx + 1500] if idx != -1 else text

    prior = _extract_num(r"prior_market_index:([\d.]+)", segment)
    change = _extract_num(r"\bchange:(-?[\d.]+)", segment)
    change_pct = _extract_num(r"change_percent:(-?[\d.]+)", segment)
    acc_val = _extract_num(r"accumulated_val:([\d.]+)", segment)
    fbuy = _extract_num(r"foreign_today_buy_value:([\d.]+)", segment)
    fsell = _extract_num(r"foreign_today_sell_value:([\d.]+)", segment)

    if prior is None or change is None:
        raise ValueError("Không đọc được dữ liệu chỉ số")

    return {
        "value": round(prior + change, 2),
        "change": change,
        "changePct": change_pct,
        "tradingValue": acc_val,
        "foreignNet": round((fbuy or 0) - (fsell or 0), 2),
    }


def _fetch_index_series(chart_symbol):
    to_ts = int(time.time())
    from_ts = to_ts - 86400
    url = (
        f"https://dchart-api.vndirect.com.vn/dchart/history"
        f"?symbol={chart_symbol}&resolution=15&from={from_ts}&to={to_ts}"
    )
    raw = fetch_url(url, timeout=10)
    data = json.loads(raw)
    closes = data.get("c") or []
    # Giới hạn số điểm để đồ thị nhẹ và mượt
    if len(closes) > 60:
        step = len(closes) // 60
        closes = closes[::step]
    return closes


def get_market_indices():
    now = time.time()
    if _indices_cache["data"] is not None and now - _indices_cache["ts"] < INDICES_CACHE_TTL:
        return _indices_cache["data"]

    result = []
    for cfg in INDEX_CONFIGS:
        try:
            summary = _fetch_index_summary(cfg["slug"])
            try:
                summary["series"] = _fetch_index_series(cfg["chartSymbol"])
            except Exception:
                summary["series"] = []
            summary["name"] = cfg["name"]
            result.append(summary)
        except Exception as e:
            result.append({"name": cfg["name"], "error": str(e)})

    _indices_cache["data"] = result
    _indices_cache["ts"] = now
    return result


def strip_html(s):
    text = re.sub("<[^<]+?>", "", s or "")
    return html.unescape(text).strip()


def translate_to_vi(text):
    """Dịch văn bản sang tiếng Việt bằng endpoint dịch miễn phí của Google.
    Nếu lỗi (mạng, giới hạn truy vấn...) thì trả về nguyên văn gốc."""
    if not text:
        return text
    try:
        params = urlencode({"client": "gtx", "sl": "auto", "tl": "vi", "dt": "t", "q": text})
        url = f"https://translate.googleapis.com/translate_a/single?{params}"
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=6) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        return "".join(seg[0] for seg in data[0] if seg and seg[0])
    except Exception:
        return text


def _pub_ts(pub_date):
    try:
        return parsedate_to_datetime(pub_date).timestamp()
    except Exception:
        return 0


def _normalize_title(title):
    t = title.lower()
    t = re.sub(r"[^\w\s]", " ", t, flags=re.UNICODE)
    t = re.sub(r"\s+", " ", t).strip()
    return t


SAME_STORY_RATIO = 0.55


def cluster_news_items(items):
    """Gộp các tin có tiêu đề giống nhau (khả năng cùng 1 sự kiện do nhiều
    nguồn đưa tin) thành 1 nhóm, để hiển thị 1 thẻ kèm trích dẫn từng nguồn."""
    clusters = []  # [{"norm": str, "items": [...]}]
    for it in items:
        norm = _normalize_title(it["title"])
        best_cluster = None
        best_ratio = 0
        for c in clusters:
            ratio = difflib.SequenceMatcher(None, norm, c["norm"]).ratio()
            if ratio > best_ratio:
                best_ratio = ratio
                best_cluster = c
        if best_cluster and best_ratio >= SAME_STORY_RATIO:
            best_cluster["items"].append(it)
        else:
            clusters.append({"norm": norm, "items": [it]})

    merged = []
    for c in clusters:
        group = sorted(c["items"], key=lambda x: _pub_ts(x["pubDate"]), reverse=True)
        primary = max(group, key=lambda x: len(x.get("summary", "")))
        merged.append({
            "title": primary["title"],
            "summary": primary["summary"],
            "pubDate": group[0]["pubDate"],
            "sourceCount": len(group),
            "sources": [
                {"source": g["source"], "title": g["title"], "link": g["link"], "pubDate": g["pubDate"]}
                for g in group
            ],
        })
    merged.sort(key=lambda m: _pub_ts(m["pubDate"]), reverse=True)
    return merged


def get_news(sources=None):
    if sources is None:
        sources, _ = load_sources()
    key = tuple(sorted(s["url"] for s in sources))
    now = time.time()
    cached = _news_cache.get(key)
    if cached and now - cached["ts"] < NEWS_CACHE_TTL:
        return cached["data"]

    items = []
    errors = []
    for src in sources:
        source = src.get("name", "")
        url = src.get("url", "")
        is_foreign = src.get("lang", "vi") != "vi"
        # Nguồn tiếng nước ngoài cần dịch từng bài -> giới hạn số bài để tránh
        # quá nhiều lượt gọi API dịch miễn phí, làm chậm lần làm mới tin tức.
        limit = 6 if is_foreign else 12
        try:
            raw = fetch_url(url, timeout=8)
            root = ET.fromstring(raw)
            for item in root.findall(".//item")[:limit]:
                title = html.unescape((item.findtext("title") or "").strip())
                link = (item.findtext("link") or "").strip()
                pub = (item.findtext("pubDate") or "").strip()
                desc = strip_html(item.findtext("description") or "")[:220]
                if is_foreign:
                    title = translate_to_vi(title)
                    desc = translate_to_vi(desc)
                if title:
                    items.append({
                        "source": source,
                        "title": title,
                        "link": link,
                        "pubDate": pub,
                        "summary": desc,
                    })
        except Exception as e:
            errors.append({"source": source, "error": str(e)})

    merged = cluster_news_items(items)
    data = {"items": merged, "errors": errors}
    _news_cache[key] = {"data": data, "ts": now}
    if len(_news_cache) > 30:
        oldest = min(_news_cache, key=lambda k: _news_cache[k]["ts"])
        del _news_cache[oldest]
    return data


CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
}


class Handler(BaseHTTPRequestHandler):
    def _send_json(self, obj, status=200, set_cookie=None):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        if set_cookie:
            self.send_header("Set-Cookie", set_cookie)
        self.end_headers()
        self.wfile.write(body)

    def _session_cookie_header(self, token, max_age=SESSION_MAX_AGE):
        secure = " Secure;" if os.environ.get("PORT") else ""
        return f"session={token}; Path=/; HttpOnly;{secure} Max-Age={max_age}; SameSite=Lax"

    def _clear_cookie_header(self):
        return "session=; Path=/; HttpOnly; Max-Age=0; SameSite=Lax"

    def _current_user(self):
        cookie_header = self.headers.get("Cookie")
        if not cookie_header:
            return None
        c = SimpleCookie()
        try:
            c.load(cookie_header)
        except Exception:
            return None
        if "session" not in c:
            return None
        uid = verify_session_token(c["session"].value)
        if not uid:
            return None
        try:
            return find_user_by_id(uid)
        except Exception:
            return None

    def do_GET(self):
        parsed = urlparse(self.path)

        if parsed.path == "/api/quotes":
            qs = parse_qs(parsed.query)
            raw_tickers = qs.get("tickers", [",".join(DEFAULT_TICKERS)])[0]
            tickers = [t.strip().upper() for t in raw_tickers.split(",") if t.strip()]
            if not tickers:
                tickers = DEFAULT_TICKERS
            try:
                data = get_quotes(tickers)
                self._send_json({"ok": True, "data": data, "ts": time.time()})
            except Exception as e:
                self._send_json({"ok": False, "error": str(e)}, 502)
            return

        if parsed.path == "/api/indices":
            try:
                data = get_market_indices()
                self._send_json({"ok": True, "data": data, "ts": time.time()})
            except Exception as e:
                self._send_json({"ok": False, "error": str(e)}, 502)
            return

        if parsed.path == "/api/news":
            try:
                user = self._current_user()
                sources = user["sources"] if user else None
                data = get_news(sources)
                self._send_json({"ok": True, "data": data["items"], "errors": data["errors"]})
            except Exception as e:
                self._send_json({"ok": False, "error": str(e)}, 502)
            return

        if parsed.path == "/api/sources":
            try:
                user = self._current_user()
                if user:
                    self._send_json({"ok": True, "data": user.get("sources") or [], "personal": True})
                else:
                    data, _ = load_sources()
                    self._send_json({"ok": True, "data": data, "personal": False})
            except Exception as e:
                self._send_json({"ok": False, "error": str(e)}, 502)
            return

        if parsed.path == "/api/watchlist":
            try:
                user = self._current_user()
                if user:
                    self._send_json({"ok": True, "data": user.get("watchlist") or [], "personal": True})
                else:
                    self._send_json({"ok": True, "data": None, "personal": False})
            except Exception as e:
                self._send_json({"ok": False, "error": str(e)}, 502)
            return

        if parsed.path == "/api/auth/me":
            try:
                user = self._current_user()
                self._send_json({"ok": True, "data": _public_user(user)})
            except Exception as e:
                self._send_json({"ok": False, "error": str(e)}, 502)
            return

        if parsed.path == "/auth/google/login":
            if not GOOGLE_CLIENT_ID:
                self._send_json({"ok": False, "error": "Server chưa cấu hình đăng nhập Google"}, 500)
                return
            redirect_uri = google_oauth_redirect_uri(self)
            state = secrets.token_urlsafe(16)
            params = urlencode({
                "client_id": GOOGLE_CLIENT_ID,
                "redirect_uri": redirect_uri,
                "response_type": "code",
                "scope": "openid email profile",
                "state": state,
                "prompt": "select_account",
            })
            self.send_response(302)
            self.send_header("Location", f"https://accounts.google.com/o/oauth2/v2/auth?{params}")
            self.send_header(
                "Set-Cookie", f"oauth_state={state}; Path=/; HttpOnly; Max-Age=600; SameSite=Lax"
            )
            self.end_headers()
            return

        if parsed.path == "/auth/google/callback":
            self._handle_google_callback(parsed)
            return

        if parsed.path == "/api/sector-analysis":
            try:
                data = load_sector_analysis()
                if data is None:
                    self._send_json({"ok": False, "error": "Chưa có dữ liệu phân tích nhóm ngành"}, 404)
                    return
                self._send_json({"ok": True, "data": data})
            except Exception as e:
                self._send_json({"ok": False, "error": str(e)}, 502)
            return

        if parsed.path == "/api/market-overview":
            try:
                data = load_market_overview()
                if data is None:
                    self._send_json({"ok": False, "error": "Chưa có dữ liệu phân tích chung thị trường"}, 404)
                    return
                self._send_json({"ok": True, "data": data})
            except Exception as e:
                self._send_json({"ok": False, "error": str(e)}, 502)
            return

        self.serve_static(parsed.path)

    def _read_json_body(self):
        length = int(self.headers.get("Content-Length", 0) or 0)
        raw = self.rfile.read(length) if length else b""
        if not raw:
            return {}
        return json.loads(raw.decode("utf-8"))

    def do_POST(self):
        parsed = urlparse(self.path)

        if parsed.path == "/api/sources":
            try:
                body = self._read_json_body()
            except Exception:
                self._send_json({"ok": False, "error": "Dữ liệu gửi lên không hợp lệ"}, 400)
                return
            name = (body.get("name") or "").strip()
            url = (body.get("url") or "").strip()
            lang = "en" if body.get("foreign") else "vi"
            if not name or not url:
                self._send_json({"ok": False, "error": "Cần nhập cả tên nguồn và URL"}, 400)
                return
            try:
                validate_feed(url)
            except Exception as e:
                self._send_json({"ok": False, "error": f"Không lấy được RSS từ URL này: {e}"}, 400)
                return
            try:
                user = self._current_user()
                if user:
                    new_sources = add_user_source(user["id"], name, url, lang)
                else:
                    new_sources = add_source_entry(name, url, lang)
                _news_cache.clear()
                self._send_json({"ok": True, "data": new_sources})
            except ValueError as e:
                if str(e) == "DUP":
                    self._send_json({"ok": False, "error": "Tên nguồn này đã tồn tại"}, 400)
                elif str(e) == "MAX":
                    self._send_json({"ok": False, "error": f"Chỉ cho phép tối đa {MAX_SOURCES} nguồn"}, 400)
                else:
                    self._send_json({"ok": False, "error": str(e)}, 400)
            except Exception as e:
                self._send_json({"ok": False, "error": str(e)}, 502)
            return

        if parsed.path == "/api/watchlist":
            user = self._current_user()
            if not user:
                self._send_json({"ok": False, "error": "Cần đăng nhập để lưu danh mục riêng"}, 401)
                return
            try:
                body = self._read_json_body()
            except Exception:
                self._send_json({"ok": False, "error": "Dữ liệu gửi lên không hợp lệ"}, 400)
                return
            ticker = (body.get("ticker") or "").strip().upper()
            if not ticker:
                self._send_json({"ok": False, "error": "Thiếu mã cổ phiếu"}, 400)
                return
            try:
                new_list = add_user_ticker(user["id"], ticker)
                self._send_json({"ok": True, "data": new_list})
            except Exception as e:
                self._send_json({"ok": False, "error": str(e)}, 502)
            return

        if parsed.path == "/api/auth/register":
            try:
                body = self._read_json_body()
            except Exception:
                self._send_json({"ok": False, "error": "Dữ liệu gửi lên không hợp lệ"}, 400)
                return
            email = (body.get("email") or "").strip().lower()
            password = body.get("password") or ""
            name = (body.get("name") or "").strip()
            if not email or "@" not in email:
                self._send_json({"ok": False, "error": "Email không hợp lệ"}, 400)
                return
            try:
                user = create_local_user(email, password, name)
                token = create_session_token(user["id"])
                self._send_json(
                    {"ok": True, "data": _public_user(user)},
                    set_cookie=self._session_cookie_header(token),
                )
            except ValueError as e:
                if str(e) == "EMAIL_EXISTS":
                    self._send_json({"ok": False, "error": "Email này đã được đăng ký"}, 400)
                elif str(e) == "WEAK_PASSWORD":
                    self._send_json({"ok": False, "error": "Mật khẩu cần ít nhất 6 ký tự"}, 400)
                else:
                    self._send_json({"ok": False, "error": str(e)}, 400)
            except Exception as e:
                self._send_json({"ok": False, "error": str(e)}, 502)
            return

        if parsed.path == "/api/auth/login":
            try:
                body = self._read_json_body()
            except Exception:
                self._send_json({"ok": False, "error": "Dữ liệu gửi lên không hợp lệ"}, 400)
                return
            email = (body.get("email") or "").strip().lower()
            password = body.get("password") or ""
            try:
                user = find_user_by_email(email)
                if not user or user.get("provider") != "local" or not user.get("salt"):
                    self._send_json({"ok": False, "error": "Email hoặc mật khẩu không đúng"}, 401)
                    return
                if not verify_password(password, user["salt"], user["password_hash"]):
                    self._send_json({"ok": False, "error": "Email hoặc mật khẩu không đúng"}, 401)
                    return
                token = create_session_token(user["id"])
                self._send_json(
                    {"ok": True, "data": _public_user(user)},
                    set_cookie=self._session_cookie_header(token),
                )
            except Exception as e:
                self._send_json({"ok": False, "error": str(e)}, 502)
            return

        if parsed.path == "/api/auth/logout":
            self._send_json({"ok": True}, set_cookie=self._clear_cookie_header())
            return

        self.send_error(404)

    def do_DELETE(self):
        parsed = urlparse(self.path)

        if parsed.path == "/api/sources":
            qs = parse_qs(parsed.query)
            name = qs.get("name", [""])[0]
            try:
                user = self._current_user()
                if user:
                    new_sources = remove_user_source(user["id"], name)
                else:
                    new_sources = remove_source_entry(name)
                _news_cache.clear()
                self._send_json({"ok": True, "data": new_sources})
            except Exception as e:
                self._send_json({"ok": False, "error": str(e)}, 502)
            return

        if parsed.path == "/api/watchlist":
            user = self._current_user()
            if not user:
                self._send_json({"ok": False, "error": "Cần đăng nhập để lưu danh mục riêng"}, 401)
                return
            qs = parse_qs(parsed.query)
            ticker = qs.get("ticker", [""])[0].strip().upper()
            try:
                new_list = remove_user_ticker(user["id"], ticker)
                self._send_json({"ok": True, "data": new_list})
            except Exception as e:
                self._send_json({"ok": False, "error": str(e)}, 502)
            return

        self.send_error(404)

    def _handle_google_callback(self, parsed):
        qs = parse_qs(parsed.query)
        code = qs.get("code", [""])[0]
        error = qs.get("error", [""])[0]
        if error or not code:
            self._redirect_login_error(error or "missing_code")
            return
        try:
            redirect_uri = google_oauth_redirect_uri(self)
            token_body = urlencode({
                "code": code,
                "client_id": GOOGLE_CLIENT_ID,
                "client_secret": GOOGLE_CLIENT_SECRET,
                "redirect_uri": redirect_uri,
                "grant_type": "authorization_code",
            }).encode("utf-8")
            req = urllib.request.Request(
                "https://oauth2.googleapis.com/token", data=token_body, method="POST"
            )
            try:
                with urllib.request.urlopen(req, timeout=10) as resp:
                    token_resp = json.loads(resp.read())
            except urllib.error.HTTPError as e:
                err_body = e.read().decode("utf-8", errors="ignore")
                print(f"[google-oauth] token exchange failed: {e.code} {err_body}")
                self._redirect_login_error(f"token_exchange_{e.code}")
                return

            id_token = token_resp.get("id_token", "")
            if not id_token:
                print(f"[google-oauth] no id_token in response: {token_resp}")
                self._redirect_login_error("no_id_token")
                return
            payload_b64 = id_token.split(".")[1]
            payload = json.loads(_b64url_decode(payload_b64))
            google_id = payload.get("sub")
            email = payload.get("email", "")
            name = payload.get("name", "")

            if not google_id:
                self._redirect_login_error("no_sub")
                return

            user = find_or_create_google_user(google_id, email, name)
            session_token = create_session_token(user["id"])
            self.send_response(302)
            self.send_header("Location", "/")
            self.send_header("Set-Cookie", self._session_cookie_header(session_token))
            self.end_headers()
        except Exception as e:
            print(f"[google-oauth] unexpected error: {e!r}")
            self._redirect_login_error(f"exception_{type(e).__name__}")

    def _redirect_login_error(self, reason):
        self.send_response(302)
        self.send_header("Location", f"/?login_error=google&reason={quote(reason)}")
        self.end_headers()

    def serve_static(self, path):
        if path == "/":
            path = "/index.html"
        safe_path = os.path.normpath(path).lstrip("/")
        file_path = os.path.join(PUBLIC_DIR, safe_path)
        if not os.path.abspath(file_path).startswith(PUBLIC_DIR):
            self.send_error(403)
            return
        if not os.path.isfile(file_path):
            self.send_error(404)
            return
        ext = os.path.splitext(file_path)[1]
        with open(file_path, "rb") as f:
            body = f.read()
        self.send_response(200)
        self.send_header("Content-Type", CONTENT_TYPES.get(ext, "application/octet-stream"))
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        pass


if __name__ == "__main__":
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"stockPeek đang chạy tại http://{HOST}:{PORT}  (Ctrl+C để dừng)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
