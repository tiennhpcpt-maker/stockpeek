# Xử lý thời gian

Không có thư viện date (không moment/dayjs/date-fns). Toàn bộ xử lý thời gian dùng `datetime`/`email.utils` chuẩn của Python phía server, và `Date` gốc của JS phía client.

## Múi giờ: luôn lưu giờ Việt Nam dạng `+07:00`, không lưu UTC trần

Các file `market_overview.json` và `sector_analysis.json` lưu `generated_at` dạng ISO có offset rõ ràng, ví dụ:

```
"generated_at": "2026-07-25T11:11:07+07:00"
```

**Không lưu** dạng `Z` (UTC) hay không ghi offset — vì nội dung hiển thị (ngày/giờ trong outlook, market_note) được viết bằng giờ VN, offset phải khớp để không lệch múi giờ khi người khác đọc lại file.

Lấy giờ VN hiện tại khi cập nhật thủ công các file này:
```bash
TZ='Asia/Ho_Chi_Minh' date +"%Y-%m-%dT%H:%M:%S+07:00"
```

## Cron GitHub Actions luôn khai báo bằng UTC — quy đổi thủ công khi đọc/sửa

`.github/workflows/update-market-overview.yml` khai báo:
```yaml
- cron: "0 1 * * *"   # 8:00 sang gio VN
- cron: "30 8 * * *"  # 15:30 chieu gio VN
```

Comment bên cạnh mỗi dòng cron **là quy đổi giờ VN**, viết tay — GitHub không tự hiển thị giờ VN. Khi thêm/sửa cron mới, luôn cộng thêm comment quy đổi kiểu này (giờ VN = giờ UTC + 7), và luôn viết field cron bằng UTC.

**Lưu ý về độ chính xác**: cron miễn phí của GitHub Actions không đảm bảo chạy đúng giờ tuyệt đối — quan sát thực tế 3 lần chạy đầu của `update-market-overview.yml` lệch giờ đáng kể so với lịch khai báo. Không giả định "đã đặt cron 8:00 sáng thì chắc chắn có dữ liệu mới lúc 8:05" — luôn kiểm tra `generated_at` thực tế thay vì tin vào lịch cron.

## Parse `pubDate` từ RSS (định dạng RFC 2822, không phải ISO)

RSS `<pubDate>` dùng định dạng kiểu `"Sat, 25 Jul 2026 22:00:01 +0700"` — **không** dùng `datetime.fromisoformat()` cho chuỗi này, sẽ lỗi.

- Phía server: `_pub_ts(pub_date)` trong `server.py` dùng `email.utils.parsedate_to_datetime(...).timestamp()`, có try/except trả về `0` nếu parse lỗi (tin lỗi bị đẩy xuống cuối khi sort theo thời gian, không crash).
- Phía client: `_pubTs(pubDate)` trong `app.js` dùng `new Date(pubDate).getTime()` — JS engine tự nhận diện được định dạng RFC 2822 này. Có check `isNaN` trả về `0` tương tự.

Hai hàm `_pub_ts` (Python) và `_pubTs` (JS) **cùng tên gần giống nhau nhưng là 2 hàm độc lập, không chia sẻ code** — sửa 1 bên không tự động áp dụng bên kia.

## Hiển thị thời gian tương đối ("x phút trước") — chỉ ở client

`timeAgo(dateStr)` trong `app.js` tính chênh lệch so với `Date.now()` và trả về chuỗi tiếng Việt (`"vừa xong"`, `"X phút trước"`, `"X giờ trước"`, `"X ngày trước"`). Server không bao giờ trả về chuỗi "x phút trước" — luôn trả `pubDate`/`created_at` thô, client tự tính lại mỗi lần render. Vì vậy các danh sách tin tức cần re-render định kỳ (xem interval trong [state_management.md](state_management.md)) để "x phút trước" không bị đứng yên.

Ngày tạo tài khoản trong bảng admin dùng `fmtAdminDate(iso)` — format kiểu `toLocaleDateString("vi-VN")` (ví dụ `24/7/2026`), khác hẳn cách format `timeAgo` — không dùng lẫn 2 hàm này cho nhau.
