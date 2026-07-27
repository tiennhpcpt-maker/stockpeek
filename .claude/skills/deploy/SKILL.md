---
name: deploy
description: Đưa thay đổi code của stockPeek (thư mục /Users/nguyenhuutien/Desktop/stock-peek) lên production tại stockpeek.onrender.com — commit, push lên GitHub, bấm Manual Deploy trên Render, rồi xác nhận đã lên production thật. Dùng skill này bất cứ khi nào người dùng nói "deploy", "đưa lên production", "push lên Render", "cập nhật trang live", "lên bản mới", hoặc sau khi vừa sửa xong code stockPeek và có vẻ muốn thấy thay đổi trên trang thật — kể cả khi họ chỉ nói ngắn gọn "làm luôn" hay "lên đi" sau một thay đổi code. Không dùng cho việc chỉ sửa code mà chưa muốn public.
---

# Deploy stockPeek lên production

Quy trình này có nhiều bước con người dễ quên hoặc làm sai thứ tự (quên fetch trước khi push, tưởng Render tự deploy, quên force-reload khi kiểm tra) — skill này gộp lại đúng thứ tự đã được kiểm chứng nhiều lần trong thực tế.

## Bối cảnh cần biết trước khi chạy

- **Render KHÔNG tự deploy khi có commit mới.** Repo kết nối kiểu "Public Git Repository" (không phải GitHub App tích hợp), nên push code xong vẫn phải tự vào dashboard bấm Manual Deploy. Đừng báo "đã deploy xong" chỉ vì đã push — phải thực sự bấm nút và đợi build.
- **Remote hay có commit mới không phải do bạn tạo ra.** Repo này có 2 GitHub Actions chạy nền: cập nhật `market_overview.json` 2 lần/ngày (workflow tự commit), và ping keep-alive mỗi 10 phút (không commit). Vì vậy trước khi push luôn phải fetch + rebase, nếu không sẽ bị `remote rejected`.
- **Không tự nhập mật khẩu Render/GitHub hộ người dùng.** Nếu tab trình duyệt bị đăng xuất, dừng lại và nhờ người dùng tự đăng nhập rồi báo lại — đây là giới hạn an toàn, không phải lỗi cần khắc phục bằng cách khác.
- **`.github/workflows/*.yml` không push được bằng git thường** — PAT lưu trên Render thiếu quyền `workflow`. Nếu thay đổi có đụng đến file trong thư mục này, phải tạo/sửa qua giao diện web GitHub (xem `.claude/docs/architecture.md` nếu cần thêm chi tiết).

## Các bước

### 1. Kiểm tra có gì để deploy không

```bash
cd /Users/nguyenhuutien/Desktop/stock-peek && git status --short
```

Nếu working tree sạch VÀ không có commit nào ở local chưa push (`git log origin/main..HEAD --oneline` rỗng) — nghĩa là không có gì mới để deploy. Báo lại cho người dùng thay vì bấm Manual Deploy vô ích.

### 2. Commit thay đổi đang chờ (nếu có)

Xem lại diff, viết commit message tiếng Việt ngắn gọn nêu rõ "vì sao" đổi (theo đúng phong cách các commit trước đó trong repo — `git log --oneline -10` để tham khảo giọng văn). Add từng file liên quan, không dùng `git add -A` tràn lan.

### 3. Đồng bộ với remote trước khi push

```bash
git fetch origin && git log origin/main --oneline -3
```

Nếu `origin/main` có commit mới không nằm trong lịch sử local (thường là "Tu dong cap nhat nhan dinh thi truong ..."):

```bash
git pull --rebase origin main
```

Rebase thay vì merge để lịch sử commit thẳng, không tạo merge commit rác.

### 4. Push

```bash
git push origin main
```

Không dùng `--force` trong quy trình này — nếu push bị reject vì lý do khác ngoài việc thiếu rebase (ví dụ động vào `.github/workflows/`), dừng lại và xử lý đúng nguyên nhân thay vì ép push.

### 5. Vào Render bấm Manual Deploy

- Mở `https://dashboard.render.com`
- Nếu bị yêu cầu đăng nhập: dừng lại, nhờ người dùng tự đăng nhập, đợi họ xác nhận xong mới tiếp tục (không nhập mật khẩu hộ).
- Vào service **stockpeek** (Service ID: `srv-d9g804r7uimc73eir200`, nếu list ở trang Overview trống thì cuộn xuống hoặc gõ tên vào ô tìm kiếm).
- Kiểm tra commit hash hiện tại của service so với commit vừa push — nếu đã trùng rồi (ai đó vừa deploy) thì báo lại thay vì bấm lại.
- Bấm **Manual Deploy → Deploy latest commit**.

### 6. Đợi build xong

Build thường mất 60-90 giây. Dùng `ScheduleWakeup` (khoảng 90 giây) thay vì tự chờ block trong turn — kèm prompt mô tả rõ cần kiểm tra gì khi tỉnh dậy (deploy đã Live chưa, cần verify gì trên production).

Khi tỉnh dậy, vào lại trang service, xác nhận trạng thái chuyển thành **Live** với đúng commit hash vừa push. Nếu vẫn "Building" quá lâu (>3 phút), kiểm tra log build xem có lỗi không trước khi báo người dùng.

### 7. Xác nhận trên production thật

```
mcp__Claude_Browser__navigate → https://stockpeek.onrender.com, force: true
```

**Luôn force reload** — trình duyệt hay cache bản HTML/JS cũ, khiến trang trông như "chưa deploy" dù thực ra đã lên rồi. Kiểm tra đúng phần vừa thay đổi (chụp ảnh hoặc đọc DOM/console tuỳ loại thay đổi), không chỉ nhìn trang load được là đủ.

### 8. Báo kết quả

Ngắn gọn: commit hash nào đã lên Live, đã verify được gì trên production. Nếu có bước phải dừng lại chờ người dùng (đăng nhập lại Render/GitHub), nói rõ đang chờ gì.

## Khi nào KHÔNG áp dụng skill này

- Người dùng chỉ muốn sửa code, chưa nói gì tới việc đưa lên trang thật → sửa xong thì hỏi có muốn deploy không, đừng tự động chạy hết quy trình này.
- Thay đổi chỉ nằm trong `.claude/`, `README.md`, hoặc tài liệu nội bộ không ảnh hưởng gì tới `public/` hay `server.py` → deploy vẫn chạy được nhưng thường không cần thiết, hỏi lại nếu không chắc.
