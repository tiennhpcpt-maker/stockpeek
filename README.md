# stockPeek

Trang xem giá cổ phiếu Việt Nam (real-time) + tin tức thị trường, phong cách feed dạng card. Backend chỉ dùng Python thư viện chuẩn (không cần cài gì thêm).

## Chạy trên máy (local)

```bash
python3 server.py
```

Mở `http://127.0.0.1:8787`.

## Đưa lên mạng miễn phí (Render.com) — có địa chỉ dạng `stockpeek.onrender.com`

Render có gói **Free** cho web service, không tốn tiền, nhưng sẽ "ngủ" sau 15 phút không ai truy cập (lần mở lại đầu tiên sau đó sẽ chậm khoảng 30-50 giây để khởi động lại).

**Bước 1 — Đưa code lên GitHub** (repo public, miễn phí):
1. Vào [github.com](https://github.com), tạo tài khoản nếu chưa có.
2. Bấm **New repository**, đặt tên vd. `stockpeek`, để **Public**, không tick thêm README/gitignore (đã có sẵn) → **Create repository**.
3. Trong thư mục dự án này, chạy (thay `<your-username>` bằng tên GitHub của bạn):

```bash
cd ~/Desktop/stock-peek
git init
git add .
git commit -m "stockPeek: xem giá CK + tin tức"
git branch -M main
git remote add origin https://github.com/<your-username>/stockpeek.git
git push -u origin main
```

**Bước 2 — Deploy trên Render**:
1. Vào [render.com](https://render.com), đăng ký tài khoản miễn phí (có thể đăng nhập bằng GitHub cho nhanh).
2. Bấm **New +** → **Blueprint** → chọn repo `stockpeek` vừa tạo. Render sẽ tự đọc file `render.yaml` trong repo và điền sẵn cấu hình (Free plan, start command `python3 server.py`).
   - Nếu Render không tự nhận Blueprint, chọn **New +** → **Web Service** → chọn repo → điền tay: Environment = Python 3, Build Command = để trống, Start Command = `python3 server.py`, Plan = Free.
3. Bấm **Deploy**. Đợi 2-3 phút build xong.
4. Địa chỉ trang sẽ là `https://stockpeek.onrender.com` (nếu tên đã có người dùng, Render sẽ tự thêm hậu tố, ví dụ `stockpeek-abcd.onrender.com`).

Từ lúc đó, ai cũng truy cập được trang qua địa chỉ này, không cần mở máy của bạn.

## Giới hạn cần biết

- Dữ liệu giá lấy từ bảng giá công khai của VPS, tin tức từ RSS 24hMoney/VnEconomy — đây là API công khai không chính thức, có thể thay đổi/ngừng hoạt động bất kỳ lúc nào.
- Gói Free của Render tự ngủ sau 15 phút không có truy cập.
- Muốn tên miền ".vn" hoặc tên miền riêng thật (vd. `chungkhoancuatoi.vn`) thì phải mua qua nhà đăng ký tên miền (có phí hàng năm), sau đó trỏ DNS về địa chỉ Render — không có tuỳ chọn ".vn" miễn phí.
