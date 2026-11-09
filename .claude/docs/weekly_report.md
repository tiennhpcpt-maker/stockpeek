# Báo cáo tuần

## Dữ liệu
- `weekly_reports.json` = `{"items": [báo cáo tuần, mới nhất ở đầu]}`, mỗi phần tử theo schema_version 1 (`week_id` "2026-W45", `period`, `summary`, `days[]`, `sector_flows[]`, `watchlist[]`, `outlook`, `data_quality[]`, `sources[]`, `disclaimer`). Giữ tối đa 26 tuần.
- Thêm/cập nhật 1 tuần: `python3 scripts/add_weekly_report.py <file.json>` (kiểm tra schema, thay bản cùng `week_id`, chặn từ khoá cá nhân như link Drive/email/token vì file công khai), rồi `git commit` + `git push`. **Không cần deploy Render** — server đọc file từ GitHub (cache 20s), có dự phòng RAM → file đi kèm bản deploy như `daily_analysis.json`.
- Số liệu lấy từ báo chí nên có chỗ lệch giữa các nguồn: ghi rõ trong `data_quality`, số suy ra từ phiên khác đánh `derived: true` (web hiện dấu `*`).

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
