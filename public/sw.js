// Service worker cho bản cài trên điện thoại (PWA).
// Chiến lược: luôn lấy mạng trước (giá/tin phải mới), mất mạng mới dùng
// bản đã lưu lần cuối để app vẫn mở được và hiện dữ liệu gần nhất.
const CACHE = "stockpeek-v1";
const SHELL = ["/", "/style.css", "/app.js", "/manifest.webmanifest", "/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  // Không đụng tới request ghi dữ liệu, đăng nhập (OAuth redirect) hay domain khác.
  if (req.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/auth/") || url.pathname.startsWith("/api/auth/") || url.pathname.startsWith("/api/admin/")) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(async () => {
        const hit = await caches.match(req);
        if (hit) return hit;
        if (req.mode === "navigate") return caches.match("/");
        return Response.error();
      })
  );
});
