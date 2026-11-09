"""Đổi báo cáo tuần (weekly_reports.json) sang JSON cùng kiểu với file theo dõi
BaoCao_ChungKhoan_TheoDoi trên Drive (sheet Bao_Cao_Ngay, Co_Phieu_KN, Dong_Tien_Nganh)
để tác vụ "dòng tiền ngành + Excel" (skill phan-tich-tin-chung-khoan) đọc và ghi lại được.

    python3 scripts/weekly_to_sheet.py                 # tuần mới nhất, đọc file cục bộ
    python3 scripts/weekly_to_sheet.py 2026-W45        # tuần chỉ định
    python3 scripts/weekly_to_sheet.py --url           # đọc bản trên GitHub (máy không có repo)
    python3 scripts/weekly_to_sheet.py --accents       # giữ dấu tiếng Việt (mặc định bỏ dấu)

File Drive đang ghi THEO TUẦN: Bao_Cao_Ngay mỗi tuần 1 dòng, cột Ngày dạng
"02-06/11/2026 (tuần)"; Co_Phieu_KN và Dong_Tien_Nganh dùng "02-06/11/2026". Chữ trong sheet
hiện không dấu nên script cũng bỏ dấu mặc định. Dòng thiếu số liệu để "" (không ghi N/A).
Chỉ đọc, không ghi file nào (kể cả sheet).
"""
import json
import os
import unicodedata
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOCAL = os.path.join(ROOT, "weekly_reports.json")
RAW_URL = "https://raw.githubusercontent.com/tiennhpcpt-maker/stockpeek/main/weekly_reports.json"
STATUS = {1: "Tích cực (hút tiền)", 0: "Phân hóa", -1: "Tiêu cực (rút tiền)"}


def fold(text, keep):
    """Bỏ dấu tiếng Việt cho khớp chữ không dấu đang có trong sheet."""
    if keep or not isinstance(text, str):
        return text
    text = text.replace("đ", "d").replace("Đ", "D")
    return "".join(c for c in unicodedata.normalize("NFD", text) if unicodedata.category(c) != "Mn")


def convert(w, keep_accents=False):
    f = lambda t: fold(t, keep_accents)
    label = w["period"].get("label") or w["week_id"]
    S = w.get("summary") or {}
    wl = w.get("watchlist") or []
    by = lambda *sig: ", ".join(i["ticker"] for i in wl if i.get("signal") in sig)
    leaders = [s for s in w.get("sector_flows") or [] if s.get("signal") == 1]
    lead_txt = " + ".join(f"{s['sector']} ({', '.join((s.get('tickers') or [])[:5])})" for s in leaders)
    risk_tickers = by("RỦI RO NGẮN HẠN", "RỦI RO")
    week = {
        "ngay": f(f"{label} (tuần)"),
        "vn_index": blank(S.get("vnindex_close")),
        "thay_doi_pct": blank(S.get("vnindex_week_pct")),
        "thanh_khoan_ty": "",
        "nhom_dan_dat": f(lead_txt),
        "ma_kn_mua": f(by("MUA")),
        "ma_theo_doi": f(", ".join(x for x in (by("THEO DÕI", "ĐẦU CƠ"), f"rủi ro: {risk_tickers}" if risk_tickers else "") if x)),
        "khoi_ngoai_ty": blank((S.get("foreign_net_week_bn") or {}).get("all_markets")),
        "tin_hieu_kt": "",
        "tom_tat": f(S.get("headline", "")),
        "rui_ro": f("; ".join((w.get("outlook") or {}).get("risks") or [])),
        "nguon_tin": f(", ".join(w.get("sources") or [])),
    }
    flows = [{
        "ngay": f(label),
        "nhom": f(s["sector"]),
        "trang_thai": f(STATUS.get(s.get("signal"), s.get("status", ""))),
        "ma_tieu_bieu": ", ".join(s.get("tickers") or []),
        "ty_trong_pct": "",
        "du_bao": f(s.get("outlook", "")),
        "ghi_chu": f(s.get("evidence", "")),
    } for s in w.get("sector_flows") or []]
    picks = [{
        "ngay": f(label),
        "ma": i["ticker"],
        "nhom": f(i.get("sector", "")),
        "tin_hieu": f(i.get("signal", "")),
        "nguon": "Bao cao tuan stockPeek" if not keep_accents else "Báo cáo tuần stockPeek",
        "gia_tc": "",
        "gia_mt": "",
        "luan_diem": f(i.get("reason", "")),
        "ket_qua": "",
        "ghi_chu": "",
    } for i in wl]
    return {"tuan": w["week_id"], "bao_cao_ngay": [week], "dong_tien_nganh": flows, "co_phieu_kn": picks}


def blank(v):
    return "" if v is None else v


def main(argv):
    use_url = "--url" in argv
    args = [a for a in argv if not a.startswith("--")]
    if use_url:
        with urllib.request.urlopen(RAW_URL, timeout=20) as r:
            data = json.load(r)
    else:
        with open(LOCAL, encoding="utf-8") as f:
            data = json.load(f)
    items = data.get("items") or []
    if not items:
        sys.exit("weekly_reports.json chưa có báo cáo nào")
    w = next((i for i in items if i["week_id"] == args[0]), None) if args else items[0]
    if not w:
        sys.exit(f"Không có tuần {args[0]}")
    json.dump(convert(w, "--accents" in argv), sys.stdout, ensure_ascii=False, indent=2)
    print()


if __name__ == "__main__":
    main(sys.argv[1:])
