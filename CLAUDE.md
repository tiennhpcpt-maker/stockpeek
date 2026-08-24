# stockPeek

## 1. Tổng quan dự án

stockPeek là trang web xem giá cổ phiếu Việt Nam theo thời gian thực (VN-Index, VN30, HNX, UPCOM, danh mục theo dõi cá nhân) kết hợp tổng hợp tin tức thị trường từ nhiều nguồn RSS. Có hệ thống tài khoản (email/password + Google OAuth) với danh mục/nguồn tin riêng theo user, và một trang quản trị (admin) để quản lý tài khoản và nguồn tin mặc định toàn hệ thống.

## 2. Ngăn xếp công nghệ

- **Backend**: Python 3 (`http.server.BaseHTTPRequestHandler` + `ThreadingHTTPServer`) — không dùng framework. Toàn bộ logic nằm trong 1 file `server.py`. **Một ngoại lệ duy nhất** trong `requirements.txt`: `PyJWT[crypto]`, dùng để ký JWT RS256 xác thực GitHub App (mục 5) — thư viện chuẩn Python không hỗ trợ ký RSA.
- **Frontend**: HTML/CSS/JS thuần (`public/`) — không build step, không bundler, không framework (React/Vue...). `app.js` là 1 file JS duy nhất thao tác DOM trực tiếp.
- **Lưu trữ dữ liệu**: **không có database** — mọi dữ liệu (nguồn tin, phân tích, tài khoản) là file JSON đọc/ghi qua GitHub Contents API vào 2 repo GitHub (xem [architecture.md](.claude/docs/architecture.md)).
- **Hosting**: Render.com, gói Free, Python 3, không build command (`render.yaml`).
- **Tự động hoá**: GitHub Actions (không phải Claude cloud routine — xem [architecture.md](.claude/docs/architecture.md)).

## 3. Lệnh phát triển

Cài `requirements.txt` (chỉ có `PyJWT[crypto]`), không `npm install`.

```bash
pip install -r requirements.txt
python3 server.py                # chạy dev server tại http://127.0.0.1:8787
```

Muốn test có tài khoản/admin cục bộ (không cần cấu hình GitHub App thật để duyệt route, nhưng ghi dữ liệu sẽ lỗi):

```bash
SESSION_SECRET=devtest ADMIN_EMAILS=you@example.com python3 server.py
```

Không có bước "build". Deploy = push lên GitHub rồi **bấm tay** "Manual Deploy" trên Render dashboard (xem mục 5 — Render **không** tự deploy khi có commit mới).

Kiểm tra cú pháp trước khi commit:
```bash
python3 -m py_compile server.py
```

## 4. Tóm tắt logic cốt lõi

Không có khái niệm "trọng số" trong app này. Hai cụm logic đáng chú ý nhất:

- **Xếp hạng "Tin nóng"**: tin từ các nguồn RSS được gộp nhóm nếu tiêu đề giống nhau (`cluster_news_items`, ngưỡng tương đồng `SAME_STORY_RATIO = 0.55`). Tin nào được nhiều nguồn cùng đưa (`sourceCount` cao) xếp lên "Tin nóng"; toàn bộ tin sắp theo thời gian xếp vào "Tin trực tiếp". Không dùng AI để chọn tin — thuần thuật toán đếm nguồn trùng lặp. Chi tiết: [news_pipeline.md](.claude/docs/news_pipeline.md).
- **Quyền admin**: user là admin nếu email nằm trong biến môi trường `ADMIN_EMAILS` (không thể gỡ qua UI) **hoặc** có `role: "admin"` trong `users.json` (gán được qua UI). Chi tiết: [auth_and_admin.md](.claude/docs/auth_and_admin.md).

## 5. Các ràng buộc chính

- **Không thêm dependency ngoài thư viện chuẩn Python**, trừ ngoại lệ đã ghi nhận ở mục 2 (`PyJWT[crypto]` cho ký JWT GitHub App). Không thêm dependency mới nào khác ngoài đó mà không cân nhắc lại nguyên tắc này.
- **Không bao giờ lưu thông tin tài khoản (email/password hash/watchlist riêng) vào repo public** (`GITHUB_REPO` = `tiennhpcpt-maker/stockpeek`). Dữ liệu tài khoản chỉ được ghi vào repo private `GITHUB_USERS_REPO`.
- **Xác thực GitHub bằng GitHub App, không phải personal access token tĩnh.** Server tự ký JWT (`GITHUB_APP_PRIVATE_KEY`) và đổi lấy installation access token ngắn hạn (`_get_installation_token()` trong `server.py`), tự làm mới khi gần hết hạn — không còn cảnh token hết hạn âm thầm làm sập `/api/news`, `/api/sources`... như PAT trước đây. 3 biến môi trường bắt buộc trên Render: `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_INSTALLATION_ID`. GitHub App phải được cài (install) vào cả 2 repo `GITHUB_REPO` và `GITHUB_USERS_REPO` với quyền Contents: Read & write.
- **Không sửa/tạo file trong `.github/workflows/` bằng `git push` thông thường** — permission cấp cho GitHub App **không có quyền `workflow`**, GitHub sẽ từ chối push/API ghi file workflow. Phải tạo/sửa file workflow qua giao diện web GitHub ("Add file" hoặc trình sửa file trực tiếp trên github.com).
- **Không giả định Render tự động deploy khi push code.** Repo được kết nối kiểu "Public Git Repository" (không phải GitHub App), nên mỗi lần push phải vào Render dashboard bấm tay "Manual Deploy → Deploy latest commit".
- **Không giả định có database hay ORM nào.** Mọi "ghi dữ liệu" thực chất là gọi GitHub Contents API (`update_github_file` trong `server.py`), có cơ chế retry khi gặp xung đột ghi đồng thời (HTTP 409) — không tự ý thay bằng cách lưu file cục bộ, dữ liệu sẽ mất khi Render restart (đĩa free tier không bền).
- **Không xoá cơ chế admin gốc qua `ADMIN_EMAILS`.** Đây là chốt chặn tránh việc admin tự khoá quyền của chính mình qua UI — xem [auth_and_admin.md](.claude/docs/auth_and_admin.md) trước khi đổi logic phân quyền.
- **Không tăng độ trễ cache tin tức (`NEWS_CACHE_TTL`) mà không cân nhắc việc tải RSS chạy song song** (`ThreadPoolExecutor` trong `get_news()`) — cache ngắn + tải tuần tự từng gây timeout thật trên production.

## 6. Tài liệu bổ sung

- [.claude/docs/architecture.md](.claude/docs/architecture.md) — kiến trúc tổng thể, 2 repo GitHub, các lớp cache, hosting.
- [.claude/docs/state_management.md](.claude/docs/state_management.md) — state phía client trong `app.js`, các interval tự làm mới, pattern modal xác nhận dùng chung.
- [.claude/docs/date_logic.md](.claude/docs/date_logic.md) — xử lý thời gian: parse `pubDate` RSS, múi giờ VN (+07:00), quy đổi cron UTC ↔ giờ VN.
- [.claude/docs/auth_and_admin.md](.claude/docs/auth_and_admin.md) — hệ thống đăng nhập, session, mô hình phân quyền admin.
- [.claude/docs/news_pipeline.md](.claude/docs/news_pipeline.md) — pipeline lấy tin RSS, gộp nhóm, xếp hạng Tin nóng/Tin trực tiếp.
