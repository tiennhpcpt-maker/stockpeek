"""Đăng báo cáo tuần lên web MỘT LỆNH và tự kiểm tra đã hiện trên trang thật chưa.

    python3 scripts/publish_weekly_report.py weekly_report_2026-W46.json   # đăng file chỉ định (ghi đè nếu trùng tuần)
    python3 scripts/publish_weekly_report.py --scan                        # tự tìm file mới trong ~/Claude/Inbox
    python3 scripts/publish_weekly_report.py --scan --dry-run              # chỉ kiểm tra, không ghi/commit/push

Các bước: kiểm tra schema → gộp vào weekly_reports.json → git pull --rebase → commit CHỈ file đó
→ push → hỏi API trang thật (/api/weekly-reports) tới khi thấy week_id mới (tối đa ~2 phút).
Chỉ đổi file dữ liệu nên KHÔNG cần Manual Deploy Render. Thoát mã 0 = đã lên web; khác 0 = có lỗi
(thông báo lỗi nói rõ bước nào). Chạy tự động từ run.sh của tác vụ stockpeek-phan-tich-ngay.
"""
import glob
import json
import os
import subprocess
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import add_weekly_report as aw  # noqa: E402

LIVE_API = "https://stockpeek.onrender.com/api/weekly-reports"
SCAN_DIRS = [os.path.expanduser("~/Claude/Inbox")]  # Downloads bị macOS chặn với tác vụ nền
PATTERN = "weekly_report_*.json"


def git(*args):
    r = subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit(f"[git {' '.join(args)}] lỗi: {(r.stderr or r.stdout).strip()}")
    return r.stdout


def known_weeks():
    try:
        with open(aw.PATH, encoding="utf-8") as f:
            return {i.get("week_id") for i in json.load(f).get("items", [])}
    except FileNotFoundError:
        return set()


def scan():
    have, found = known_weeks(), []
    for d in SCAN_DIRS:
        try:
            files = sorted(glob.glob(os.path.join(d, PATTERN)))
        except OSError as e:
            print(f"Không đọc được {d}: {e}")
            continue
        for fp in files:
            try:
                with open(fp, encoding="utf-8") as f:
                    wid = json.load(f).get("week_id")
            except (OSError, ValueError) as e:
                print(f"Bỏ qua {fp}: {e}")
                continue
            if wid and wid not in have:
                found.append(fp)
                have.add(wid)  # cùng tuần có ở 2 thư mục thì chỉ lấy file đầu
    return found


def verify_live(week_ids, timeout=120):
    deadline, seen = time.time() + timeout, set()
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(LIVE_API, timeout=30) as r:
                data = json.load(r)["data"]
            seen = {w["week_id"] for w in data["weeks"]}
            if set(week_ids) <= seen:
                return True
        except Exception as e:
            print(f"(chờ trang thật: {e})")
        time.sleep(10)
    return False


def main(argv):
    dry = "--dry-run" in argv
    files = [a for a in argv if not a.startswith("--")]
    if "--scan" in argv:
        files += scan()
    if not files:
        print("Không có báo cáo tuần mới để đăng.")
        return 0
    ids, good, bad = [], [], []
    for fp in files:
        try:
            with open(fp, encoding="utf-8") as f:
                entry = json.load(f)
            aw.validate(entry)  # sys.exit nếu sai
        except (SystemExit, OSError, ValueError) as e:
            bad.append(f"{os.path.basename(fp)}: {e}")  # file lỗi không chặn các file hợp lệ khác
            continue
        ids.append(entry["week_id"])
        good.append(fp)
    for b in bad:
        print("BỎ QUA file lỗi —", b)
    files = good
    if not files:
        return 1 if bad else 0
    print("Sẽ đăng:", ", ".join(ids))
    if dry:
        print("(dry-run: không ghi gì)")
        return 1 if bad else 0
    if git("status", "--porcelain", "weekly_reports.json").strip():
        sys.exit("weekly_reports.json đang có thay đổi chưa commit — xử lý trước rồi chạy lại")
    git("pull", "--rebase", "--autostash")
    aw.main(files)
    git("add", "weekly_reports.json")
    if not git("status", "--porcelain", "weekly_reports.json").strip():
        print("Không có thay đổi so với bản đang có.")
    else:
        git("commit", "-m", f"Báo cáo tuần {', '.join(ids)}")
        try:
            git("push")
        except SystemExit:
            git("pull", "--rebase", "--autostash")
            git("push")
    print("Đã push. Đang kiểm tra trên trang thật...")
    if verify_live(ids):
        print(f"ĐÃ LÊN WEB: {', '.join(ids)} (tab Báo cáo → Tuần)")
        return 1 if bad else 0
    sys.exit("Đã push nhưng sau 2 phút trang thật chưa trả tuần mới — kiểm tra Render (có thể đang khởi động lại) rồi chạy lại phần kiểm tra")


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
