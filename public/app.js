const STORAGE_KEY = "stockpeek_watchlist";
const SOURCES_STORAGE_KEY = "stockpeek_sources";
const DEFAULT_TICKERS = ["VIC", "VNM", "FPT", "VCB", "HPG"];
const DEFAULT_SOURCES = [
  { name: "24hMoney", url: "https://24hmoney.vn/rss/chung-khoan.rss" },
  { name: "VnEconomy", url: "https://vneconomy.vn/thi-truong-chung-khoan.rss" },
];
const QUOTES_INTERVAL_MS = 15000;
const NEWS_INTERVAL_MS = 3 * 60 * 1000;

function loadSources() {
  try {
    const raw = localStorage.getItem(SOURCES_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return DEFAULT_SOURCES.slice();
}

function saveSources(list) {
  localStorage.setItem(SOURCES_STORAGE_KEY, JSON.stringify(list));
}

let sources = loadSources();

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
        return `<div class="stock-card">
          <button class="remove" onclick="removeTicker('${t}')">✕</button>
          <div class="ticker">${t}</div>
          <div class="empty">Không có dữ liệu</div>
        </div>`;
      }
      const sign = d.change > 0 ? "+" : "";
      return `<div class="stock-card">
        <button class="remove" onclick="removeTicker('${t}')">✕</button>
        <div class="ticker">${d.ticker}</div>
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
}

function removeTicker(t) {
  watchlist = watchlist.filter((x) => x !== t);
  saveWatchlist(watchlist);
  refreshQuotes();
}

function addTicker() {
  const input = document.getElementById("tickerInput");
  const raw = input.value.trim().toUpperCase();
  if (!raw) return;
  raw.split(",").forEach((t) => {
    t = t.trim();
    if (t && !watchlist.includes(t)) watchlist.push(t);
  });
  saveWatchlist(watchlist);
  input.value = "";
  refreshQuotes();
}

async function refreshNews() {
  const feed = document.getElementById("newsFeed");
  try {
    const q = encodeURIComponent(JSON.stringify(sources));
    const res = await fetch(`/api/news?sources=${q}`);
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || "lỗi không xác định");
    renderNews(json.data);
    document.getElementById("newsUpdated").textContent =
      "Cập nhật " + new Date().toLocaleTimeString("vi-VN");
  } catch (e) {
    feed.innerHTML = `<div class="empty">Lỗi lấy tin tức: ${e.message}</div>`;
  }
}

function renderNews(items) {
  const feed = document.getElementById("newsFeed");
  const valid = items.filter((it) => it.title);
  if (valid.length === 0) {
    feed.innerHTML = '<div class="empty">Chưa có tin nào.</div>';
    return;
  }
  feed.innerHTML = valid
    .map(
      (it) => `<a class="news-card" href="${it.link}" target="_blank" rel="noopener">
        <div class="source-row">📰 ${it.source} · ${timeAgo(it.pubDate)}</div>
        <div class="title">${it.title}</div>
        ${it.summary ? `<div class="summary">${it.summary}</div>` : ""}
        <span class="link-out">Xem tin →</span>
      </a>`
    )
    .join("");
}

function renderSources() {
  const list = document.getElementById("sourcesList");
  if (!sources.length) {
    list.innerHTML = '<div class="empty">Chưa có nguồn tin nào.</div>';
    return;
  }
  list.innerHTML = sources
    .map(
      (s, i) => `<div class="source-row">
        <span class="source-name">${s.name}</span>
        <span class="source-url">${s.url}</span>
        <button class="source-remove" onclick="removeSource(${i})">Xoá</button>
      </div>`
    )
    .join("");
}

async function addSource() {
  const nameInput = document.getElementById("sourceNameInput");
  const urlInput = document.getElementById("sourceUrlInput");
  const errBox = document.getElementById("sourceError");
  const name = nameInput.value.trim();
  const url = urlInput.value.trim();
  errBox.textContent = "";
  if (!name || !url) {
    errBox.textContent = "Nhập đủ tên nguồn và URL RSS.";
    return;
  }
  if (sources.some((s) => s.name.toLowerCase() === name.toLowerCase())) {
    errBox.textContent = "Tên nguồn này đã tồn tại.";
    return;
  }
  const btn = document.getElementById("addSourceBtn");
  btn.disabled = true;
  btn.textContent = "Đang kiểm tra...";
  try {
    const res = await fetch("/api/validate-source", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || "lỗi không xác định");
    sources.push({ name, url });
    saveSources(sources);
    renderSources();
    nameInput.value = "";
    urlInput.value = "";
    refreshNews();
  } catch (e) {
    errBox.textContent = e.message;
  } finally {
    btn.disabled = false;
    btn.textContent = "+ Thêm nguồn";
  }
}

function removeSource(index) {
  sources.splice(index, 1);
  saveSources(sources);
  renderSources();
  refreshNews();
}

document.getElementById("addBtn").addEventListener("click", addTicker);
document.getElementById("tickerInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") addTicker();
});
document.getElementById("addSourceBtn").addEventListener("click", addSource);

renderSources();
refreshQuotes();
refreshNews();
setInterval(refreshQuotes, QUOTES_INTERVAL_MS);
setInterval(refreshNews, NEWS_INTERVAL_MS);
