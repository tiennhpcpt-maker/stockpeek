# Pipeline tin tức: lấy RSS → gộp nhóm → Tin nóng / Tin trực tiếp

## Luồng tổng quan

```
sources.json (mặc định) hoặc user["sources"] (cá nhân, nếu đã đăng nhập)
  → get_news(sources, category)     [server.py] — lọc nguồn theo category trước khi fetch
      → _fetch_source_items(src)    chạy song song cho từng nguồn (ThreadPoolExecutor)
      → cluster_news_items(items)   gộp tin trùng nội dung từ nhiều nguồn
      → cache 60s theo key = (category, sorted(url nguồn))
  → GET /api/news?category=stock|tech  →  { items: [...], errors: [...] }
  → client: refreshHotNews(category) lọc top 3 theo sourceCount
  → client: refreshLiveNews(category) lọc top 10 theo pubDate
```

`/api/news` **luôn trả về toàn bộ tin đã gộp của 1 category** (không phân trang, không giới hạn ở server) — việc chọn "3 tin nóng" hay "10 tin mới" là lọc **phía client**, không có 2 endpoint riêng cho 2 khu vực này.

## Chuyên mục tin tức (category): "stock" vs "tech"

Mỗi nguồn tin trong `sources.json`/`user["sources"]` có field `"category"` — `"stock"` (chứng khoán, giá trị mặc định) hoặc `"tech"` (công nghệ). **Nguồn không có field này được coi là `"stock"`** (`_source_category()` trong `server.py`), giữ tương thích ngược với các nguồn đã lưu trước khi có khái niệm category. Giống pattern của `"lang"` (chỉ ghi field khi khác mặc định `"vi"`), field `"category"` chỉ được ghi vào entry khi khác mặc định `"stock"`.

Toàn bộ UI (Tin nóng, Tin trực tiếp) hiện có **2 bộ độc lập** — 1 cho `stock`, 1 cho `tech` — mỗi bộ gọi `/api/news?category=...` riêng, render vào DOM riêng (xem `NEWS_DOM` trong `app.js`). Thêm/xoá nguồn tin qua UI đều có bước chọn category (radio `stock`/`tech`), gửi kèm trong body của `POST /api/sources` và `POST /api/admin/sources`.

`MAX_SOURCES` (giới hạn số nguồn tối đa) được tính **theo từng category riêng**, không phải tổng số nguồn — thêm 15 nguồn `stock` không chặn việc thêm nguồn `tech` đầu tiên.

## Tải song song, không tuần tự — lý do là lịch sử sự cố thật

`_fetch_source_items(src)` là hàm xử lý 1 nguồn (fetch RSS, parse XML, dịch nếu nguồn tiếng nước ngoài). `get_news()` chạy hàm này qua `ThreadPoolExecutor(max_workers=len(sources))` thay vì vòng `for` tuần tự.

**Vì sao quan trọng**: mỗi nguồn có `timeout=8` giây. Với 10+ nguồn (sau khi user thêm nguồn cá nhân), chạy tuần tự worst-case cộng dồn gần 1-2 phút. Kết hợp với việc Render free-tier tự spin-down khi vắng traffic (cache RAM cũng mất theo), lần tải đầu tiên sau một khoảng nghỉ dài từng khiến `/api/news` timeout thật trên production, hiển thị trắng trang cả "Tin nóng" lẫn "Tin trực tiếp". Đã đo thực tế: tuần tự 10-18s (đôi khi hơn), song song ~4s. **Không revert lại vòng `for` tuần tự.**

## Gộp nhóm tin trùng (`cluster_news_items`)

So khớp tiêu đề đã chuẩn hoá (`_normalize_title`: lowercase, bỏ dấu câu, gộp khoảng trắng) bằng `difflib.SequenceMatcher`, ngưỡng `SAME_STORY_RATIO = 0.55`. Tin nào tỉ lệ giống ≥ ngưỡng với 1 cluster đã có thì nhập vào cluster đó thay vì tạo mới. Mỗi cluster xuất ra 1 item:

- `title`/`summary`: lấy từ bản tin có `summary` dài nhất trong cluster (giả định bản đầy đủ nhất là bản tốt nhất để hiển thị).
- `sourceCount`: số nguồn khác nhau đưa tin này — **đây chính là tín hiệu "độ nóng"**, không dùng AI/LLM để chọn tin.
- `sources`: mảng đầy đủ (nguồn, tiêu đề riêng, link riêng) để hiển thị khi mở "Xem nguồn đưa tin".

Ngưỡng `0.55` là ước lượng thủ công, chưa qua đánh giá định lượng — nếu thấy tin bị gộp sai (2 tin khác nhau bị nhập làm 1, hoặc cùng 1 tin bị tách ra 2 card), cân nhắc chỉnh ngưỡng này trước khi đổi kiến trúc gộp nhóm.

## Dịch tin nguồn nước ngoài

Nguồn có `"lang": "en"` trong `sources.json`/`users["sources"]` sẽ tự dịch `title` + `summary` sang tiếng Việt qua `translate_to_vi()` (gọi endpoint dịch miễn phí không chính thức của Google, không phải Google Cloud Translation API có trả phí). Giới hạn 6 bài/nguồn nước ngoài (so với 12 bài/nguồn tiếng Việt) để giảm số lượt gọi dịch — endpoint miễn phí này không có SLA, lỗi thì `translate_to_vi` tự fallback trả nguyên văn gốc (không raise exception, không làm hỏng cả request).

## Thêm nguồn tin mới — luôn validate trước khi lưu

`validate_feed(url)` được gọi trước `add_source_entry`/`add_user_source` ở cả `/api/sources` (POST) và `/api/admin/sources` (POST) — thử fetch + parse XML thật, báo lỗi ngay nếu URL không phải RSS hợp lệ. Không bỏ qua bước này khi thêm route mới liên quan đến thêm nguồn tin.
