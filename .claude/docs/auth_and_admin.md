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
    if (user.get("email") or "").lower() in ADMIN_EMAILS:
        return True
    return user.get("role") == "admin"
```

- **`ADMIN_EMAILS`** (biến môi trường Render, danh sách email phân tách bởi dấu phẩy): admin "gốc", **không thể gỡ qua UI trang quản trị**. Cố tình thiết kế vậy để tránh việc admin tự bấm nhầm "Bỏ admin"/"Xoá" cho chính mình rồi mất quyền truy cập vĩnh viễn (nút tương ứng bị `disabled` phía client khi `id === currentUser.id`, và phía server cũng chặn ở endpoint).
- **`role: "admin"`** trong `users.json`: cấp qua UI (nút "Cấp admin" trong tab Tài khoản), gỡ được qua UI. Đây là cách cấp quyền cho admin thứ 2 trở đi.

Muốn thêm 1 admin gốc mới: thêm email vào `ADMIN_EMAILS` trên Render dashboard rồi bảo người đó đăng nhập bằng đúng email đó — **không** sửa `users.json` bằng tay để gán `role: "admin"` cho mục đích này (dùng sai lớp, họ vẫn gỡ được quyền qua UI).

## API admin — tách biệt hoàn toàn API thường

`/api/admin/*` (users, users/role, sources) đều gọi `self._require_admin()` đầu route — trả 401 nếu chưa login, 403 nếu login nhưng không phải admin. Không tái sử dụng logic check quyền này bằng cách so sánh `currentUser.role === "admin"` ở phía client làm điều kiện bảo mật — client-side check chỉ để ẩn/hiện UI, **quyền thật luôn được server enforce lại**.

`/api/admin/sources` thao tác thẳng lên `sources.json` (danh sách mặc định toàn hệ thống, dùng cho khách và user mới), khác với `/api/sources` — endpoint này trả về danh sách **cá nhân** của user nếu đã đăng nhập, hoặc danh sách mặc định nếu là khách. Hai endpoint này không dùng chung 1 nguồn dữ liệu khi user đã đăng nhập.
