# Đăng nhập, session, và phân quyền admin

## Mật khẩu và session — tự viết, không dùng thư viện auth

- Mật khẩu: PBKDF2-HMAC-SHA256, 200.000 vòng lặp (`PBKDF2_ITERATIONS`), salt riêng mỗi user (`hash_password`/`verify_password`). Không bao giờ lưu plaintext, kể cả tạm thời.
- Session: không dùng JWT hay thư viện session. `create_session_token(user_id)` tự đóng gói `{"uid", "exp"}` thành base64url + ký HMAC-SHA256 bằng `SESSION_SECRET`, dạng `payload.signature`. `verify_session_token` so `hmac.compare_digest` (chống timing attack) rồi check hết hạn. Cookie: `HttpOnly`, `Secure` (khi có `PORT` env — tức đang chạy trên Render), `SameSite=Lax`, sống 30 ngày (`SESSION_MAX_AGE`).
- **`SESSION_SECRET` là biến môi trường bắt buộc trên Render.** Nếu bị xoá nhầm (ví dụ do lỗi "duplicate key" khi sửa Environment Variables trên Render UI), toàn bộ login (cả email lẫn Google) hỏng với lỗi chung chung. Đây là việc đầu tiên cần kiểm tra khi có báo cáo "không đăng nhập được".

## Google OAuth

Flow chuẩn authorization code: `/auth/google/login` redirect sang Google kèm `state` lưu cookie tạm (`oauth_state`, 10 phút) → `/auth/google/callback` đổi code lấy `id_token`, tự decode phần payload JWT bằng tay (`_b64url_decode` + `json.loads`) — **không verify chữ ký JWT** vì token lấy trực tiếp từ Google qua kênh HTTPS server-to-server (không phải từ client), coi là đã tin cậy theo ngữ cảnh này. Nếu sau này nhận `id_token` từ nguồn khác (client gửi lên thẳng), phải verify chữ ký.

Tài khoản Google và tài khoản email trùng nhau qua **cùng email** sẽ tự liên kết (`find_or_create_google_user` gọi `find_user_by_email` trước khi tạo mới).

## Mô hình phân quyền admin — 2 lớp, không tương đương nhau

```python
def _is_admin(user):
    if user.get("google_id") and (user.get("email") or "").lower() in ADMIN_EMAILS:
        return True
    return user.get("role") == "admin"
```

- **`ADMIN_EMAILS`** (biến môi trường Render, danh sách email phân tách bởi dấu phẩy): admin "gốc", **không thể gỡ qua UI trang quản trị**. Cố tình thiết kế vậy để tránh việc admin tự bấm nhầm "Bỏ admin"/"Xoá" cho chính mình rồi mất quyền truy cập vĩnh viễn (nút tương ứng bị `disabled` phía client khi `id === currentUser.id`, và phía server cũng chặn ở endpoint).
- **`role: "admin"`** trong `users.json`: cấp qua UI (nút "Cấp admin" trong tab Tài khoản), gỡ được qua UI. Đây là cách cấp quyền cho admin thứ 2 trở đi.

Muốn thêm 1 admin gốc mới: thêm email vào `ADMIN_EMAILS` trên Render dashboard rồi bảo người đó đăng nhập bằng đúng email đó **bằng Google** (từ 26/11/2026 admin gốc theo email chỉ tính với tài khoản có `google_id`, vì đăng ký thường không xác minh email; Google cũng phải báo `email_verified`). Liên kết Google vào tài khoản đăng ký thường sẽ xoá mật khẩu cũ (chống chiếm tài khoản đặt trước) — **không** sửa `users.json` bằng tay để gán `role: "admin"` cho mục đích này (dùng sai lớp, họ vẫn gỡ được quyền qua UI).

## API admin — tách biệt hoàn toàn API thường

`/api/admin/*` (users, users/role, sources) đều gọi `self._require_admin()` đầu route — trả 401 nếu chưa login, 403 nếu login nhưng không phải admin. Không tái sử dụng logic check quyền này bằng cách so sánh `currentUser.role === "admin"` ở phía client làm điều kiện bảo mật — client-side check chỉ để ẩn/hiện UI, **quyền thật luôn được server enforce lại**.

**Khách chưa đăng nhập chỉ được XEM nguồn tin**: `POST`/`DELETE /api/sources` trả 401 khi chưa đăng nhập (trước 11/2026 khách thêm/xoá thẳng vào `sources.json` dùng chung — ai cũng chèn nguồn rác hoặc xoá tin của mọi khách được). Web ẩn ô thêm/nút xoá với khách (`sourcesEditable`).

Giới hạn khác: đăng ký tối đa 5 tài khoản / giờ / IP (`_check_register_rate_limit`), body JSON tối đa 64 KB (`MAX_JSON_BODY`), danh mục tối đa 50 mã, mã phải khớp `[A-Z0-9]{2,10}`.

`/api/admin/sources` thao tác thẳng lên `sources.json` (danh sách mặc định toàn hệ thống, dùng cho khách và user mới), khác với `/api/sources` — endpoint này trả về danh sách **cá nhân** của user nếu đã đăng nhập, hoặc danh sách mặc định nếu là khách. Hai endpoint này không dùng chung 1 nguồn dữ liệu khi user đã đăng nhập.

## Giới hạn đăng nhập sai theo IP

`_check_login_rate_limit` (10 lần / 5 phút) dùng `Handler._client_ip()`: ưu tiên `CF-Connecting-IP` / `True-Client-IP` (proxy tự ghi đè), không có thì phần tử **cuối** của `X-Forwarded-For`. Không dùng phần tử đầu — người gửi tự điền được, đã thử trên Render 11/2026 là lách được giới hạn. Log `[auth] IP cho giới hạn đăng nhập lấy từ …` (1 lần mỗi nguồn, không ghi IP) cho biết đang dùng header nào.

## Header bảo mật

`Handler.end_headers` thêm cho mọi phản hồi: `X-Frame-Options: DENY` + `Content-Security-Policy: frame-ancestors 'none'` (chống nhúng trang vào iframe — clickjacking), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`. CSP chỉ đặt `frame-ancestors` để không chặn script/style hiện có. Vì có `nosniff`, file tĩnh mới phải trả đúng Content-Type.

## Thu hồi phiên (từ 26/11/2026)
Cookie phiên ký HMAC mang `sv` = `session_version` của tài khoản trong users.json. `_current_user` so `sv` với `session_version`; lệch là phiên bị thu hồi.
- **Đăng xuất** tăng `session_version` → đăng xuất **mọi thiết bị** (1 lần ghi users.json).
- Gắn Google vào tài khoản đăng ký thường cũng tăng `session_version`.
- Phiên tạo trước khi có `sv` coi là 0, nên deploy không đăng xuất ai.

## Lỗi trả về trình duyệt
Lỗi nội bộ (GitHub API, VPS, mạng) đi qua `Handler._send_server_error`: chi tiết ghi log Render (`[lỗi] ...`), trình duyệt chỉ nhận "Máy chủ đang gặp lỗi". Xem lỗi thật trong Logs của Render.

## CSP và header bảo mật (từ 28/11/2026)
`CSP_HEADER` trong server.py chỉ cho script/style/ảnh/kết nối từ chính web (`'self'`), không script nội dòng, không `eval`. **Thêm CDN, font Google, ảnh ngoài hay gọi API site khác từ trình duyệt thì phải mở thêm nguồn đó trong `CSP_HEADER`**, không thì trình duyệt chặn im lặng (xem Console). HSTS chỉ bật khi chạy trên Render. Kết nối treo bị cắt sau 30 giây (`Handler.timeout`). Body JSON phải là object.
