"""
stockPeek - server nội bộ lấy giá cổ phiếu (VPS data feed) và tin tức (RSS)
Chạy: python3 server.py
Mở trình duyệt: http://127.0.0.1:8787
"""
import json
import os
import re
import time
import urllib.request
import xml.etree.ElementTree as ET
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

PORT = int(os.environ.get("PORT", 8787))
HOST = "0.0.0.0" if os.environ.get("PORT") else "127.0.0.1"
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PUBLIC_DIR = os.path.join(BASE_DIR, "public")
SOURCES_FILE = os.path.join(BASE_DIR, "sources.json")

DEFAULT_TICKERS = ["VIC", "VNM", "FPT", "VCB", "HPG"]

DEFAULT_SOURCES = [
    {"name": "24hMoney", "url": "https://24hmoney.vn/rss/chung-khoan.rss"},
    {"name": "VnEconomy", "url": "https://vneconomy.vn/thi-truong-chung-khoan.rss"},
]

_news_cache = {"data": None, "ts": 0}
NEWS_CACHE_TTL = 180  # 3 phút


def load_sources():
    if not os.path.isfile(SOURCES_FILE):
        save_sources(DEFAULT_SOURCES)
        return [dict(s) for s in DEFAULT_SOURCES]
    try:
        with open(SOURCES_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            if isinstance(data, list):
                return data
    except Exception:
        pass
    return [dict(s) for s in DEFAULT_SOURCES]


def save_sources(sources):
    with open(SOURCES_FILE, "w", encoding="utf-8") as f:
        json.dump(sources, f, ensure_ascii=False, indent=2)


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


def strip_html(s):
    return re.sub("<[^<]+?>", "", s or "").strip()


def get_news():
    now = time.time()
    if _news_cache["data"] and now - _news_cache["ts"] < NEWS_CACHE_TTL:
        return _news_cache["data"]

    items = []
    for src in load_sources():
        source = src.get("name", "")
        url = src.get("url", "")
        try:
            raw = fetch_url(url, timeout=8)
            root = ET.fromstring(raw)
            for item in root.findall(".//item")[:12]:
                title = (item.findtext("title") or "").strip()
                link = (item.findtext("link") or "").strip()
                pub = (item.findtext("pubDate") or "").strip()
                desc = strip_html(item.findtext("description") or "")[:220]
                if title:
                    items.append({
                        "source": source,
                        "title": title,
                        "link": link,
                        "pubDate": pub,
                        "summary": desc,
                    })
        except Exception as e:
            items.append({"source": source, "error": str(e), "title": "", "link": "", "pubDate": "", "summary": ""})

    _news_cache["data"] = items
    _news_cache["ts"] = now
    return items


CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
}


class Handler(BaseHTTPRequestHandler):
    def _send_json(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

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

        if parsed.path == "/api/news":
            try:
                data = get_news()
                self._send_json({"ok": True, "data": data})
            except Exception as e:
                self._send_json({"ok": False, "error": str(e)}, 502)
            return

        if parsed.path == "/api/sources":
            self._send_json({"ok": True, "data": load_sources()})
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
            if not name or not url:
                self._send_json({"ok": False, "error": "Cần nhập cả tên nguồn và URL"}, 400)
                return
            try:
                validate_feed(url)
            except Exception as e:
                self._send_json({"ok": False, "error": f"Không lấy được RSS từ URL này: {e}"}, 400)
                return
            sources = load_sources()
            if any(s.get("name", "").lower() == name.lower() for s in sources):
                self._send_json({"ok": False, "error": "Tên nguồn này đã tồn tại"}, 400)
                return
            sources.append({"name": name, "url": url})
            save_sources(sources)
            _news_cache["data"] = None
            self._send_json({"ok": True, "data": sources})
            return
        self.send_error(404)

    def do_DELETE(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/sources":
            qs = parse_qs(parsed.query)
            name = qs.get("name", [""])[0]
            sources = load_sources()
            new_sources = [s for s in sources if s.get("name") != name]
            save_sources(new_sources)
            _news_cache["data"] = None
            self._send_json({"ok": True, "data": new_sources})
            return
        self.send_error(404)

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
