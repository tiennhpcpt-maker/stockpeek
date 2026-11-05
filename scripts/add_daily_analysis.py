"""Thêm 1 bài phân tích do Claude viết vào daily_analysis.json (hiện ở tab "Báo cáo").

Dùng bởi scheduled task "stockpeek-phan-tich-ngay" trên máy cá nhân:
    python3 scripts/add_daily_analysis.py bai_phan_tich.json

File đầu vào là 1 object JSON:
{
  "date": "2026-11-05",            # bắt buộc, YYYY-MM-DD giờ VN
  "session": "morning|afternoon",  # tuỳ chọn
  "kind": "bulletin|weekly|monthly|company",  # tuỳ chọn, quyết định nhãn hiển thị
  "origin": "Bản tin chứng khoán sáng (email)",  # tuỳ chọn, ghi nguồn gốc bài
  "title": "...", "summary": "...",
  "key_findings": ["..."], "sections": [{"title": "...", "items": ["..."]}], "sectors": [{"name": "...", "view": "..."}],
  "tickers": [{"ticker": "HPG", "note": "..."}], "action_items": ["..."],
  "sources": ["24hMoney", ...], "disclaimer": "..."
}
Bài trùng (date, session, kind) sẽ được thay thế. Có thể truyền nhiều file một lúc. Giữ tối đa 60 bài mới nhất.
Không cần deploy lại Render — server đọc file này trực tiếp từ GitHub.
"""
import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PATH = os.path.join(ROOT, "daily_analysis.json")
KEEP = 60
VN_TZ = timezone(timedelta(hours=7))
DISCLAIMER = (
    "Bài phân tích do Claude tổng hợp từ tin tức công khai, chỉ mang tính tham khảo, "
    "không phải khuyến nghị đầu tư."
)


def main():
    if len(sys.argv) < 2:
        sys.exit("Cách dùng: python3 scripts/add_daily_analysis.py <file.json> [file2.json ...]")
    for path in sys.argv[1:]:
        with open(path, encoding="utf-8") as f:
            add_entry(json.load(f))


def add_entry(entry):
    if not isinstance(entry, dict) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(entry.get("date", ""))):
        sys.exit("Thiếu hoặc sai trường 'date' (YYYY-MM-DD)")
    if entry.get("session") not in (None, "morning", "afternoon"):
        sys.exit("'session' chỉ nhận morning hoặc afternoon")
    if entry.get("kind") not in (None, "bulletin", "weekly", "monthly", "company"):
        sys.exit("'kind' chỉ nhận bulletin, weekly, monthly hoặc company")
    for sec in entry.get("sections", []):
        if not isinstance(sec, dict) or not isinstance(sec.get("items", []), list):
            sys.exit("'sections' phải là danh sách {title, items[]}")
    for key in ("key_findings", "action_items", "sources", "sectors", "tickers"):
        if key in entry and not isinstance(entry[key], list):
            sys.exit(f"'{key}' phải là danh sách")
    entry.setdefault("generated_at", datetime.now(VN_TZ).strftime("%Y-%m-%dT%H:%M:%S+07:00"))
    entry.setdefault("disclaimer", DISCLAIMER)

    data = {"items": []}
    if os.path.exists(PATH):
        with open(PATH, encoding="utf-8") as f:
            data = json.load(f)
    items = [
        a for a in data.get("items", [])
        if not (
            a.get("date") == entry["date"]
            and a.get("session") == entry.get("session")
            and a.get("kind") == entry.get("kind")
        )
    ]
    items.append(entry)
    items.sort(key=lambda a: a.get("generated_at", ""), reverse=True)
    with open(PATH, "w", encoding="utf-8") as f:
        json.dump({"items": items[:KEEP]}, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(f"Đã ghi bài {entry['date']} ({entry.get('kind') or entry.get('session') or 'cả ngày'}) — tổng {len(items[:KEEP])} bài")


if __name__ == "__main__":
    main()
