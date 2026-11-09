# Báo cáo tuần

## Dữ liệu
- `weekly_reports.json` = `{"items": [báo cáo tuần, mới nhất ở đầu]}`, mỗi phần tử theo schema_version 1 (`week_id` "2026-W45", `period`, `summary`, `days[]`, `sector_flows[]`, `watchlist[]`, `outlook`, `data_quality[]`, `sources[]`, `disclaimer`). Giữ tối đa 26 tuần.
- Thêm/cập nhật 1 tuần: `python3 scripts/add_weekly_report.py <file.json>` (kiểm tra schema, thay bản cùng `week_id`, chặn từ khoá cá nhân như link Drive/email/token vì file công khai), rồi `git commit` + `git push`. **Không cần deploy Render** — server đọc file từ GitHub (cache 20s), có dự phòng RAM → file đi kèm bản deploy như `daily_analysis.json`.
- Số liệu lấy từ báo chí nên có chỗ lệch giữa các nguồn: ghi rõ trong `data_quality`, số suy ra từ phiên khác đánh `derived: true` (web hiện dấu `*`).

## Quy trình đăng một tuần mới (đọc trước khi trả lời "sao web chưa có")
**Tự động hoàn toàn** (không ai thả file):
1. Routine cloud "Cập nhật dòng tiền ngành + Excel tuần" (thứ Bảy 8:06) cập nhật file Drive `BaoCao_ChungKhoan_TheoDoi.xlsx` (id trong SKILL.md của tác vụ, không ghi ở đây vì repo công khai).
2. Tác vụ launchd `stockpeek-phan-tich-ngay` (`~/Claude/Scheduled/`, `run.sh`; T2–T6 14:20, 17:20, 19:20 và thứ Bảy 10:30) chạy bước 6 của SKILL.md: hỏi `modifiedTime` của file Drive, mới hơn tuần đã đăng thì đọc sheet, dựng báo cáo tuần mới (khôi phục dấu tiếng Việt, `partial: true`) rồi chạy `scripts/publish_weekly_report.py`.
3. Script kiểm tra schema → commit chỉ `weekly_reports.json` → push → hỏi API trang thật tới khi thấy tuần mới. In "ĐÃ LÊN WEB" mới tính là xong; báo lỗi thì đọc thông báo, đừng báo "đã đăng".
4. Log: `~/Library/Logs/stockpeek-baocao.log`.

**Thủ công khi cần** (báo cáo tuần đầy đủ có số liệu từng ngày như W45): lưu `weekly_report_YYYY-Www.json` vào `~/Claude/Inbox/` (tự được đăng ở lần chạy kế, `run.sh` chạy `publish_weekly_report.py --scan` không dùng token) hoặc nói Claude "đăng báo cáo tuần" để chạy `python3 scripts/publish_weekly_report.py <file>`.

Quy tắc chung để khỏi nhầm "đã push" với "đã lên web":
- **Chỉ đổi file dữ liệu** (`weekly_reports.json`, `daily_analysis.json`): push là đủ, ~20 giây là hiện, KHÔNG deploy Render.
- **Đổi code** (`server.py`, `public/*`): push xong vẫn phải Manual Deploy trên Render (skill `deploy`), rồi mở trang thật kiểm tra.
- Mail bản tin của routine tới trễ và không cố định (trưa ~13:51, chiều ~18:44), nên tác vụ chạy nhiều lần trong ngày; bài trùng date+kind+session tự bị bỏ qua.
- macOS chặn tác vụ nền đọc `~/Downloads`; chỉ dùng `~/Claude/Inbox`.

## Hiển thị
- API `GET /api/weekly-reports` → `{weeks, dataSource}` (`load_weekly_reports()` trong `server.py`).
- Tab **📋 Báo cáo** có 2 chế độ: "Hàng ngày" và "📅 Tuần" (`setReportMode`, nhớ lựa chọn trong localStorage). Dựng trong `renderWeekly()` ở `public/app.js`; mọi chuỗi đều qua `escapeHtml`.

## Đọc lại trong tác vụ "dòng tiền ngành + Excel"
Tác vụ này là skill `phan-tich-tin-chung-khoan` (ghi `BaoCao_ChungKhoan_TheoDoi`: Bao_Cao_Ngay, Co_Phieu_KN, Dong_Tien_Nganh). Skill do Anthropic quản lý nên không sửa SKILL.md; thay vào đó có bộ đổi định dạng:

```bash
python3 scripts/weekly_to_sheet.py            # tuần mới nhất, từ file trong repo
python3 scripts/weekly_to_sheet.py --url      # đọc từ GitHub khi máy không có repo
```

Kết quả JSON có `bao_cao_ngay[]` (1 dòng cho cả tuần, Ngày dạng `02-06/11/2026 (tuan)`), `dong_tien_nganh[]` và `co_phieu_kn[]`, dùng đúng tên trường mẫu JSON của skill. File theo dõi trên Drive ghi **theo tuần**, chữ không dấu, nên script bỏ dấu mặc định (`--accents` để giữ dấu). Trước khi ghi phải kiểm tra tuần đó đã có trong sheet chưa (Apps Script bỏ qua ngày đã có; W45 đã có sẵn trong sheet). Khi chạy tác vụ, nói "đọc báo cáo tuần trong stockPeek" để Claude chạy lệnh trên rồi ghi các dòng vào sheet.

Link file Drive KHÔNG ghi ở đây vì repo công khai; xem memory riêng (`stockpeek_automation_status.md`).
