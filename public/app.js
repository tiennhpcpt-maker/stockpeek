const STORAGE_KEY = "stockpeek_watchlist";
const DEFAULT_TICKERS = ["VIC", "VNM", "FPT", "VCB", "HPG"];
const QUOTES_INTERVAL_MS = 15000;
const LIVE_NEWS_INTERVAL_MS = 60 * 1000;
const HOT_NEWS_INTERVAL_MS = 60 * 1000;
const INDICES_INTERVAL_MS = 30000;
const SECTOR_INTERVAL_MS = 60 * 1000;

let sources = [];
let currentUser = null;

function buildSparklinePath(series, width, height) {
  if (!series || series.length < 2) return "";
  const min = Math.min(...series);
  const max = Math.max(...series);
  const range = max - min || 1;
  const stepX = width / (series.length - 1);
  return series
    .map((v, i) => {
      const x = i * stepX;
      const y = height - ((v - min) / range) * height;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

function renderSparkline(series, isUp) {
  const w = 90;
  const h = 34;
  if (!series || series.length < 2) {
    return `<svg width="${w}" height="${h}"></svg>`;
  }
  const path = buildSparklinePath(series, w, h);
  const color = isUp ? "var(--up)" : "var(--down)";
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <path d="${path}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" />
  </svg>`;
}

async function refreshIndices() {
  const grid = document.getElementById("indicesGrid");
  try {
    const res = await fetch("/api/indices");
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || "lỗi không xác định");
    renderIndices(json.data);
    document.getElementById("indicesUpdated").textContent =
      "Cập nhật " + new Date(json.ts * 1000).toLocaleTimeString("vi-VN");
  } catch (e) {
    grid.innerHTML = `<div class="empty">Lỗi lấy dữ liệu chỉ số: ${e.message}</div>`;
  }
}

function renderIndices(list) {
  const grid = document.getElementById("indicesGrid");
  grid.innerHTML = list
    .map((idx) => {
      if (idx.error) {
        return `<div class="index-card">
          <div class="index-name">${idx.name}</div>
          <div class="empty">Không lấy được dữ liệu</div>
        </div>`;
      }
      const isUp = idx.change > 0;
      const isFlat = idx.change === 0;
      const statusClass = isFlat ? "status-ref" : isUp ? "status-up" : "status-down";
      const sign = idx.change > 0 ? "+" : "";
      const hasNet = idx.foreignNet !== null && idx.foreignNet !== undefined;
      const netSign = hasNet && idx.foreignNet > 0 ? "+" : "";
      return `<div class="index-card">
        <div class="index-top">
          <div class="index-name">${idx.name}</div>
          ${renderSparkline(idx.series, isUp)}
        </div>
        <div class="index-value-row">
          <span class="index-value ${statusClass}">${idx.value.toLocaleString("vi-VN")}</span>
          <span class="index-change ${statusClass}">${sign}${idx.change} (${sign}${idx.changePct}%)</span>
        </div>
        <div class="index-meta">
          <span>GTGD (tỷ đồng)</span><span class="index-meta-val">${(idx.tradingValue ?? 0).toLocaleString("vi-VN")}</span>
        </div>
        <div class="index-meta">
          <span>NĐTNN - GT ròng (tỷ đồng)</span><span class="index-meta-val">${hasNet ? netSign + idx.foreignNet.toLocaleString("vi-VN") : "—"}</span>
        </div>
      </div>`;
    })
    .join("");
}

function loadWatchlist() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return DEFAULT_TICKERS.slice();
}

function saveWatchlist(list) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

let watchlist = loadWatchlist();

function fmtVnd(n) {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString("vi-VN");
}

function fmtVol(n) {
  if (n === null || n === undefined) return "—";
  return Number(n).toLocaleString("vi-VN");
}

function timeAgo(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const diffMs = Date.now() - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "vừa xong";
  if (mins < 60) return `${mins} phút trước`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} giờ trước`;
  const days = Math.floor(hours / 24);
  return `${days} ngày trước`;
}

async function refreshQuotes() {
  const grid = document.getElementById("watchlistGrid");
  if (watchlist.length === 0) {
    grid.innerHTML = '<div class="empty">Chưa có mã nào trong danh mục theo dõi.</div>';
    return;
  }
  try {
    const res = await fetch(`/api/quotes?tickers=${encodeURIComponent(watchlist.join(","))}`);
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || "lỗi không xác định");
    renderWatchlist(json.data);
    document.getElementById("quotesUpdated").textContent =
      "Cập nhật " + new Date(json.ts * 1000).toLocaleTimeString("vi-VN");
  } catch (e) {
    document.getElementById("quotesUpdated").textContent = "Lỗi lấy giá: " + e.message;
  }
}

function renderWatchlist(data) {
  const grid = document.getElementById("watchlistGrid");
  const byTicker = {};
  data.forEach((d) => (byTicker[d.ticker] = d));

  grid.innerHTML = watchlist
    .map((t) => {
      const d = byTicker[t];
      if (!d) {
        return `<div class="stock-card" data-ticker="${escapeHtml(t)}">
          <button class="remove">✕</button>
          <div class="ticker">${escapeHtml(t)}</div>
          <div class="empty">Không có dữ liệu</div>
        </div>`;
      }
      const sign = d.change > 0 ? "+" : "";
      return `<div class="stock-card" data-ticker="${escapeHtml(t)}">
        <button class="remove">✕</button>
        <div class="ticker">${escapeHtml(d.ticker)}</div>
        <div class="price status-${d.status}">${fmtVnd(d.last)}</div>
        <div class="change status-${d.status}">${sign}${fmtVnd(d.change)} (${sign}${d.changePct}%)</div>
        <div class="meta">
          <span>Cao: ${fmtVnd(d.high)}</span>
          <span>Thấp: ${fmtVnd(d.low)}</span>
          <span>KL: ${fmtVol(d.volume)}</span>
          <span>TC: ${fmtVnd(d.ref)}</span>
        </div>
      </div>`;
    })
    .join("");
  grid.querySelectorAll(".stock-card .remove").forEach((btn) => {
    btn.addEventListener("click", () => removeTicker(btn.closest(".stock-card").dataset.ticker));
  });
}

async function removeTicker(t) {
  if (currentUser) {
    try {
      const res = await fetch(`/api/watchlist?ticker=${encodeURIComponent(t)}`, { method: "DELETE" });
      const json = await res.json();
      if (json.ok) watchlist = json.data;
    } catch (e) {}
  } else {
    watchlist = watchlist.filter((x) => x !== t);
    saveWatchlist(watchlist);
  }
  refreshQuotes();
}

async function addTicker() {
  const input = document.getElementById("tickerInput");
  const raw = input.value.trim().toUpperCase();
  if (!raw) return;
  const tickers = raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  if (currentUser) {
    for (const t of tickers) {
      try {
        const res = await fetch("/api/watchlist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ticker: t }),
        });
        const json = await res.json();
        if (json.ok) watchlist = json.data;
      } catch (e) {}
    }
  } else {
    tickers.forEach((t) => {
      if (t && !watchlist.includes(t)) watchlist.push(t);
    });
    saveWatchlist(watchlist);
  }
  input.value = "";
  refreshQuotes();
}

// "Tin nóng": 3 tin được nhiều nguồn cùng đưa tin nhất (tín hiệu độ nóng
// không cần AI — càng nhiều báo cùng đăng thì tin càng đáng chú ý), làm mới
// mỗi giờ. "Tin trực tiếp": 10 tin mới nhất theo thời gian, làm mới 15 phút/lần.
// Tin tức chia 2 chuyên mục độc lập ("stock"/"tech"), mỗi chuyên mục có DOM
// riêng (NEWS_DOM) và gọi /api/news?category=... riêng.

const NEWS_DOM = {
  stock: {
    hotList: "hotNewsList",
    hotUpdated: "hotNewsUpdated",
    liveList: "liveNewsList",
    liveUpdated: "liveNewsUpdated",
  },
  tech: {
    hotList: "hotNewsListTech",
    hotUpdated: "hotNewsUpdatedTech",
    liveList: "liveNewsListTech",
    liveUpdated: "liveNewsUpdatedTech",
  },
};

async function refreshHotNews(category = "stock") {
  const dom = NEWS_DOM[category];
  const list = document.getElementById(dom.hotList);
  try {
    const res = await fetch(`/api/news?category=${category}`);
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || "lỗi không xác định");
    const ranked = json.data
      .filter((it) => it.title)
      .slice()
      .sort((a, b) => b.sourceCount - a.sourceCount || _pubTs(b.pubDate) - _pubTs(a.pubDate))
      .slice(0, 3);
    renderHotNews(ranked, category);
    document.getElementById(dom.hotUpdated).textContent =
      "Cập nhật " + new Date().toLocaleTimeString("vi-VN");
  } catch (e) {
    list.innerHTML = `<div class="empty">Lỗi lấy tin tức: ${e.message}</div>`;
  }
}

function refreshAllHotNews() {
  refreshHotNews("stock");
  refreshHotNews("tech");
}

function _pubTs(pubDate) {
  const t = new Date(pubDate).getTime();
  return isNaN(t) ? 0 : t;
}

// Tin tức (title/summary/link) đến từ RSS của nguồn do người dùng (kể cả
// người chưa đăng nhập) thêm vào -> phải coi là dữ liệu KHÔNG đáng tin,
// escape trước khi chèn innerHTML và chỉ cho phép link http/https.
function safeUrl(url) {
  try {
    const u = new URL(url, window.location.origin);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : "#";
  } catch (e) {
    return "#";
  }
}

function renderHotNews(items, category = "stock") {
  const list = document.getElementById(NEWS_DOM[category].hotList);
  if (items.length === 0) {
    list.innerHTML = '<div class="empty">Chưa có tin nào.</div>';
    return;
  }
  list.innerHTML = items
    .map((it, i) => {
      const chips = it.sources
        .map((s) => `<span class="source-chip">📰 ${escapeHtml(s.source)}</span>`)
        .join("");
      const multiBadge =
        it.sourceCount > 1 ? `<span class="multi-badge">${it.sourceCount} nguồn đưa tin</span>` : "";
      const detailId = `news-detail-${category}-${i}`;
      const detailItems = it.sources
        .map(
          (s) => `<div class="sources-detail-item">
            <span><span class="sdi-source">${escapeHtml(s.source)}</span><span class="sdi-title">${escapeHtml(s.title)}</span></span>
            <a href="${escapeHtml(safeUrl(s.link))}" target="_blank" rel="noopener">Mở bài gốc ↗</a>
          </div>`
        )
        .join("");
      return `<div class="news-card">
        <div class="source-row">${chips}${multiBadge}<span>· ${timeAgo(it.pubDate)}</span></div>
        <div class="title">${escapeHtml(it.title)}</div>
        ${it.summary ? `<div class="summary">${escapeHtml(it.summary)}</div>` : ""}
        <button class="link-out" data-detail-id="${detailId}">Xem nguồn đưa tin →</button>
        <div class="sources-detail" id="${detailId}">
          <div class="sources-detail-label">Nguồn đưa tin · ${it.sourceCount}</div>
          ${detailItems}
        </div>
      </div>`;
    })
    .join("");
  list.querySelectorAll(".link-out").forEach((btn) => {
    btn.addEventListener("click", () => toggleNewsDetail(btn.dataset.detailId));
  });
}

function toggleNewsDetail(id) {
  const el = document.getElementById(id);
  if (el) el.classList.toggle("open");
}

async function refreshLiveNews(category = "stock") {
  const dom = NEWS_DOM[category];
  const list = document.getElementById(dom.liveList);
  try {
    const res = await fetch(`/api/news?category=${category}`);
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || "lỗi không xác định");
    const latest = json.data
      .filter((it) => it.title)
      .slice()
      .sort((a, b) => _pubTs(b.pubDate) - _pubTs(a.pubDate))
      .slice(0, 10);
    renderLiveNews(latest, category);
    document.getElementById(dom.liveUpdated).textContent =
      "Cập nhật " + new Date().toLocaleTimeString("vi-VN");
  } catch (e) {
    list.innerHTML = `<div class="empty">Lỗi lấy tin tức: ${e.message}</div>`;
  }
}

function refreshAllLiveNews() {
  refreshLiveNews("stock");
  refreshLiveNews("tech");
}

// Tab chuyển đổi giữa 2 luồng tin — chỉ ẩn/hiện DOM, cả 2 category vẫn được
// làm mới nền theo interval (xem refreshAllHotNews/refreshAllLiveNews) để
// chuyển tab không phải chờ tải lại.
function switchNewsCategory(category) {
  document.querySelectorAll(".news-group").forEach((el) => {
    el.hidden = el.dataset.category !== category;
  });
  document.querySelectorAll(".news-tab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.category === category);
  });
}

function renderLiveNews(items, category = "stock") {
  const list = document.getElementById(NEWS_DOM[category].liveList);
  if (items.length === 0) {
    list.innerHTML = '<div class="empty">Chưa có tin nào.</div>';
    return;
  }
  list.innerHTML = items
    .map((it) => {
      const primary = it.sources[0];
      const sourceLabel = escapeHtml(
        it.sourceCount > 1 ? `${primary.source} +${it.sourceCount - 1}` : primary.source
      );
      return `<div class="live-news-item">
        <a class="live-news-title" href="${escapeHtml(safeUrl(primary.link))}" target="_blank" rel="noopener">${escapeHtml(it.title)}</a>
        <div class="live-news-meta">${sourceLabel} · ${timeAgo(it.pubDate)}</div>
      </div>`;
    })
    .join("");
}

async function refreshSources() {
  try {
    const res = await fetch("/api/sources");
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || "lỗi không xác định");
    sources = json.data;
    renderSources();
    document.getElementById("resetSourcesBtn").hidden = !json.personal;
  } catch (e) {
    document.getElementById("sourcesList").innerHTML =
      `<div class="empty">Lỗi lấy danh sách nguồn: ${e.message}</div>`;
  }
}

async function resetSources() {
  const errBox = document.getElementById("sourceError");
  errBox.textContent = "";
  const btn = document.getElementById("resetSourcesBtn");
  btn.disabled = true;
  try {
    const res = await fetch("/api/sources/reset", { method: "POST" });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || "lỗi không xác định");
    sources = json.data;
    renderSources();
    refreshAllLiveNews();
    refreshAllHotNews();
  } catch (e) {
    errBox.textContent = e.message;
  } finally {
    btn.disabled = false;
  }
}

function renderSources() {
  const list = document.getElementById("sourcesList");
  if (!sources.length) {
    list.innerHTML = '<div class="empty">Chưa có nguồn tin nào.</div>';
    return;
  }
  list.innerHTML = sources
    .map(
      (s) => `<div class="source-manage-row">
        <span class="source-name">${escapeHtml(s.name)}</span>
        <span class="source-category-badge">${s.category === "tech" ? "💻 Công nghệ" : "📊 Chứng khoán"}</span>
        ${s.lang && s.lang !== "vi" ? '<span class="source-lang-badge">Dịch → VI</span>' : ""}
        <span class="source-url">${escapeHtml(s.url)}</span>
        <button class="source-remove" data-name="${escapeHtml(s.name)}">Xoá</button>
      </div>`
    )
    .join("");
  list.querySelectorAll(".source-remove").forEach((btn) => {
    btn.addEventListener("click", () => removeSource(btn.dataset.name));
  });
}

async function addSource() {
  const nameInput = document.getElementById("sourceNameInput");
  const urlInput = document.getElementById("sourceUrlInput");
  const foreignCheck = document.getElementById("sourceForeignCheck");
  const categoryInput = document.querySelector('input[name="sourceCategory"]:checked');
  const errBox = document.getElementById("sourceError");
  const name = nameInput.value.trim();
  const url = urlInput.value.trim();
  const foreign = foreignCheck.checked;
  const category = categoryInput ? categoryInput.value : "stock";
  errBox.textContent = "";
  if (!name || !url) {
    errBox.textContent = "Nhập đủ tên nguồn và URL RSS.";
    return;
  }
  const btn = document.getElementById("addSourceBtn");
  btn.disabled = true;
  btn.textContent = "Đang kiểm tra...";
  try {
    const res = await fetch("/api/sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, url, foreign, category }),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || "lỗi không xác định");
    sources = json.data;
    renderSources();
    nameInput.value = "";
    urlInput.value = "";
    foreignCheck.checked = false;
    document.querySelector('input[name="sourceCategory"][value="stock"]').checked = true;
    refreshAllLiveNews();
    refreshAllHotNews();
  } catch (e) {
    errBox.textContent = e.message;
  } finally {
    btn.disabled = false;
    btn.textContent = "+ Thêm nguồn";
  }
}

async function removeSource(name) {
  try {
    const res = await fetch(`/api/sources?name=${encodeURIComponent(name)}`, { method: "DELETE" });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || "lỗi không xác định");
    sources = json.data;
    renderSources();
    refreshAllLiveNews();
    refreshAllHotNews();
  } catch (e) {
    document.getElementById("sourceError").textContent = e.message;
  }
}

// ===================== Dữ liệu dự phòng phía trình duyệt =====================
// Bản tin/báo cáo/ngành tải thành công thì lưu vào localStorage; lần sau server
// lỗi hoặc mất mạng thì hiện bản đã lưu kèm ghi chú, thay vì để trống.
const OFFLINE_KEY_PREFIX = "stockpeek.cache.";

async function fetchWithFallback(name, url) {
  try {
    const res = await fetch(url);
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || "lỗi không xác định");
    try {
      localStorage.setItem(OFFLINE_KEY_PREFIX + name, JSON.stringify({ savedAt: Date.now(), data: json.data }));
    } catch (e) {}
    return { data: json.data, savedAt: null };
  } catch (err) {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(OFFLINE_KEY_PREFIX + name) || "null"); } catch (e) {}
    if (saved && saved.data) return { data: saved.data, savedAt: saved.savedAt };
    throw err;
  }
}

// Ghi chú hiện trên đầu khối khi dữ liệu không phải bản mới nhất từ máy chủ.
function fallbackNotice(savedAt, dataSource) {
  if (savedAt) {
    return `<div class="overview-stale">⚠️ Không kết nối được máy chủ — đang hiện dữ liệu đã lưu lúc ${new Date(savedAt).toLocaleString("vi-VN")}.</div>`;
  }
  if (dataSource && dataSource !== "github") {
    return '<div class="overview-stale">⚠️ Máy chủ tạm không đọc được dữ liệu mới nhất — đang hiện bản dự phòng, có thể thiếu bài vừa đăng.</div>';
  }
  return "";
}

// ===================== Tab Thị trường: nhận định =====================
// Nhận định lấy từ bản tin Claude mới nhất (tổng hợp báo cáo các CTCK, xem
// get_market_view() trong server.py); chưa có bản tin gần đây thì hiện tóm tắt
// báo cáo tự động gần nhất. Số liệu chỉ số nằm ở khối "Thị trường chứng khoán" ngay trên.
async function refreshMarketOverview() {
  const box = document.getElementById("overviewContent");
  try {
    const { data, savedAt } = await fetchWithFallback("market", "/api/market-overview");
    renderMarketOverview(data || {}, savedAt);
  } catch (e) {
    box.innerHTML = '<div class="empty">Chưa tải được nhận định thị trường.</div>';
  }
}

function isTodayVN(dateStr) {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Ho_Chi_Minh" });
  return dateStr === today;
}

function renderMarketOverview(data, savedAt) {
  const box = document.getElementById("overviewContent");
  const updatedEl = document.getElementById("overviewUpdated");
  const list = (arr) => (arr || []).map((x) => `<li>${escapeHtml(x)}</li>`).join("");
  const a = data.analysis;
  if (a) {
    updatedEl.textContent = a.generated_at ? "Lập lúc " + new Date(a.generated_at).toLocaleString("vi-VN") : "";
    const stale = data.stale
      ? `<div class="overview-stale">⚠️ Bản tin phân tích đã lâu chưa được cập nhật — đang hiện bản tin ngày ${fmtReportDate(a.date)}, chỉ nên tham khảo. Số liệu mới nhất xem ở khối tóm tắt tự động bên dưới.</div>`
      : !isTodayVN(a.date)
        ? `<div class="overview-stale">Chưa có bản tin hôm nay — đang hiện bản tin ngày ${fmtReportDate(a.date)}.</div>`
        : "";
    const autoBlock = data.stale && data.auto
      ? `<div class="overview-block"><div class="overview-block-title">Tóm tắt tự động mới nhất · ${escapeHtml(data.auto.title || "")}</div><div class="overview-summary">${escapeHtml(data.auto.summary || "")}</div></div>`
      : "";
    box.innerHTML = `
      ${fallbackNotice(savedAt, data.dataSource)}
      ${stale}
      ${autoBlock}
      <div class="overview-source">${analysisKind(a).badge || "📧 Bản tin"} · ${escapeHtml(a.title || "")}</div>
      ${a.summary ? `<div class="overview-summary">${escapeHtml(a.summary)}</div>` : ""}
      ${list(a.key_findings) ? `<div class="overview-block"><div class="overview-block-title">Điểm chính</div><ul class="overview-list">${list(a.key_findings)}</ul></div>` : ""}
      ${(a.sections || [])
        .map((sec) => `<div class="overview-block"><div class="overview-block-title">${escapeHtml(sec.title || "")}</div><ul class="overview-list">${list(sec.items)}</ul></div>`)
        .join("")}
      ${list(a.action_items) ? `<div class="overview-block"><div class="overview-block-title">Việc nên làm</div><ul class="overview-list">${list(a.action_items)}</ul></div>` : ""}
      ${a.sources?.length ? `<div class="report-meta">Nguồn: ${escapeHtml(a.sources.join(", "))}</div>` : ""}
      <a href="#" class="overview-more" data-goto="report">Xem bản đầy đủ và các ngày trước trong tab Báo cáo →</a>
      ${a.disclaimer ? `<p class="overview-disclaimer">${escapeHtml(a.disclaimer)}</p>` : ""}
    `;
  } else if (data.auto) {
    const r = data.auto;
    updatedEl.textContent = r.generated_at ? "Tạo tự động lúc " + new Date(r.generated_at).toLocaleString("vi-VN") : "";
    box.innerHTML = `
      ${fallbackNotice(savedAt, data.dataSource)}
      <div class="overview-stale">Chưa có bản tin phân tích gần đây — đang hiện tóm tắt tự động (${escapeHtml(r.title || "")}).</div>
      <div class="overview-summary">${escapeHtml(r.summary || "")}</div>
      <a href="#" class="overview-more" data-goto="report">Xem chi tiết trong tab Báo cáo →</a>
      ${r.disclaimer ? `<p class="overview-disclaimer">${escapeHtml(r.disclaimer)}</p>` : ""}
    `;
  } else {
    updatedEl.textContent = "—";
    box.innerHTML = '<div class="empty">Chưa có nhận định thị trường.</div>';
  }
}

// ===================== Tab Ngành: bảng ngành trực tiếp =====================
// Tính từ giá khớp lệnh trên server (get_live_sectors(), cache 30s) — cùng hàm
// thống kê với báo cáo cuối phiên nên 2 nơi không lệch số. Trước giờ mở cửa
// server trả bảng ngành của phiên trước (live = false, asOf = ngày phiên đó).
async function refreshSectorAnalysis() {
  const grid = document.getElementById("sectorGrid");
  try {
    const { data, savedAt } = await fetchWithFallback("sector", "/api/sector-analysis");
    renderSectorAnalysis(data, savedAt);
  } catch (e) {
    if (!grid.querySelector(".sector-card")) {
      grid.innerHTML = `<div class="empty">Chưa tải được dữ liệu nhóm ngành.</div>`;
    }
  }
}

function renderSectorAnalysis(data, savedAt) {
  const grid = document.getElementById("sectorGrid");
  document.getElementById("sectorDisclaimer").textContent = data.disclaimer || "";
  const when = data.generated_at ? new Date(data.generated_at).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }) : "";
  document.getElementById("sectorUpdated").textContent = data.live
    ? `${data.statusLabel || ""} · cập nhật ${when}`
    : `${data.statusLabel || ""} · số liệu phiên ${fmtReportDate(data.asOf)}`;
  let notice = fallbackNotice(savedAt, data.dataSource);
  if (!savedAt && data.legacy) {
    notice += `<div class="overview-stale">⚠️ Chưa lấy được giá — đang hiện bảng ngành dự phòng ngày ${fmtReportDate(data.asOf)}.</div>`;
  }

  const views = data.views || {};
  const notes = views.tickerNotes || {};
  const viewByName = new Map((views.items || []).map((v) => [v.name, v.view]));
  const noteSource = views.date ? `Bản tin ${fmtReportDate(views.date)}` : "Bản tin";

  const sectors = data.sectors || [];
  if (!sectors.length) {
    grid.innerHTML = '<div class="empty">Chưa có dữ liệu.</div>';
    return;
  }
  grid.innerHTML = (notice ? `<div class="sector-notice">${notice}</div>` : "") + sectors
    .map((s) => {
      const tickers = s.tickers || (s.leader ? [s.leader] : []);
      const chips = tickers
        .map((t) => `<span class="report-chip${notes[t.ticker] ? " has-note" : ""}"><b>${escapeHtml(t.ticker)}</b><span class="${pctClass(t.changePct)}">${fmtPct(t.changePct)}</span></span>`)
        .join("");
      const noteRows = tickers
        .filter((t) => notes[t.ticker])
        .map((t) => `<div class="sector-pick"><span class="pick-ticker">${escapeHtml(t.ticker)}</span><span class="pick-reason">${escapeHtml(notes[t.ticker])}<span class="pick-source">Nguồn: ${escapeHtml(noteSource)}</span></span></div>`)
        .join("");
      const view = viewByName.get(s.name);
      return `<div class="sector-card">
        <div class="sector-head">
          <div class="sector-name">${escapeHtml(s.name)}</div>
          ${s.avgChangePct != null ? `<div class="sector-avg ${pctClass(s.avgChangePct)}">${fmtPct(s.avgChangePct)}</div>` : ""}
        </div>
        <div class="sector-outlook">${s.total != null ? `${s.up}/${s.total} mã tăng${s.down ? `, ${s.down} mã giảm` : ""}` : escapeHtml(s.outlook || "")}</div>
        <div class="report-chips">${chips}</div>
        ${view ? `<div class="sector-view">📧 ${escapeHtml(view)}<span class="pick-source">Nguồn: ${escapeHtml(noteSource)}</span></div>` : ""}
        ${noteRows}
      </div>`;
    })
    .join("");
  // Nhận định cho ngành không có thẻ (tên lệch danh sách SECTOR_TICKERS) vẫn hiện, không bị mất.
  const shown = new Set(sectors.map((s) => s.name));
  const extra = (views.items || []).filter((v) => v.view && !shown.has(v.name));
  if (extra.length) {
    grid.insertAdjacentHTML(
      "beforeend",
      `<div class="sector-card"><div class="sector-name">📧 Nhận định ngành khác (${escapeHtml(noteSource)})</div>
        <ul class="overview-list">${extra.map((v) => `<li><b>${escapeHtml(v.name)}:</b> ${escapeHtml(v.view)}</li>`).join("")}</ul></div>`
    );
  }
}

// ===================== Báo cáo hàng ngày =====================
// reports: tạo tự động bởi server (8:30 + 16:00, xem generate_daily_report()).
// analyses: bài phân tích do Claude viết (scheduled task trên máy cá nhân push
// daily_analysis.json) — có thể có hoặc không cho từng ngày.
let dailyReportData = { reports: [], analyses: [] };
let dailyReportEntries = [];
let dailyReportNotice = "";

async function refreshDailyReports() {
  const box = document.getElementById("reportContent");
  try {
    const { data, savedAt } = await fetchWithFallback("reports", "/api/daily-reports");
    dailyReportData = data || { reports: [], analyses: [] };
    dailyReportNotice = fallbackNotice(savedAt, dailyReportData.dataSource);
    buildDailyReportEntries();
  } catch (e) {
    box.innerHTML = '<div class="empty">Chưa tải được báo cáo hàng ngày.</div>';
  }
}

function fmtReportDate(d) {
  const [y, m, day] = (d || "").split("-");
  return day ? `${day}/${m}/${y}` : d;
}

const ANALYSIS_KIND = {
  bulletin: { badge: "📧 Bản tin", label: "Bản tin" },
  weekly: { badge: "📅 Báo cáo tuần", label: "Báo cáo tuần" },
  monthly: { badge: "🗓️ Tổng kết tháng", label: "Tổng kết tháng" },
  company: { badge: "🏢 Phân tích doanh nghiệp", label: "Phân tích DN" },
};

// Nhãn theo loại bài; bản tin còn tách theo phiên gửi mail: trưa, chiều (bài cũ không có phiên = sáng).
const BULLETIN_SESSION_NAME = { midday: "trưa", afternoon: "chiều" };
function analysisKind(a) {
  const base = ANALYSIS_KIND[a && a.kind] || {};
  if (a && a.kind === "bulletin") {
    const name = BULLETIN_SESSION_NAME[a.session] || "sáng";
    return { badge: `📧 Bản tin ${name}`, label: `Bản tin ${name}` };
  }
  return base;
}

// Mỗi ngày là 1 mục: bản tin/bài phân tích Claude + báo cáo tự động 8:30 và 16:00.
function buildDailyReportEntries() {
  const select = document.getElementById("reportSelect");
  const prev = select.value;
  const byDate = new Map();
  const getEntry = (date) => {
    if (!byDate.has(date)) byDate.set(date, { key: date, date, morning: null, afternoon: null, analyses: [] });
    return byDate.get(date);
  };
  for (const r of dailyReportData.reports || []) {
    const e = getEntry(r.date);
    const slot = r.session === "afternoon" ? "afternoon" : "morning";
    if (!e[slot] || (r.generated_at || "") > (e[slot].generated_at || "")) e[slot] = r;
  }
  const kindOrder = { bulletin: 0, weekly: 1, monthly: 2, company: 3 };
  for (const a of dailyReportData.analyses || []) getEntry(a.date).analyses.push(a);
  for (const e of byDate.values()) {
    e.analyses.sort((x, y) => ((kindOrder[x.kind] ?? 9) - (kindOrder[y.kind] ?? 9)) || (y.generated_at || "").localeCompare(x.generated_at || ""));
  }
  const entries = [...byDate.values()].sort((a, b) => (a.date < b.date ? 1 : -1));
  dailyReportEntries = entries;

  if (!entries.length) {
    select.innerHTML = "";
    document.getElementById("reportContent").innerHTML =
      '<div class="empty">Chưa có báo cáo nào. Báo cáo đầu tiên sẽ được tạo lúc 8:30 hoặc 16:00 ngày giao dịch tới.</div>';
    return;
  }
  const entryLabel = (e) => {
    const parts = [...new Set(e.analyses.map((a) => analysisKind(a).label || "Phân tích"))];
    if (e.afternoon) parts.push("Cuối phiên");
    else if (e.morning) parts.push("Tin sáng");
    return parts.join(" + ");
  };
  select.innerHTML = entries
    .map((e) => `<option value="${escapeHtml(e.key)}">${fmtReportDate(e.date)} · ${escapeHtml(entryLabel(e))}</option>`)
    .join("");
  select.value = entries.some((e) => e.key === prev) ? prev : entries[0].key;
  renderDailyReport(select.value);
}

function pctClass(v) {
  return v > 0 ? "up-text" : v < 0 ? "down-text" : "ref-text";
}

function fmtPct(v) {
  if (v === null || v === undefined) return "—";
  return (v > 0 ? "+" : "") + Number(v).toLocaleString("vi-VN", { maximumFractionDigits: 2 }) + "%";
}

function renderReportMarket(market) {
  if (!market) return "";
  const indices = (market.indices || [])
    .map(
      (i) => `<div class="report-index">
        <div class="ri-name">${escapeHtml(i.name)}</div>
        <div class="ri-value">${Number(i.value).toLocaleString("vi-VN", { maximumFractionDigits: 2 })}</div>
        <div class="ri-change ${pctClass(i.change)}">${i.change > 0 ? "+" : ""}${Number(i.change).toLocaleString("vi-VN", { maximumFractionDigits: 2 })} (${fmtPct(i.changePct)})</div>
      </div>`
    )
    .join("");
  const sectors = (market.sectors || [])
    .map(
      (s) => `<tr>
        <td>${escapeHtml(s.name)}</td>
        <td class="num ${pctClass(s.avgChangePct)}">${fmtPct(s.avgChangePct)}</td>
        <td class="num">${s.up}/${s.total} tăng</td>
      </tr>`
    )
    .join("");
  const moverChips = (list) =>
    (list || [])
      .map((q) => `<span class="report-chip"><b>${escapeHtml(q.ticker)}</b><span class="${pctClass(q.changePct)}">${fmtPct(q.changePct)}</span></span>`)
      .join("");
  const volChips = (market.movers?.volume || [])
    .map((q) => `<span class="report-chip"><b>${escapeHtml(q.ticker)}</b>${fmtVol(q.volume)}</span>`)
    .join("");
  const mv = market.movers || {};
  return `
    ${indices ? `<div class="report-indices">${indices}</div>` : ""}
    <div class="report-cols">
      ${sectors ? `<div><div class="overview-block-title">Nhóm ngành (bình quân % thay đổi)</div><table class="report-table">${sectors}</table></div>` : ""}
      <div>
        ${mv.gainers?.length ? `<div class="overview-block"><div class="overview-block-title">Tăng mạnh</div><div class="report-chips">${moverChips(mv.gainers)}</div></div>` : ""}
        ${mv.losers?.length ? `<div class="overview-block"><div class="overview-block-title">Giảm mạnh</div><div class="report-chips">${moverChips(mv.losers)}</div></div>` : ""}
        ${volChips ? `<div class="overview-block"><div class="overview-block-title">Khối lượng lớn nhất</div><div class="report-chips">${volChips}</div></div>` : ""}
      </div>
    </div>`;
}

function renderReportNews(news) {
  if (!news || !news.length) return "";
  const items = news
    .map((n) => {
      const href = safeUrl(n.link);
      const title = escapeHtml(n.title);
      return `<li>${href ? `<a href="${href}" target="_blank" rel="noopener">${title}</a>` : title}
        <span class="rn-meta">${n.sourceCount} nguồn · ${escapeHtml((n.sources || []).join(", "))} · ${timeAgo(n.pubDate)}</span></li>`;
    })
    .join("");
  return `<div class="overview-block"><div class="overview-block-title">Tin nổi bật (nhiều nguồn cùng đưa)</div><ul class="report-news">${items}</ul></div>`;
}

function renderAnalysis(a) {
  const list = (arr) => (arr || []).map((x) => `<li>${escapeHtml(x)}</li>`).join("");
  const sectors = (a.sectors || [])
    .map((s) => `<li><b>${escapeHtml(s.name)}:</b> ${escapeHtml(s.view || "")}</li>`)
    .join("");
  const tickers = (a.tickers || [])
    .map((t) => `<div class="sector-pick"><span class="pick-ticker">${escapeHtml(t.ticker)}</span><span class="pick-reason">${escapeHtml(t.note || "")}</span></div>`)
    .join("");
  return `<div class="report-card report-ai">
    <span class="ai-badge">${analysisKind(a).badge || "🤖 Phân tích của Claude"}</span>
    <h3>${escapeHtml(a.title || "Phân tích thị trường")}</h3>
    <div class="report-meta">${a.generated_at ? "Lập lúc " + new Date(a.generated_at).toLocaleString("vi-VN") : ""}${a.origin ? " · " + escapeHtml(a.origin) : ""}</div>
    ${a.summary ? `<div class="report-summary">${escapeHtml(a.summary)}</div>` : ""}
    ${list(a.key_findings) ? `<div class="overview-block"><div class="overview-block-title">Điểm chính</div><ul class="overview-list">${list(a.key_findings)}</ul></div>` : ""}
    ${(a.sections || [])
      .map((sec) => `<div class="overview-block"><div class="overview-block-title">${escapeHtml(sec.title || "")}</div><ul class="overview-list">${list(sec.items)}</ul></div>`)
      .join("")}
    ${sectors ? `<div class="overview-block"><div class="overview-block-title">Nhóm ngành</div><ul class="overview-list">${sectors}</ul></div>` : ""}
    ${tickers ? `<div class="overview-block"><div class="overview-block-title">Mã đáng chú ý</div>${tickers}</div>` : ""}
    ${list(a.action_items) ? `<div class="overview-block"><div class="overview-block-title">Việc nên làm</div><ul class="overview-list">${list(a.action_items)}</ul></div>` : ""}
    ${a.sources?.length ? `<div class="report-meta">Nguồn: ${escapeHtml(a.sources.join(", "))}</div>` : ""}
    ${a.disclaimer ? `<p class="overview-disclaimer">${escapeHtml(a.disclaimer)}</p>` : ""}
  </div>`;
}

function renderAutoReport(r, { withMarket }) {
  const mentioned = (r.mentioned_tickers || [])
    .map((t) => `<span class="report-chip"><b>${escapeHtml(t.ticker)}</b>${t.count} tin</span>`)
    .join("");
  return `<div class="report-card">
    <h3>${escapeHtml(r.title || "Báo cáo")}</h3>
    <div class="report-meta">Tạo tự động lúc ${new Date(r.generated_at).toLocaleString("vi-VN")} · số liệu giá thật, không AI</div>
    <div class="report-summary">${escapeHtml(r.summary || "")}</div>
    ${withMarket ? renderReportMarket(r.market) : ""}
    ${mentioned ? `<div class="overview-block" style="margin-top:14px"><div class="overview-block-title">Mã được nhắc trong tin</div><div class="report-chips">${mentioned}</div></div>` : ""}
    ${renderReportNews(r.hot_news)}
    ${r.disclaimer ? `<p class="overview-disclaimer">${escapeHtml(r.disclaimer)}</p>` : ""}
  </div>`;
}

function renderDailyReport(key) {
  const box = document.getElementById("reportContent");
  const entry = dailyReportEntries.find((e) => e.key === key);
  if (!entry) return;
  let html = dailyReportNotice + entry.analyses.map(renderAnalysis).join("");
  if (entry.afternoon) {
    // Báo cáo cuối phiên đã gồm tin nổi bật 24h, nên không lặp lại bản tin sáng tự động.
    html += renderAutoReport(entry.afternoon, { withMarket: true });
  } else if (entry.morning) {
    // Số liệu thị trường của bản 8:30 chỉ là bản sao phiên trước (đã có ở mục ngày đó).
    html += renderAutoReport(entry.morning, { withMarket: false });
  }
  if (!entry.analyses.length) {
    html += '<p class="report-empty-ai">Chưa có bản tin phân tích cho ngày này.</p>';
  }
  box.innerHTML = html;
}

async function generateDailyReportNow() {
  const btn = document.getElementById("generateReportBtn");
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Đang tạo...";
  try {
    const res = await fetch("/api/admin/daily-report/generate", { method: "POST" });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || "lỗi không xác định");
    document.getElementById("reportSelect").value = "";
    await refreshDailyReports();
  } catch (e) {
    document.getElementById("reportContent").insertAdjacentHTML(
      "afterbegin",
      `<div class="auth-error">Lỗi tạo báo cáo: ${escapeHtml(e.message)}</div>`
    );
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}

// ===================== Đăng nhập / tài khoản =====================

function renderAuthArea() {
  const area = document.getElementById("authArea");
  document.getElementById("generateReportBtn").hidden = !currentUser || currentUser.role !== "admin";
  if (currentUser) {
    const adminBtn =
      currentUser.role === "admin"
        ? `<button id="adminOpenBtn" class="auth-btn">Quản trị</button>`
        : "";
    area.innerHTML = `
      <span class="auth-name">Xin chào, ${currentUser.name || currentUser.email}</span>
      ${adminBtn}
      <button id="logoutBtn" class="auth-btn">Đăng xuất</button>
    `;
    document.getElementById("logoutBtn").addEventListener("click", logout);
    if (currentUser.role === "admin") {
      document.getElementById("adminOpenBtn").addEventListener("click", openAdminModal);
    }
  } else {
    area.innerHTML = `<button id="loginOpenBtn" class="auth-btn primary">Đăng nhập</button>`;
    document.getElementById("loginOpenBtn").addEventListener("click", () => openAuthModal());
  }
}

// ===================== Quản trị tài khoản (admin) =====================

let adminAllUsers = [];
let adminExpandedId = null;
let adminPendingDeleteId = null;
let adminAllSources = [];

async function openAdminModal() {
  document.getElementById("adminModalBackdrop").hidden = false;
  document.getElementById("adminError").textContent = "";
  document.getElementById("adminSearchInput").value = "";
  switchAdminTab("users");
  await loadAdminUsers();
}

function switchAdminTab(tab) {
  const isUsers = tab === "users";
  document.getElementById("adminTabUsers").classList.toggle("active", isUsers);
  document.getElementById("adminTabSources").classList.toggle("active", !isUsers);
  document.getElementById("adminUsersPanel").hidden = !isUsers;
  document.getElementById("adminSourcesPanel").hidden = isUsers;
  if (!isUsers && !adminAllSources.length) loadAdminSources();
}

function closeAdminModal() {
  document.getElementById("adminModalBackdrop").hidden = true;
}

async function loadAdminUsers() {
  const body = document.getElementById("adminUsersBody");
  const errBox = document.getElementById("adminError");
  errBox.textContent = "";
  body.innerHTML = `<tr><td colspan="4">Đang tải...</td></tr>`;
  try {
    const res = await fetch("/api/admin/users");
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || "Không tải được danh sách");
    adminAllUsers = json.data;
    renderAdminUsers(adminAllUsers);
  } catch (e) {
    body.innerHTML = "";
    errBox.textContent = e.message;
  }
}

function filterAdminUsers() {
  const q = document.getElementById("adminSearchInput").value.trim().toLowerCase();
  if (!q) return renderAdminUsers(adminAllUsers);
  const filtered = adminAllUsers.filter(
    (u) => (u.email || "").toLowerCase().includes(q) || (u.name || "").toLowerCase().includes(q)
  );
  renderAdminUsers(filtered);
}

function fmtAdminDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("vi-VN");
}

function renderAdminUsers(users) {
  const body = document.getElementById("adminUsersBody");
  if (!users.length) {
    body.innerHTML = `<tr><td colspan="4">Không tìm thấy tài khoản nào.</td></tr>`;
    return;
  }
  body.innerHTML = users
    .map((u) => {
      const isSelf = currentUser && u.id === currentUser.id;
      const isAdmin = u.role === "admin";
      const providerLabel = u.provider === "google" ? "Google" : "Email";
      const roleToggleLabel = isAdmin ? "Bỏ admin" : "Cấp admin";
      const watchlist = u.watchlist || [];
      const sources = u.sources || [];
      const rows = [`
        <tr class="admin-row" data-id="${u.id}">
          <td>
            <div>${escapeHtml(u.name || u.email || "—")}</div>
            <div class="admin-email">${escapeHtml(u.email || "")} · ${providerLabel} · ${watchlist.length} mã / ${sources.length} nguồn</div>
          </td>
          <td>${fmtAdminDate(u.created_at)}</td>
          <td><span class="admin-role-badge ${isAdmin ? "admin" : ""}">${isAdmin ? "Admin" : "User"}</span></td>
          <td>
            <div class="admin-actions">
              <button class="admin-detail-btn">${adminExpandedId === u.id ? "Ẩn" : "Chi tiết"}</button>
              <button class="admin-role-btn" ${isSelf ? "disabled" : ""}>${roleToggleLabel}</button>
              <button class="admin-delete-btn danger" ${isSelf ? "disabled" : ""}>Xoá</button>
            </div>
          </td>
        </tr>
      `];
      if (adminExpandedId === u.id) {
        const watchlistHtml = watchlist.length
          ? watchlist.map((t) => `<span class="admin-tag">${escapeHtml(t)}</span>`).join("")
          : `<span class="admin-email">Chưa có mã nào</span>`;
        const sourcesHtml = sources.length
          ? sources
              .map(
                (s) =>
                  `<div class="admin-source-row"><strong>${escapeHtml(s.name || "")}</strong> — ${escapeHtml(s.url || "")}${s.lang === "en" ? " (nước ngoài)" : ""}</div>`
              )
              .join("")
          : `<span class="admin-email">Chưa có nguồn nào</span>`;
        rows.push(`
          <tr class="admin-detail-row" data-detail-id="${u.id}">
            <td colspan="4">
              <div class="admin-detail-block">
                <div class="admin-detail-label">Danh mục theo dõi</div>
                <div class="admin-tags">${watchlistHtml}</div>
              </div>
              <div class="admin-detail-block">
                <div class="admin-detail-label">Nguồn tin riêng</div>
                ${sourcesHtml}
              </div>
            </td>
          </tr>
        `);
      }
      return rows.join("");
    })
    .join("");

  body.querySelectorAll(".admin-detail-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const tr = e.target.closest("tr");
      const id = tr.dataset.id;
      adminExpandedId = adminExpandedId === id ? null : id;
      renderAdminUsers(users);
    });
  });
  body.querySelectorAll(".admin-role-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const tr = e.target.closest("tr");
      const id = tr.dataset.id;
      const current = users.find((u) => u.id === id);
      setAdminRole(id, current.role === "admin" ? "user" : "admin");
    });
  });
  body.querySelectorAll(".admin-delete-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const tr = e.target.closest("tr");
      const id = tr.dataset.id;
      const current = users.find((u) => u.id === id);
      const label = current.email || current.name || id;
      openAdminConfirm(
        `Xoá tài khoản "${label}"? Hành động này không thể hoàn tác.`,
        () => deleteAdminUserConfirmed(id)
      );
    });
  });
}

async function setAdminRole(id, role) {
  const errBox = document.getElementById("adminError");
  errBox.textContent = "";
  try {
    const res = await fetch("/api/admin/users/role", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, role }),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || "Không đổi được quyền");
    await loadAdminUsers();
  } catch (e) {
    errBox.textContent = e.message;
  }
}

let adminConfirmCallback = null;

function openAdminConfirm(message, onConfirm) {
  adminConfirmCallback = onConfirm;
  document.getElementById("adminConfirmText").textContent = message;
  document.getElementById("adminConfirmBackdrop").hidden = false;
}

function closeAdminConfirm() {
  adminConfirmCallback = null;
  document.getElementById("adminConfirmBackdrop").hidden = true;
}

function runAdminConfirm() {
  const cb = adminConfirmCallback;
  closeAdminConfirm();
  if (cb) cb();
}

async function deleteAdminUserConfirmed(id) {
  const errBox = document.getElementById("adminError");
  errBox.textContent = "";
  try {
    const res = await fetch(`/api/admin/users?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || "Không xoá được tài khoản");
    await loadAdminUsers();
  } catch (e) {
    errBox.textContent = e.message;
  }
}

// ===================== Quản trị nguồn tin mặc định (admin) =====================

async function loadAdminSources() {
  const list = document.getElementById("adminSourcesList");
  const errBox = document.getElementById("adminSourceError");
  errBox.textContent = "";
  list.innerHTML = `<div class="empty">Đang tải...</div>`;
  try {
    const res = await fetch("/api/admin/sources");
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || "Không tải được danh sách nguồn tin");
    adminAllSources = json.data;
    renderAdminSources(adminAllSources);
  } catch (e) {
    list.innerHTML = "";
    errBox.textContent = e.message;
  }
}

function filterAdminSources() {
  const q = document.getElementById("adminSourceSearchInput").value.trim().toLowerCase();
  if (!q) return renderAdminSources(adminAllSources);
  const filtered = adminAllSources.filter(
    (s) => (s.name || "").toLowerCase().includes(q) || (s.url || "").toLowerCase().includes(q)
  );
  renderAdminSources(filtered);
}

function renderAdminSources(list) {
  const el = document.getElementById("adminSourcesList");
  if (!list.length) {
    el.innerHTML = '<div class="empty">Không tìm thấy nguồn tin nào.</div>';
    return;
  }
  el.innerHTML = list
    .map(
      (s) => `<div class="source-manage-row">
        <span class="source-name">${escapeHtml(s.name)}</span>
        <span class="source-category-badge">${s.category === "tech" ? "💻 Công nghệ" : "📊 Chứng khoán"}</span>
        ${s.lang && s.lang !== "vi" ? '<span class="source-lang-badge">Dịch → VI</span>' : ""}
        <span class="source-url">${escapeHtml(s.url)}</span>
        <button class="source-remove" data-name="${escapeHtml(s.name)}">Xoá</button>
      </div>`
    )
    .join("");
  el.querySelectorAll(".source-remove").forEach((btn) => {
    btn.addEventListener("click", () => {
      const name = btn.dataset.name;
      openAdminConfirm(
        `Xoá nguồn tin "${name}" khỏi danh sách mặc định? Hành động này không thể hoàn tác.`,
        () => deleteAdminSourceConfirmed(name)
      );
    });
  });
}

async function deleteAdminSourceConfirmed(name) {
  const errBox = document.getElementById("adminSourceError");
  errBox.textContent = "";
  try {
    const res = await fetch(`/api/admin/sources?name=${encodeURIComponent(name)}`, { method: "DELETE" });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || "Không xoá được nguồn tin");
    await loadAdminSources();
  } catch (e) {
    errBox.textContent = e.message;
  }
}

async function addAdminSource() {
  const nameInput = document.getElementById("adminSourceNameInput");
  const urlInput = document.getElementById("adminSourceUrlInput");
  const foreignCheck = document.getElementById("adminSourceForeignCheck");
  const categoryInput = document.querySelector('input[name="adminSourceCategory"]:checked');
  const errBox = document.getElementById("adminSourceError");
  const name = nameInput.value.trim();
  const url = urlInput.value.trim();
  const foreign = foreignCheck.checked;
  const category = categoryInput ? categoryInput.value : "stock";
  errBox.textContent = "";
  if (!name || !url) {
    errBox.textContent = "Nhập đủ tên nguồn và URL RSS.";
    return;
  }
  const btn = document.getElementById("adminAddSourceBtn");
  btn.disabled = true;
  btn.textContent = "Đang kiểm tra...";
  try {
    const res = await fetch("/api/admin/sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, url, foreign, category }),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || "lỗi không xác định");
    adminAllSources = json.data;
    renderAdminSources(adminAllSources);
    nameInput.value = "";
    urlInput.value = "";
    foreignCheck.checked = false;
    document.querySelector('input[name="adminSourceCategory"][value="stock"]').checked = true;
  } catch (e) {
    errBox.textContent = e.message;
  } finally {
    btn.disabled = false;
    btn.textContent = "+ Thêm nguồn";
  }
}

// ===================== Báo cáo tuần =====================
// Dữ liệu: weekly_reports.json (mỗi tuần 1 báo cáo tổng hợp sẵn, GET /api/weekly-reports).
// Số liệu lấy từ báo chí nên có thể lệch giữa các nguồn — xem mục "Chất lượng dữ liệu".
let weeklyData = { weeks: [] };
let weeklyNotice = "";

function wkNum(n, d = 2) {
  return n == null ? "-" : Number(n).toLocaleString("vi-VN", { minimumFractionDigits: d, maximumFractionDigits: d });
}
function wkCls(n) { return n > 0 ? "up" : n < 0 ? "down" : ""; }
function wkSign(n) { return n > 0 ? "+" : ""; }
function wkChips(list, cls) {
  const a = (list || []).filter(Boolean);
  return a.length ? a.map((t) => `<span class="wk-chip ${cls || ""}">${escapeHtml(t)}</span>`).join("") : '<span class="wk-dim">Không có dữ liệu</span>';
}

async function refreshWeeklyReports() {
  const box = document.getElementById("weeklyContent");
  try {
    const { data, savedAt } = await fetchWithFallback("weekly", "/api/weekly-reports");
    weeklyData = data || { weeks: [] };
    weeklyNotice = fallbackNotice(savedAt, weeklyData.dataSource);
    const sel = document.getElementById("weeklySelect");
    const prev = sel.value;
    sel.innerHTML = weeklyData.weeks
      .map((w) => `<option value="${escapeHtml(w.week_id)}">Tuần ${escapeHtml((w.period && w.period.label) || w.week_id)}</option>`)
      .join("");
    if (prev && weeklyData.weeks.some((w) => w.week_id === prev)) sel.value = prev;
    renderWeekly();
  } catch (e) {
    box.innerHTML = '<div class="empty">Chưa tải được báo cáo tuần.</div>';
  }
}

function renderWeekly() {
  const box = document.getElementById("weeklyContent");
  const id = document.getElementById("weeklySelect").value;
  const w = weeklyData.weeks.find((x) => x.week_id === id) || weeklyData.weeks[0];
  if (!w) { box.innerHTML = '<div class="empty">Chưa có báo cáo tuần nào.</div>'; return; }
  const S = w.summary || {};
  const fn = S.foreign_net_week_bn || {};
  const kpi = (label, val, cls) =>
    `<div class="report-index"><div class="ri-name">${escapeHtml(label)}</div><div class="ri-value ${cls || ""}" style="${String(val).length > 14 ? "font-size:13px" : ""}">${escapeHtml(val)}</div></div>`;
  const kpis = [
    kpi("VN-Index", wkNum(S.vnindex_close)),
    kpi("Biến động tuần", `${wkSign(S.vnindex_week_pct)}${wkNum(S.vnindex_week_pct)}%`, wkCls(S.vnindex_week_pct)),
    kpi(fn.hose != null ? "Ngoại HOSE (tuần)" : "Khối ngoại (tuần)", `${wkNum(fn.hose != null ? fn.hose : fn.all_markets, 0)} tỷ`, wkCls(fn.hose != null ? fn.hose : fn.all_markets)),
    kpi("Hỗ trợ", S.support || "-"),
    kpi("Kháng cự", S.resistance || "-"),
  ].join("");

  const days = w.days || [];
  const dayRows = days.map((d) => {
    const v = d.vnindex || {};
    return `<tr><td>${escapeHtml(d.weekday || "")} ${escapeHtml((d.date || "").slice(8))}/${escapeHtml((d.date || "").slice(5, 7))}</td>
      <td class="num">${wkNum(v.close)}${v.derived ? "*" : ""}</td>
      <td class="num ${wkCls(v.change)}">${wkSign(v.change)}${wkNum(v.change)}</td>
      <td class="num ${wkCls(v.pct)}">${wkSign(v.pct)}${wkNum(v.pct)}%</td>
      <td class="num">${wkNum(d.liquidity_hose_bn, 0)}</td>
      <td class="num ${wkCls(d.foreign_hose_bn)}">${wkSign(d.foreign_hose_bn)}${wkNum(d.foreign_hose_bn, 0)}</td>
      <td>${escapeHtml(d.tag || "")}</td></tr>`;
  }).join("");

  const flows = (w.sector_flows || []).map((x) => {
    const color = x.signal > 0 ? "var(--up)" : x.signal < 0 ? "var(--down)" : "#d9a400";
    return `<div class="wk-flow"><span class="wk-dot" style="background:${color}"></span><div>
      <b>${escapeHtml(x.sector)}</b> <span class="wk-dim">${escapeHtml(x.status || "")}</span><br>${wkChips(x.tickers)}
      <div class="wk-dim">${escapeHtml(x.evidence || "")}</div>
      <div class="wk-out">Dự báo: ${escapeHtml(x.outlook || "")}</div></div></div>`;
  }).join("");

  const wl = (w.watchlist || []).map((i) =>
    `<tr><td><b>${escapeHtml(i.ticker)}</b></td><td>${escapeHtml(i.sector || "")}</td><td>${escapeHtml(i.signal || "")}</td>
     <td class="num ${wkCls(i.week_pct)}">${i.week_pct == null ? "-" : wkSign(i.week_pct) + wkNum(i.week_pct) + "%"}</td>
     <td class="wk-reason">${escapeHtml(i.reason || "")}</td></tr>`).join("");

  const o = w.outlook || {};
  const li = (a) => (a || []).map((t) => `<li>${escapeHtml(t)}</li>`).join("");

  box.innerHTML = `${weeklyNotice}
    <div class="report-card"><div class="report-summary"><b>${escapeHtml(S.headline || "")}</b></div><div class="report-indices">${kpis}</div></div>
    ${days.length ? `<div class="report-card"><h3>Từng ngày trong tuần</h3><div class="wk-scroll"><table class="report-table wk-table">
      <tr><td></td><td class="num wk-dim">VN-Index</td><td class="num wk-dim">+/-</td><td class="num wk-dim">%</td><td class="num wk-dim">GTGD HOSE (tỷ)</td><td class="num wk-dim">Ngoại HOSE (tỷ)</td><td class="wk-dim">Nhận xét</td></tr>${dayRows}</table></div>
      <div class="wk-tabs" id="wkDayTabs">${days.map((d, i) => `<button class="wk-tab" data-i="${i}">${escapeHtml(d.weekday || "")} ${escapeHtml((d.date || "").slice(8))}/${escapeHtml((d.date || "").slice(5, 7))}</button>`).join("")}</div>
      <div id="wkDayDetail"></div></div>` : ""}
    <div class="report-card"><h3>Dòng tiền theo nhóm ngành</h3>${flows || '<span class="wk-dim">Không có dữ liệu</span>'}</div>
    ${wl ? `<div class="report-card"><h3>Cổ phiếu theo dõi</h3><div class="wk-scroll"><table class="report-table wk-table">${wl}</table></div></div>` : ""}
    ${o.base_case || (o.risks && o.risks.length) || (o.actions && o.actions.length) ? `<div class="report-card"><h3>Nhận định &amp; hành động</h3>${o.base_case ? `<p>${escapeHtml(o.base_case)}</p>` : ""}
      ${o.risks && o.risks.length ? `<b>Rủi ro</b><ul>${li(o.risks)}</ul>` : ""}${o.actions && o.actions.length ? `<b>Hành động</b><ul>${li(o.actions)}</ul>` : ""}</div>` : ""}
    ${(w.data_quality || []).length ? `<div class="report-card"><h3>Chất lượng dữ liệu</h3><ul class="wk-dq">${li(w.data_quality)}</ul>
      ${days.length ? '<div class="wk-dim">* số suy ra từ các phiên sau, không phải số công bố trực tiếp.</div>' : ""}</div>` : ""}
    <p class="sector-disclaimer">${escapeHtml(w.disclaimer || "")}${w.sources && w.sources.length ? "<br>Nguồn: " + escapeHtml(w.sources.join(", ")) : ""}</p>`;

  const showDay = (i) => {
    const d = days[i]; if (!d) return;
    document.querySelectorAll("#wkDayTabs .wk-tab").forEach((b) => b.classList.toggle("on", Number(b.dataset.i) === i));
    const lv = d.levels;
    document.getElementById("wkDayDetail").innerHTML =
      `<div class="report-cols"><div><b>Khối ngoại mua ròng</b><div>${wkChips(d.top_foreign_buy, "up")}</div><b>Khối ngoại bán ròng</b><div>${wkChips(d.top_foreign_sell, "down")}</div></div>
       <div><b>Ngành tăng</b><div>${wkChips(d.sectors_up, "up")}</div><b>Ngành giảm</b><div>${wkChips(d.sectors_down, "down")}</div></div></div>
       <p><b>Nổi bật:</b> ${escapeHtml((d.notable || []).join("; "))}</p>
       ${lv ? `<p class="wk-dim">Hỗ trợ: ${escapeHtml(lv.support || "-")} | Kháng cự: ${escapeHtml(lv.resistance || "-")}</p>` : ""}`;
  };
  document.querySelectorAll("#wkDayTabs .wk-tab").forEach((b) => (b.onclick = () => showDay(Number(b.dataset.i))));
  showDay(days.length - 1);
}

function setReportMode(mode) {
  const weekly = mode === "weekly";
  document.getElementById("dailyReportWrap").hidden = weekly;
  document.getElementById("weeklyWrap").hidden = !weekly;
  for (const [id, on] of [["reportModeDaily", !weekly], ["reportModeWeekly", weekly]]) {
    const b = document.getElementById(id);
    b.classList.toggle("active", on);
    b.setAttribute("aria-selected", String(on));
  }
  try { localStorage.setItem("stockpeek.reportMode", mode); } catch (e) {}
}
document.getElementById("reportModeDaily").addEventListener("click", () => setReportMode("daily"));
document.getElementById("reportModeWeekly").addEventListener("click", () => setReportMode("weekly"));
document.getElementById("weeklySelect").addEventListener("change", renderWeekly);
let savedReportMode = "daily";
try { savedReportMode = localStorage.getItem("stockpeek.reportMode") || "daily"; } catch (e) {}
setReportMode(savedReportMode === "weekly" ? "weekly" : "daily");

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

document.getElementById("adminModalClose").addEventListener("click", closeAdminModal);
document.getElementById("adminModalBackdrop").addEventListener("click", (e) => {
  if (e.target.id === "adminModalBackdrop") closeAdminModal();
});
document.getElementById("adminSearchInput").addEventListener("input", filterAdminUsers);
document.getElementById("adminConfirmCancel").addEventListener("click", closeAdminConfirm);
document.getElementById("adminConfirmOk").addEventListener("click", runAdminConfirm);
document.getElementById("adminConfirmBackdrop").addEventListener("click", (e) => {
  if (e.target.id === "adminConfirmBackdrop") closeAdminConfirm();
});
document.getElementById("adminTabUsers").addEventListener("click", () => switchAdminTab("users"));
document.getElementById("adminTabSources").addEventListener("click", () => switchAdminTab("sources"));
document.getElementById("adminSourceSearchInput").addEventListener("input", filterAdminSources);
document.getElementById("adminAddSourceBtn").addEventListener("click", addAdminSource);

function openAuthModal(errorMsg) {
  document.getElementById("authModalBackdrop").hidden = false;
  document.getElementById("authError").textContent = errorMsg || "";
}

function closeAuthModal() {
  document.getElementById("authModalBackdrop").hidden = true;
  document.getElementById("authError").textContent = "";
}

function switchAuthTab(tab) {
  const isLogin = tab === "login";
  document.getElementById("authTabLogin").classList.toggle("active", isLogin);
  document.getElementById("authTabRegister").classList.toggle("active", !isLogin);
  document.getElementById("loginForm").hidden = !isLogin;
  document.getElementById("registerForm").hidden = isLogin;
  document.getElementById("authError").textContent = "";
}

async function checkAuth() {
  try {
    const res = await fetch("/api/auth/me");
    const json = await res.json();
    currentUser = json.ok ? json.data : null;
  } catch (e) {
    currentUser = null;
  }
  renderAuthArea();

  if (currentUser) {
    try {
      const res = await fetch("/api/watchlist");
      const json = await res.json();
      if (json.ok && Array.isArray(json.data)) watchlist = json.data;
    } catch (e) {}
  } else {
    watchlist = loadWatchlist();
  }
}

async function afterLoginSuccess() {
  closeAuthModal();
  await checkAuth();
  refreshQuotes();
  refreshSources();
  refreshAllLiveNews();
  refreshAllHotNews();
}

async function logout() {
  try {
    await fetch("/api/auth/logout", { method: "POST" });
  } catch (e) {}
  currentUser = null;
  watchlist = loadWatchlist();
  renderAuthArea();
  refreshQuotes();
  refreshSources();
  refreshAllLiveNews();
  refreshAllHotNews();
}

document.getElementById("authModalClose").addEventListener("click", closeAuthModal);
document.getElementById("authModalBackdrop").addEventListener("click", (e) => {
  if (e.target.id === "authModalBackdrop") closeAuthModal();
});
document.getElementById("authTabLogin").addEventListener("click", () => switchAuthTab("login"));
document.getElementById("authTabRegister").addEventListener("click", () => switchAuthTab("register"));

document.getElementById("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;
  const errBox = document.getElementById("authError");
  errBox.textContent = "";
  try {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || "Đăng nhập thất bại");
    await afterLoginSuccess();
  } catch (e2) {
    errBox.textContent = e2.message;
  }
});

document.getElementById("registerForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = document.getElementById("registerName").value.trim();
  const email = document.getElementById("registerEmail").value.trim();
  const password = document.getElementById("registerPassword").value;
  const errBox = document.getElementById("authError");
  errBox.textContent = "";
  try {
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password }),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || "Đăng ký thất bại");
    await afterLoginSuccess();
  } catch (e2) {
    errBox.textContent = e2.message;
  }
});

document.getElementById("addBtn").addEventListener("click", addTicker);
document.getElementById("tickerInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") addTicker();
});
document.getElementById("addSourceBtn").addEventListener("click", addSource);
document.getElementById("generateReportBtn").addEventListener("click", generateDailyReportNow);
document.getElementById("reportSelect").addEventListener("change", (e) => renderDailyReport(e.target.value));
document.getElementById("sourcesToggle").addEventListener("click", () => {
  const body = document.getElementById("sourcesBody");
  body.hidden = !body.hidden;
  document.getElementById("sourcesToggleIcon").textContent = body.hidden ? "▸ Xem / sửa" : "▾ Thu gọn";
});
document.getElementById("resetSourcesBtn").addEventListener("click", () => {
  openAdminConfirm(
    "Xoá toàn bộ nguồn tin riêng đang dùng, thay bằng danh sách mặc định mới nhất (cả chứng khoán lẫn công nghệ)?",
    resetSources
  );
});
document.querySelectorAll(".news-tab").forEach((btn) => {
  btn.addEventListener("click", () => switchNewsCategory(btn.dataset.category));
});

const urlParams = new URLSearchParams(window.location.search);
const googleLoginErrorReason = urlParams.get("reason");
if (urlParams.get("login_error") === "google") {
  window.history.replaceState({}, "", window.location.pathname);
}

checkAuth().then(() => {
  if (urlParams.get("login_error") === "google") {
    openAuthModal(
      "Đăng nhập Google thất bại" + (googleLoginErrorReason ? ` (mã lỗi: ${googleLoginErrorReason})` : "") + ", thử lại nhé."
    );
  }
  refreshQuotes();
});
refreshSources();
refreshAllLiveNews();
refreshAllHotNews();
refreshSectorAnalysis();
refreshMarketOverview();
refreshDailyReports();
refreshWeeklyReports();
refreshIndices();
setInterval(refreshDailyReports, 10 * 60 * 1000);
setInterval(refreshWeeklyReports, 10 * 60 * 1000);
setInterval(refreshQuotes, QUOTES_INTERVAL_MS);
setInterval(refreshAllLiveNews, LIVE_NEWS_INTERVAL_MS);
setInterval(refreshAllHotNews, HOT_NEWS_INTERVAL_MS);
setInterval(refreshIndices, INDICES_INTERVAL_MS);
setInterval(refreshSectorAnalysis, SECTOR_INTERVAL_MS);
setInterval(refreshMarketOverview, 10 * 60 * 1000);

// ---- Bản app trên điện thoại (PWA) ----
const MOBILE_VIEW_KEY = "stockpeek.mobileView";

function switchMobileView(view) {
  document.body.dataset.view = view;
  document.querySelectorAll("#bottomNav button").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === view);
  });
  window.scrollTo(0, 0);
  try { localStorage.setItem(MOBILE_VIEW_KEY, view); } catch (e) {}
}

document.querySelectorAll("#bottomNav button").forEach((btn) => {
  btn.addEventListener("click", () => switchMobileView(btn.dataset.view));
});
let savedMobileView = "news";
try { savedMobileView = localStorage.getItem(MOBILE_VIEW_KEY) || "news"; } catch (e) {}
switchMobileView(document.querySelector(`#bottomNav button[data-view="${savedMobileView}"]`) ? savedMobileView : "news");

// App cài trên điện thoại bị hệ điều hành "đóng băng" khi chuyển sang app khác,
// setInterval ngừng chạy - mở lại thì tải mới ngay thay vì hiện giá cũ.
let lastHiddenAt = 0;
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    lastHiddenAt = Date.now();
    return;
  }
  if (lastHiddenAt && Date.now() - lastHiddenAt > 30 * 1000) {
    refreshQuotes();
    refreshIndices();
    refreshAllLiveNews();
    refreshAllHotNews();
    refreshMarketOverview();
    refreshSectorAnalysis();
    refreshDailyReports();
    refreshWeeklyReports();
  }
});

// Link "Xem trong tab Báo cáo" ở tab Thị trường: điện thoại thì chuyển tab dưới
// đáy, máy tính (mọi khối cùng 1 trang) thì cuộn tới khối Báo cáo.
document.addEventListener("click", (e) => {
  const link = e.target.closest("[data-goto]");
  if (!link) return;
  e.preventDefault();
  const view = link.dataset.goto;
  const nav = document.getElementById("bottomNav");
  if (nav && getComputedStyle(nav).display !== "none") {
    switchMobileView(view);
  } else {
    document.querySelector(`main > section[data-view="${view}"]`)?.scrollIntoView({ behavior: "smooth" });
  }
});

// ---- Tự cập nhật giao diện (không cần cài lại app) ----
// Server gắn mã phiên bản (băm nội dung public/) vào <html data-app-version>.
// App so với /api/version: mở lại app (từ nền) mà có bản mới thì tải lại luôn;
// đang dùng dở thì hiện thanh "Có bản mới" để người dùng tự bấm, không cắt ngang.
const APP_VERSION = document.documentElement.dataset.appVersion || "";
const UPDATE_CHECK_INTERVAL_MS = 5 * 60 * 1000;
const RELOAD_GUARD_KEY = "stockpeek.lastAutoReload";

async function fetchServerVersion() {
  try {
    const res = await fetch("/api/version", { cache: "no-store" });
    const json = await res.json();
    return json.ok ? json.version : null;
  } catch (e) {
    return null; // mất mạng: bỏ qua, lần sau kiểm tra lại
  }
}

function reloadForUpdate() {
  // Chống vòng lặp tải lại (ví dụ đúng lúc Render đang chuyển bản deploy).
  try {
    const last = Number(sessionStorage.getItem(RELOAD_GUARD_KEY) || 0);
    if (Date.now() - last < 60 * 1000) return false;
    sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()));
  } catch (e) {}
  location.reload();
  return true;
}

function showUpdateBanner() {
  if (document.getElementById("updateBanner")) return;
  const bar = document.createElement("div");
  bar.id = "updateBanner";
  bar.className = "update-banner";
  bar.innerHTML = '<span>🔄 Đã có bản cập nhật mới</span><button type="button" class="auth-btn primary">Tải lại</button>';
  bar.querySelector("button").addEventListener("click", () => location.reload());
  document.body.appendChild(bar);
}

async function checkForAppUpdate({ autoReload }) {
  if (!APP_VERSION || APP_VERSION.startsWith("__")) return; // chạy file tĩnh, không qua server
  const latest = await fetchServerVersion();
  if (!latest || latest === APP_VERSION) return;
  if (!(autoReload && reloadForUpdate())) showUpdateBanner();
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) return;
  checkForAppUpdate({ autoReload: true });
  navigator.serviceWorker?.getRegistration().then((r) => r && r.update()).catch(() => {});
});
setInterval(() => {
  if (!document.hidden) checkForAppUpdate({ autoReload: false });
}, UPDATE_CHECK_INTERVAL_MS);
// Vừa mở app mà trang lấy từ bộ nhớ đệm (lúc mất mạng) thì tải lại sang bản mới luôn.
setTimeout(() => checkForAppUpdate({ autoReload: true }), 3000);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((e) => console.warn("[sw] đăng ký lỗi", e));
  });
}

// ---- Nút "Cài app" ----
// Android/Chrome: bắt sự kiện beforeinstallprompt để bấm nút là hiện hộp cài.
// iPhone: Safari không có API cài, chỉ hiện hướng dẫn "Chia sẻ → Thêm vào MH chính".
const installBtn = document.getElementById("installAppBtn");
const installBackdrop = document.getElementById("installModalBackdrop");
const ua = navigator.userAgent;
const isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isInAppBrowser = /Zalo|FBAN|FBAV|FB_IAB|Instagram|Line\//i.test(ua);
const isStandalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
let deferredInstallPrompt = null;

function openInstallGuide() {
  let html;
  if (isInAppBrowser) {
    html = `<p>Bạn đang mở trang trong <b>Zalo/Facebook</b> nên không cài được app.</p>
      <ol>
        <li>Bấm nút <b>⋯</b> (góc trên/dưới bên phải)</li>
        <li>Chọn <b>Mở bằng trình duyệt</b> (${isIOS ? "Safari" : "Chrome"})</li>
        <li>Bấm lại nút <b>📲 Cài app</b> trên trang</li>
      </ol>`;
  } else if (isIOS) {
    html = `<ol>
        <li>Bấm nút <b>Chia sẻ</b> (ô vuông có mũi tên ⬆️) ở thanh dưới của Safari</li>
        <li>Kéo xuống, chọn <b>Thêm vào MH chính</b> (Add to Home Screen)</li>
        <li>Bấm <b>Thêm</b> ở góc trên bên phải</li>
      </ol>
      <p>Icon stockPeek sẽ hiện ngoài màn hình chính, bấm vào là mở app toàn màn hình.</p>`;
  } else {
    html = `<ol>
        <li>Bấm menu <b>⋮</b> ở góc trên bên phải của Chrome</li>
        <li>Chọn <b>Cài đặt ứng dụng</b> hoặc <b>Thêm vào màn hình chính</b></li>
        <li>Bấm <b>Cài đặt</b></li>
      </ol>`;
  }
  document.getElementById("installModalBody").innerHTML = html;
  installBackdrop.hidden = false;
}

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  installBtn.hidden = false;
});
window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  installBtn.hidden = true;
});
installBtn.addEventListener("click", async () => {
  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    return;
  }
  openInstallGuide();
});
document.getElementById("installModalClose").addEventListener("click", () => { installBackdrop.hidden = true; });
installBackdrop.addEventListener("click", (e) => {
  if (e.target === installBackdrop) installBackdrop.hidden = true;
});
// iPhone và trình duyệt trong Zalo/Facebook không bao giờ có beforeinstallprompt - hiện nút ngay.
// Android Chrome nếu chưa có sự kiện (đã cài rồi hoặc Chrome chưa cho cài) thì vẫn hiện nút
// trên điện thoại để chỉ đường qua menu ⋮.
if (!isStandalone && (isIOS || isInAppBrowser || /Android/.test(ua))) {
  installBtn.hidden = false;
}
