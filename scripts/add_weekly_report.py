"""Thêm/cập nhật 1 báo cáo tuần vào weekly_reports.json (hiện ở tab "Báo cáo" → "Tuần").

    python3 scripts/add_weekly_report.py weekly_report_2026-W45.json [file khác...]

Đầu vào là 1 object JSON (schema_version 1) có tối thiểu:
  week_id "YYYY-Www", period {from,to,label}, generated_at, summary{headline,vnindex_close,
  vnindex_week_change, vnindex_week_pct, prev_week_close, foreign_net_week_bn{hose,all_markets},
  support, resistance}, days[], sector_flows[], watchlist[], outlook{base_case,risks,actions},
  data_quality[], sources[], disclaimer.
Tuần không có số liệu từng ngày (nhập lại từ file theo dõi) đặt "partial": true, bỏ 'days'.
Báo cáo trùng week_id sẽ bị thay thế. Giữ tối đa 26 tuần, mới nhất ở đầu.
Không cần deploy lại Render — server đọc file này trực tiếp từ GitHub.
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PATH = os.path.join(ROOT, "weekly_reports.json")
KEEP = 26
REQUIRED = ("week_id", "period", "summary", "sector_flows")


def validate(entry):
    for k in REQUIRED:
        if k not in entry:
            sys.exit(f"Thiếu trường bắt buộc '{k}'")
    if not re.fullmatch(r"\d{4}-W\d{2}", str(entry["week_id"])):
        sys.exit("'week_id' phải dạng 2026-W45")
    p = entry["period"]
    if not (isinstance(p, dict) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(p.get("from", ""))) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(p.get("to", "")))):
        sys.exit("'period' cần {from, to} dạng YYYY-MM-DD")
    days = entry.get("days") or []
    if not days and not entry.get("partial"):
        sys.exit("'days' phải không rỗng (tuần nhập từ nhật ký không có số liệu từng ngày thì đặt \"partial\": true)")
    for d in days:
        if not (d.get("date") and isinstance(d.get("vnindex"), dict) and d["vnindex"].get("close") is not None):
            sys.exit(f"Ngày thiếu 'date' hoặc 'vnindex.close': {d.get('date')}")
    for s in entry["sector_flows"]:
        if s.get("signal") not in (-1, 0, 1):
            sys.exit(f"sector_flows '{s.get('sector')}': 'signal' chỉ nhận -1, 0 hoặc 1")
    # Báo cáo công khai: không để lọt dữ liệu cá nhân/tài khoản
    blob = json.dumps(entry, ensure_ascii=False).lower()
    for bad in ("drive.google", "@gmail", "password", "token", "sao kê", "số tài khoản"):
        if bad in blob:
            sys.exit(f"Báo cáo chứa '{bad}' — không đưa vào file công khai")


def main(files):
    if not files:
        sys.exit(__doc__)
    try:
        with open(PATH, encoding="utf-8") as f:
            data = json.load(f)
    except FileNotFoundError:
        data = {"items": []}
    items = data.get("items") or []
    for fp in files:
        with open(fp, encoding="utf-8") as f:
            entry = json.load(f)
        validate(entry)
        items = [i for i in items if i.get("week_id") != entry["week_id"]]
        items.append(entry)
        print(f"Đã thêm {entry['week_id']} ({entry['period'].get('label', '')})")
    items.sort(key=lambda i: i["period"]["to"], reverse=True)
    data["items"] = items[:KEEP]
    with open(PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(f"weekly_reports.json: {len(data['items'])} tuần")


if __name__ == "__main__":
    main(sys.argv[1:])
