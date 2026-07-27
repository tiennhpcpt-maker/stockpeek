# Kiến trúc hệ thống

## Bố cục file

```
server.py              # toàn bộ backend: HTTP handler, mọi route, mọi logic
public/
  index.html            # 1 trang duy nhất (SPA thủ công, không router)
  app.js                # toàn bộ JS frontend, thao tác DOM trực tiếp
  style.css
sources.json            # nguồn RSS mặc định — mirror của bản trên GitHub repo public
sector_analysis.json    # phân tích nhóm ngành — cập nhật thủ công (Claude), không tự động
market_overview.json    # nhận định thị trường — cập nhật tự động 2 lần/ngày qua GitHub Actions
.github/workflows/
  update-market-overview.yml   # cron cập nhật market_overview.json
  keep-alive.yml               # cron ping site mỗi 10 phút, chống Render free-tier ngủ
render.yaml              # cấu hình deploy Render (buildCommand rỗng, startCommand python3 server.py)
```

Không có thư mục `src/`, không có test suite tự động, không có migration — đây là toàn bộ codebase.

## Không có database — lưu trữ qua GitHub Contents API

Mọi "ghi dữ liệu" là commit trực tiếp vào 1 trong 2 repo GitHub, qua REST Contents API (`_github_request`, `load_github_file`, `_put_github_file`, `update_github_file` trong `server.py`):

| Repo | Biến env | Chứa gì |
|---|---|---|
| `tiennhpcpt-maker/stockpeek` (public) | `GITHUB_REPO` | code + `sources.json`, `sector_analysis.json`, `market_overview.json` |
| `tiennhpcpt-maker/stockpeek-users` (private) | `GITHUB_USERS_REPO` | `users.json` — email, password hash (PBKDF2), watchlist/nguồn riêng từng user |

**Vì sao tách 2 repo**: repo code là public để deploy miễn phí trên Render qua "Public Git Repository". Dữ liệu tài khoản (kể cả đã hash) không bao giờ được đưa vào repo public.

`update_github_file(path, default, mutate_fn, message, repo=...)` là điểm ghi duy nhất: đọc file mới nhất (bỏ qua cache), áp `mutate_fn`, ghi lại; nếu gặp HTTP 409 (ai đó ghi đè đồng thời) thì tự đọc lại và thử lại tối đa 3 lần. Mọi hàm ghi dữ liệu (`add_source_entry`, `create_local_user`, `update_user_data`, `set_user_role`, ...) đều đi qua hàm này — không tự viết logic ghi file riêng.

## Các lớp cache trong bộ nhớ (RAM, mất khi restart)

| Cache | Biến | TTL | Ghi chú |
|---|---|---|---|
| Nội dung file GitHub | `_github_file_cache` | 20s | tránh gọi GitHub API liên tục |
| Tin tức RSS đã gộp nhóm | `_news_cache` | 60s | key = tuple các URL nguồn đã sort; tối đa 30 entry, tự xoá entry cũ nhất |
| Chỉ số thị trường | `_indices_cache` | theo `INDICES_CACHE_TTL` | scrape từ 24hmoney.vn + vndirect dchart API |

Vì cache nằm trong RAM, mỗi lần Render free-tier restart (spin-down/spin-up) mọi cache về rỗng — request đầu tiên sau đó luôn là cache-miss thật (xem [news_pipeline.md](news_pipeline.md) về vì sao việc này từng gây timeout).

## Tự động hoá — GitHub Actions, không phải Claude cloud

- `update-market-overview.yml`: chạy `scripts/update_market_overview.py` theo cron (01:00 và 08:30 UTC), script scrape số liệu thật rồi ghi templated summary (không dùng AI) vào `market_overview.json`, tự commit+push bằng token mặc định của Actions.
- `keep-alive.yml`: `curl` vào `https://stockpeek.onrender.com/` mỗi 10 phút để request luôn có traffic, tránh Render free-tier spin-down (~15 phút không traffic).
- **Đã thử và bỏ**: Claude Code cloud routine để tự nghiên cứu + cập nhật `sector_analysis.json`/`market_overview.json` — không có quyền push từ môi trường cloud đó cho repo này. Không thử lại hướng này; nếu cần nội dung có nghiên cứu thật (không templated), phải làm thủ công qua phiên chat.

## Hosting

Render.com, gói Free, Python 3, `buildCommand` rỗng, `startCommand: python3 server.py`. Repo kết nối kiểu **"Public Git Repository"** (không phải GitHub App) → **push code không tự deploy**, luôn cần vào Render dashboard bấm "Manual Deploy → Deploy latest commit".
