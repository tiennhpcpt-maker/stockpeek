"""
Tu dong cap nhat market_overview.json bang so lieu chi so that (khong can AI/API tra phi).
Chay boi GitHub Actions (xem .github/workflows/update-market-overview.yml).

Lay du lieu tu 24hmoney.vn (giong logic server.py dang dung tren trang web),
roi tu viet lai phan tom tat theo mau cau dua tren so lieu that.
"""
import json
import os
import re
import sys
import urllib.request
from datetime import datetime, timedelta, timezone

VN_TZ = timezone(timedelta(hours=7))
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUTPUT_PATH = os.path.join(REPO_ROOT, "market_overview.json")

INDEX_CONFIGS = [
    {"name": "VN-INDEX", "slug": "vn-index"},
    {"name": "VN30-INDEX", "slug": "vn30-index"},
    {"name": "HNX-INDEX", "slug": "hnx-index"},
    {"name": "UPCOM", "slug": "upcom-index"},
]

DISCLAIMER = (
    "Đây là tổng hợp thông tin tham khảo từ tin tức và báo cáo phân tích thị trường, "
    "không phải khuyến nghị đầu tư. Nhà đầu tư cần tự nghiên cứu thêm và cân nhắc kỹ "
    "trước khi ra quyết định."
)


def fetch_url(url, timeout=15):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def extract_num(pattern, text):
    m = re.search(pattern, text)
    return float(m.group(1)) if m else None


def fetch_index_summary(slug):
    text = fetch_url(f"https://24hmoney.vn/indices/{slug}").decode("utf-8", errors="ignore")
    idx = text.find("indicesDetail:{")
    segment = text[idx: idx + 1500] if idx != -1 else text

    prior = extract_num(r"prior_market_index:([\d.]+)", segment)
    change = extract_num(r"\bchange:(-?[\d.]+)", segment)
    change_pct = extract_num(r"change_percent:(-?[\d.]+)", segment)
    acc_val = extract_num(r"accumulated_val:([\d.]+)", segment)
    fbuy = extract_num(r"foreign_today_buy_value:([\d.]+)", segment)
    fsell = extract_num(r"foreign_today_sell_value:([\d.]+)", segment)

    if prior is None or change is None:
        raise ValueError(f"Khong doc duoc du lieu chi so cho {slug}")

    return {
        "value": round(prior + change, 2),
        "change": change,
        "changePct": change_pct,
        "tradingValue": acc_val,
        "foreignNet": round((fbuy or 0) - (fsell or 0), 2),
    }


def fmt_vn(n, decimals=2):
    if n is None:
        return "—"
    s = f"{n:,.{decimals}f}"
    return s.replace(",", "X").replace(".", ",").replace("X", ".")


def magnitude_desc(change_pct):
    a = abs(change_pct or 0)
    if a >= 3:
        return "mạnh"
    if a >= 1:
        return "đáng kể"
    return "nhẹ"


def load_previous():
    if not os.path.isfile(OUTPUT_PATH):
        return None
    try:
        with open(OUTPUT_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def compute_streak(prev, current_sign):
    meta = (prev or {}).get("_meta") or {}
    prev_sign = meta.get("last_sign")
    prev_streak = meta.get("streak", 0)
    if prev_sign == current_sign and current_sign != 0:
        return prev_streak + 1
    return 1


def build_overview(indices, now_vn):
    vni = next(i for i in indices if i["name"] == "VN-INDEX")
    vn30 = next(i for i in indices if i["name"] == "VN30-INDEX")
    hnx = next(i for i in indices if i["name"] == "HNX-INDEX")
    upcom = next(i for i in indices if i["name"] == "UPCOM")

    sign = 1 if vni["change"] > 0 else (-1 if vni["change"] < 0 else 0)
    verb = "tăng" if sign > 0 else ("giảm" if sign < 0 else "đi ngang")
    mag = magnitude_desc(vni["changePct"])

    prev = load_previous()
    streak = compute_streak(prev, sign)
    streak_phrase = ""
    if streak >= 2:
        streak_phrase = f", đánh dấu phiên {verb} thứ {streak} liên tiếp"

    executive_summary = (
        f"VN-Index {verb} {mag} trong phiên hôm nay, {'tăng' if vni['change']>=0 else 'giảm'} "
        f"{fmt_vn(abs(vni['change']))} điểm ({fmt_vn(vni['changePct'])}%) lên {fmt_vn(vni['value'])} "
        f"điểm{streak_phrase}. Thanh khoản đạt {fmt_vn(vni['tradingValue'])} tỷ đồng, khối ngoại "
        f"{'mua ròng' if vni['foreignNet'] >= 0 else 'bán ròng'} {fmt_vn(abs(vni['foreignNet']))} tỷ đồng."
    )

    highlights = [
        f"VN30-Index {'tăng' if vn30['change']>=0 else 'giảm'} {fmt_vn(abs(vn30['change']))} điểm "
        f"({fmt_vn(vn30['changePct'])}%) lên {fmt_vn(vn30['value'])} điểm, thanh khoản {fmt_vn(vn30['tradingValue'])} tỷ đồng.",
        f"HNX-Index {'tăng' if hnx['change']>=0 else 'giảm'} {fmt_vn(abs(hnx['change']))} điểm "
        f"({fmt_vn(hnx['changePct'])}%) lên {fmt_vn(hnx['value'])} điểm; UPCOM {'tăng' if upcom['change']>=0 else 'giảm'} "
        f"{fmt_vn(abs(upcom['change']))} điểm lên {fmt_vn(upcom['value'])} điểm.",
        f"Khối ngoại trên VN30 {'mua ròng' if vn30['foreignNet'] >= 0 else 'bán ròng'} "
        f"{fmt_vn(abs(vn30['foreignNet']))} tỷ đồng trong phiên.",
    ]

    support = round((vni["value"] - abs(vni["change"]) * 1.5) / 10) * 10
    resistance = round((vni["value"] + abs(vni["change"])) / 10) * 10

    technical_outlook = {
        "trend": f"VN-Index đang trong xu hướng {verb} ngắn hạn{streak_phrase}.",
        "support": f"~{fmt_vn(support, 0)} điểm (ước tính tự động từ biến động phiên gần nhất)",
        "resistance": f"~{fmt_vn(resistance, 0)} điểm (ước tính tự động từ biến động phiên gần nhất)",
        "note": "Đây là ước tính tự động dựa trên số liệu phiên gần nhất, không thay thế phân tích kỹ thuật chuyên sâu.",
    }

    action_notes = [
        "Theo dõi diễn biến khối ngoại và thanh khoản trong các phiên tới để đánh giá độ bền của xu hướng.",
        "Đây là bản cập nhật tự động dựa trên số liệu thị trường thực; nên kết hợp thêm tin tức và báo cáo phân tích chuyên sâu trước khi ra quyết định.",
    ]

    return {
        "generated_at": now_vn.strftime("%Y-%m-%dT%H:%M:%S+07:00"),
        "executive_summary": executive_summary,
        "highlights": highlights,
        "technical_outlook": technical_outlook,
        "action_notes": action_notes,
        "disclaimer": DISCLAIMER,
        "_meta": {"last_sign": sign, "streak": streak, "source": "auto-github-actions"},
    }


def main():
    indices = []
    for cfg in INDEX_CONFIGS:
        summary = fetch_index_summary(cfg["slug"])
        summary["name"] = cfg["name"]
        indices.append(summary)

    now_vn = datetime.now(VN_TZ)
    overview = build_overview(indices, now_vn)

    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(overview, f, ensure_ascii=False, indent=2)
        f.write("\n")

    print("Da cap nhat market_overview.json luc", overview["generated_at"])


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"LOI: {e}", file=sys.stderr)
        sys.exit(1)
