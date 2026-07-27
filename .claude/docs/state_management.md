# State phía client (`public/app.js`)

Không có framework, không có store — toàn bộ state là biến `let` toàn cục ở top-level module, mutate trực tiếp rồi gọi hàm `render*()` tương ứng để vẽ lại DOM bằng `innerHTML`. Không có virtual DOM, không diffing.

## Biến state toàn cục

| Biến | Ý nghĩa | Set lại khi |
|---|---|---|
| `currentUser` | user hiện tại (`null` = khách) | `checkAuth()` lúc load trang, sau login/logout |
| `watchlist` | mảng mã CK đang theo dõi | `loadWatchlist()` (localStorage) nếu khách, hoặc từ `/api/watchlist` nếu đã đăng nhập |
| `sources` | nguồn tin đang áp dụng (cá nhân hoặc mặc định) | `refreshSources()` |
| `adminAllUsers` / `adminAllSources` | dữ liệu thô cho 2 tab trong modal Quản trị | `loadAdminUsers()` / `loadAdminSources()` — bảng lọc (`filterAdminUsers`/`filterAdminSources`) lọc trên mảng này, không gọi lại API |
| `adminExpandedId` | id user đang mở "Chi tiết" trong bảng admin | click nút Chi tiết (toggle) |
| `adminConfirmCallback` | hàm sẽ chạy nếu bấm OK trên modal xác nhận dùng chung | `openAdminConfirm(message, onConfirm)` |

**Quan trọng**: `currentUser` chỉ đổi qua `checkAuth()`, `afterLoginSuccess()`, `logout()`. Không tự set `currentUser` ở nơi khác — nhiều luồng (render nút Quản trị, quyết định gọi API nào cho watchlist/sources) đều dựa vào biến này.

## Pattern modal xác nhận dùng chung (admin)

`openAdminConfirm(message, onConfirm)` + `runAdminConfirm()` + `closeAdminConfirm()` là **1 modal, dùng chung cho cả xoá tài khoản và xoá nguồn tin** — không phải 2 modal riêng. Khi cần thêm 1 hành động "xác nhận trước khi xoá" mới, tái sử dụng 3 hàm này thay vì tạo modal mới hay quay lại dùng `confirm()` gốc của trình duyệt.

**Vì sao không dùng `confirm()` gốc**: dialog gốc của trình duyệt không thao tác được bằng công cụ browser-automation (bị auto-cancel), và cũng không đồng bộ style với phần còn lại của trang. Modal tự viết giải quyết cả hai.

## Các interval tự làm mới

| Việc | Hằng số | Giá trị |
|---|---|---|
| Giá theo dõi (`refreshQuotes`) | `QUOTES_INTERVAL_MS` | 15s |
| Chỉ số thị trường (`refreshIndices`) | `INDICES_INTERVAL_MS` | 30s |
| Tin trực tiếp (`refreshLiveNews`) | `LIVE_NEWS_INTERVAL_MS` | 60s |
| Tin nóng (`refreshHotNews`) | `HOT_NEWS_INTERVAL_MS` | 60s |

Cả `refreshLiveNews` và `refreshHotNews` đều gọi `/api/news` độc lập (không share 1 lần fetch) — cache 60s phía server (`NEWS_CACHE_TTL`) khiến việc này không tốn thêm chi phí RSS thật khi 2 interval trùng thời điểm. Đừng rút ngắn thêm các interval này mà không kiểm tra lại thời gian tải RSS thật trên production trước (xem [news_pipeline.md](news_pipeline.md)).

## Sau khi login/logout/đổi nguồn tin, luôn gọi lại đủ 2 hàm tin tức

Bất kỳ chỗ nào đổi trạng thái đăng nhập hoặc danh sách nguồn tin (`afterLoginSuccess`, `logout`, `addSource`, `removeSource`) đều phải gọi cả `refreshLiveNews()` **và** `refreshHotNews()` — không chỉ 1 trong 2 — vì nguồn tin đổi thì cả "Tin nóng" lẫn "Tin trực tiếp" đều cần tính lại.
