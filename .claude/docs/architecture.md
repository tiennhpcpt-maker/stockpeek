# Kiến trúc hệ thống

## Bố cục file

```
server.py              # toàn bộ backend: HTTP handler, mọi route, mọi logic
public/
  index.html            # 1 trang duy nhất (SPA thủ công, không router)
  app.js                # toàn bộ JS frontend, thao tác DOM trực tiếp
  style.css
sources.json            # nguồn RSS mặc định — mirror của bản trên GitHub repo public
sector_analysis.json    # NGỪNG DÙNG (11/2026) — server không đọc nữa, giữ lại làm lịch sử
market_overview.json    # NGỪNG DÙNG (11/2026) — server không đọc nữa, giữ lại làm lịch sử
daily_reports.json      # báo cáo hàng ngày — server tự ghi 8:30 + 16:00 (luồng nền, không AI)
daily_analysis.json     # bài phân tích do Claude viết — scheduled task máy cá nhân push bằng git
scripts/add_daily_analysis.py  # gộp 1 bài phân tích vào daily_analysis.json
.github/workflows/
  update-market-overview.yml   # NGỪNG DÙNG — đã tắt trên GitHub (xem "Phân vai 3 tab")
  update-sector-analysis.yml   # NGỪNG DÙNG — đã tắt trên GitHub
  keep-alive.yml               # cron ping site mỗi 10 phút, chống Render free-tier ngủ
render.yaml              # cấu hình deploy Render (buildCommand rỗng, startCommand python3 server.py)
```

Không có thư mục `src/`, không có test suite tự động, không có migration — đây là toàn bộ codebase.

## Không có database — lưu trữ qua GitHub Contents API

Mọi "ghi dữ liệu" là commit trực tiếp vào 1 trong 2 repo GitHub, qua REST Contents API (`_github_request`, `load_github_file`, `_put_github_file`, `update_github_file` trong `server.py`):

| Repo | Biến env | Chứa gì |
|---|---|---|
| `tiennhpcpt-maker/stockpeek` (public) | `GITHUB_REPO` | code + `sources.json`, `daily_reports.json`, `daily_analysis.json` |
| `tiennhpcpt-maker/stockpeek-users` (private) | `GITHUB_USERS_REPO` | `users.json` — email, password hash (PBKDF2), watchlist/nguồn riêng từng user |

**Vì sao tách 2 repo**: repo code là public để deploy miễn phí trên Render qua "Public Git Repository". Dữ liệu tài khoản (kể cả đã hash) không bao giờ được đưa vào repo public.

`update_github_file(path, default, mutate_fn, message, repo=...)` là điểm ghi duy nhất: đọc file mới nhất (bỏ qua cache), áp `mutate_fn`, ghi lại; nếu gặp HTTP 409 (ai đó ghi đè đồng thời) thì tự đọc lại và thử lại tối đa 3 lần. Mọi hàm ghi dữ liệu (`add_source_entry`, `create_local_user`, `update_user_data`, `set_user_role`, ...) đều đi qua hàm này — không tự viết logic ghi file riêng.

## Các lớp cache trong bộ nhớ (RAM, mất khi restart)

| Cache | Biến | TTL | Ghi chú |
|---|---|---|---|
| Nội dung file GitHub | `_github_file_cache` | 20s | tránh gọi GitHub API liên tục |
| Tin tức RSS đã gộp nhóm | `_news_cache` | 60s | key = tuple các URL nguồn đã sort; tối đa 30 entry, tự xoá entry cũ nhất |
| Chỉ số thị trường | `_indices_cache` | theo `INDICES_CACHE_TTL` | scrape từ 24hmoney.vn + vndirect dchart API |
| Giá cổ phiếu theo mã | `_quotes_cache` | 10s mới / 120s trả bản cũ + làm mới ngầm | VPS mất ~9s từ IP Render nên không để request chờ |
| Bảng ngành trực tiếp | `_live_sectors_cache` | 30s | tính từ `_quotes_cache` |

Luồng nền `_market_warm_loop` (tắt bằng env `MARKET_WARMER=0`) làm mới giá các mã ngành/mặc định + chỉ số mỗi `MARKET_WARM_INTERVAL` = 30s, để người dùng không phải chờ lần gọi VPS ~9s (đo được 16s ở lần đầu sau restart nếu không có luồng này).

Vì cache nằm trong RAM, mỗi lần Render free-tier restart (spin-down/spin-up) mọi cache về rỗng — request đầu tiên sau đó luôn là cache-miss thật (xem [news_pipeline.md](news_pipeline.md) về vì sao việc này từng gây timeout).

## Tự động hoá — GitHub Actions, không phải Claude cloud

- `update-market-overview.yml` / `update-sector-analysis.yml`: **đã tắt (11/2026)**. Từng ghi `market_overview.json` / `sector_analysis.json` bằng văn mẫu 2 lần/ngày — trùng nội dung với báo cáo ngày, lại chạy lệch giờ (cron GitHub có lần chạy 14:33, trước ATC) nên số liệu mâu thuẫn với báo cáo cuối phiên. Không bật lại.
- `keep-alive.yml`: `curl` vào `https://stockpeek.onrender.com/` mỗi 10 phút để request luôn có traffic, tránh Render free-tier spin-down (~15 phút không traffic).
- **Báo cáo hàng ngày** (`daily_reports.json`): KHÔNG dùng GitHub Actions (GitHub App không có quyền `workflow` để thêm file workflow). Thay vào đó `server.py` chạy luồng nền `_daily_report_loop` (bật khi có GitHub App; tắt bằng env `DAILY_REPORT_SCHEDULER=0`), mỗi phút kiểm tra: T2–T6, từ 8:30 đến trước 16:00 thiếu bản `morning` hoặc từ 16:00 đến hết ngày thiếu bản `afternoon` thì tạo và ghi qua `update_github_file` (lỗi thì thử lại sau 10 phút). Nhờ keep-alive nên server luôn thức đúng giờ. Bản sáng dùng lại số liệu thị trường của bản cuối phiên gần nhất (8:30 chưa khớp lệnh). Admin có nút "Tạo ngay" (`POST /api/admin/daily-report/generate`). Web đọc qua `GET /api/daily-reports`.
- **Bài phân tích** (`daily_analysis.json`): rút gọn từ các email tự gửi trong Gmail (bản tin sáng `kind=bulletin`, báo cáo tuần `weekly`, tổng kết tháng `monthly`, phân tích doanh nghiệp `company`). Scheduled task `stockpeek-phan-tich-ngay` trong Claude desktop (`~/Claude/Scheduled/`) đọc mail mới rồi `git push` từ máy cá nhân. Web để công khai nên KHÔNG đưa thông tin tài khoản, sao kê hay link Drive vào file này, vì máy cá nhân có quyền push còn cloud routine thì không. Server chỉ đọc file này, nên không cần deploy lại Render.
- **Đã thử và bỏ**: Claude Code cloud routine để tự nghiên cứu + cập nhật `sector_analysis.json`/`market_overview.json` — không có quyền push từ môi trường cloud đó cho repo này. Không thử lại hướng này; nếu cần nội dung có nghiên cứu thật (không templated), phải làm thủ công qua phiên chat.

## Hosting

Render.com, gói Free, Python 3, `buildCommand` rỗng, `startCommand: python3 server.py`. Repo kết nối kiểu **"Public Git Repository"** (không phải GitHub App) → **push code không tự deploy**, luôn cần vào Render dashboard bấm "Manual Deploy → Deploy latest commit".

## Phân vai 3 tab Thị trường / Ngành / Báo cáo (từ 11/2026)

Mỗi số liệu chỉ có 1 nguồn, các tab không lặp nhau:

- **📊 Thị trường** = tình hình lúc này. Khối chỉ số trực tiếp (`/api/indices`) + nhận định lấy từ **bản tin Claude mới nhất** trong `daily_analysis.json` (`get_market_view()`, chỉ `kind` bulletin/weekly, tối đa `MARKET_VIEW_MAX_AGE_DAYS` ngày). Không có bản tin gần đây thì hiện tóm tắt báo cáo tự động gần nhất. Route vẫn là `GET /api/market-overview`.
- **🏭 Ngành** = bảng ngành trực tiếp (`get_live_sectors()`, `GET /api/sector-analysis`), tính từ giá khớp lệnh bằng `_sector_stats()` — **cùng hàm** với báo cáo cuối phiên nên không lệch số. Trước giờ mở cửa (VPS chưa có giá khớp) trả bảng ngành của báo cáo cuối phiên gần nhất (`live=false`, `asOf`). Ghi chú "mã đáng chú ý" của bản tin Claude được gắn vào thẻ ngành chứa mã đó. Trường `sectors` ({name, view}) của bản tin hiện trong thẻ ngành cùng tên — `name` phải khớp nguyên văn `SECTOR_TICKERS` (`scripts/add_daily_analysis.py` kiểm tra bằng `SECTOR_NAMES`, đổi ngành thì sửa cả 2 nơi); tên lệch thì hiện ở khối "Nhận định ngành khác".
- **📋 Báo cáo** = lưu trữ theo ngày: mỗi ngày 1 mục gồm bài Claude + báo cáo tự động. Có bản cuối phiên thì không hiện bản 8:30 (tin trùng, số liệu thị trường của bản 8:30 chỉ là bản sao phiên trước).

## Dự phòng hiển thị bản tin / báo cáo / ngành (từ 11/2026)

Nguyên tắc: các tab Thị trường, Ngành, Báo cáo **không bao giờ để trống** khi còn bất kỳ dữ liệu cũ nào — hiện bản cũ kèm cảnh báo ⚠️.

| Lớp | Lỗi | Dự phòng |
|---|---|---|
| Server `_load_report_list` (chỉ đọc) | GitHub API lỗi / 404 / rỗng | bản đọc được gần nhất trong RAM → file `daily_*.json` đi kèm bản deploy. Ghi (`update_github_file`, `force=True`) KHÔNG bao giờ dùng dự phòng. API trả `dataSource` = github/memory/bundled |
| Server `get_market_view` | bản tin cũ hơn `MARKET_VIEW_MAX_AGE_DAYS` | vẫn trả bản tin + `stale: true`, web kèm tóm tắt tự động mới nhất |
| Server `get_live_sectors` | chưa có giá khớp / VPS lỗi | báo cáo cuối phiên → báo cáo bất kỳ có số liệu ngành → kết quả trực tiếp gần nhất trong RAM → `sector_analysis.json` cũ (`legacy: true`) |
| Server `get_quotes` | VPS lỗi | trả giá cũ trong cache dù quá `QUOTES_STALE_TTL` |
| Trình duyệt `fetchWithFallback` | không gọi được server / API lỗi | bản tải thành công gần nhất trong localStorage (`stockpeek.cache.*`) |

Vì vậy **không xoá** `sector_analysis.json`, `daily_reports.json`, `daily_analysis.json` khỏi repo.
