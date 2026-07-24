const STORAGE_KEY = "stockpeek_watchlist";
const DEFAULT_TICKERS = ["VIC", "VNM", "FPT", "VCB", "HPG"];
const QUOTES_INTERVAL_MS = 15000;
const NEWS_INTERVAL_MS = 3 * 60 * 1000;
const INDICES_INTERVAL_MS = 30000;

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
      const netSign = idx.foreignNet > 0 ? "+" : "";
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
          <span>NĐTNN - GT ròng (tỷ đồng)</span><span class="index-meta-val">${netSign}${(idx.foreignNet ?? 0).toLocaleString("vi-VN")}</span>
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

async function refreshNews() {
  const feed = document.getElementById("newsFeed");
  try {
    const res = await fetch("/api/news");
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
    .map((it, i) => {
      const chips = it.sources
        .map((s) => `<span class="source-chip">📰 ${s.source}</span>`)
        .join("");
      const multiBadge =
        it.sourceCount > 1 ? `<span class="multi-badge">${it.sourceCount} nguồn đưa tin</span>` : "";
      const detailItems = it.sources
        .map(
          (s) => `<div class="sources-detail-item">
            <span><span class="sdi-source">${s.source}</span><span class="sdi-title">${s.title}</span></span>
            <a href="${s.link}" target="_blank" rel="noopener">Mở bài gốc ↗</a>
          </div>`
        )
        .join("");
      return `<div class="news-card">
        <div class="source-row">${chips}${multiBadge}<span>· ${timeAgo(it.pubDate)}</span></div>
        <div class="title">${it.title}</div>
        ${it.summary ? `<div class="summary">${it.summary}</div>` : ""}
        <button class="link-out" onclick="toggleNewsDetail(${i})">Xem nguồn đưa tin →</button>
        <div class="sources-detail" id="news-detail-${i}">
          <div class="sources-detail-label">Nguồn đưa tin · ${it.sourceCount}</div>
          ${detailItems}
        </div>
      </div>`;
    })
    .join("");
}

function toggleNewsDetail(i) {
  const el = document.getElementById(`news-detail-${i}`);
  if (el) el.classList.toggle("open");
}

async function refreshSources() {
  try {
    const res = await fetch("/api/sources");
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || "lỗi không xác định");
    sources = json.data;
    renderSources();
  } catch (e) {
    document.getElementById("sourcesList").innerHTML =
      `<div class="empty">Lỗi lấy danh sách nguồn: ${e.message}</div>`;
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
        <span class="source-name">${s.name}</span>
        ${s.lang && s.lang !== "vi" ? '<span class="source-lang-badge">Dịch → VI</span>' : ""}
        <span class="source-url">${s.url}</span>
        <button class="source-remove" onclick="removeSource('${s.name.replace(/'/g, "\\'")}')">Xoá</button>
      </div>`
    )
    .join("");
}

async function addSource() {
  const nameInput = document.getElementById("sourceNameInput");
  const urlInput = document.getElementById("sourceUrlInput");
  const foreignCheck = document.getElementById("sourceForeignCheck");
  const errBox = document.getElementById("sourceError");
  const name = nameInput.value.trim();
  const url = urlInput.value.trim();
  const foreign = foreignCheck.checked;
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
      body: JSON.stringify({ name, url, foreign }),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || "lỗi không xác định");
    sources = json.data;
    renderSources();
    nameInput.value = "";
    urlInput.value = "";
    foreignCheck.checked = false;
    refreshNews();
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
    refreshNews();
  } catch (e) {
    document.getElementById("sourceError").textContent = e.message;
  }
}

async function refreshMarketOverview() {
  const box = document.getElementById("overviewContent");
  try {
    const res = await fetch("/api/market-overview");
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || "lỗi không xác định");
    renderMarketOverview(json.data);
  } catch (e) {
    box.innerHTML = '<div class="empty">Chưa có dữ liệu nhận định thị trường chung.</div>';
  }
}

function renderMarketOverview(data) {
  const box = document.getElementById("overviewContent");
  if (data.generated_at) {
    document.getElementById("overviewUpdated").textContent =
      "Cập nhật " + new Date(data.generated_at).toLocaleString("vi-VN");
  }
  const highlights = (data.highlights || []).map((h) => `<li>${h}</li>`).join("");
  const actions = (data.action_notes || []).map((a) => `<li>${a}</li>`).join("");
  const tech = data.technical_outlook || {};

  box.innerHTML = `
    <div class="overview-summary">${data.executive_summary || ""}</div>
    ${
      highlights
        ? `<div class="overview-block">
            <div class="overview-block-title">Điểm nhấn chính</div>
            <ul class="overview-list">${highlights}</ul>
          </div>`
        : ""
    }
    ${
      tech.trend
        ? `<div class="overview-block">
            <div class="overview-block-title">Góc nhìn kỹ thuật</div>
            <div class="overview-tech">
              <div>${tech.trend}</div>
              <div class="overview-tech-levels">
                ${tech.support ? `<span class="tech-chip">Hỗ trợ: ${tech.support}</span>` : ""}
                ${tech.resistance ? `<span class="tech-chip">Kháng cự: ${tech.resistance}</span>` : ""}
              </div>
              ${tech.note ? `<div class="overview-tech-note">${tech.note}</div>` : ""}
            </div>
          </div>`
        : ""
    }
    ${
      actions
        ? `<div class="overview-block">
            <div class="overview-block-title">Lưu ý hành động</div>
            <ul class="overview-list">${actions}</ul>
          </div>`
        : ""
    }
    ${data.disclaimer ? `<p class="overview-disclaimer">${data.disclaimer}</p>` : ""}
  `;
}

async function refreshSectorAnalysis() {
  const grid = document.getElementById("sectorGrid");
  try {
    const res = await fetch("/api/sector-analysis");
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || "lỗi không xác định");
    renderSectorAnalysis(json.data);
  } catch (e) {
    grid.innerHTML = `<div class="empty">Chưa có dữ liệu phân tích nhóm ngành.</div>`;
    document.getElementById("sectorDisclaimer").textContent = "";
  }
}

function renderSectorAnalysis(data) {
  const grid = document.getElementById("sectorGrid");
  const disclaimerBox = document.getElementById("sectorDisclaimer");
  disclaimerBox.textContent = data.disclaimer || "";
  if (data.generated_at) {
    document.getElementById("sectorUpdated").textContent =
      "Cập nhật " + new Date(data.generated_at).toLocaleString("vi-VN");
  }
  const sectors = data.sectors || [];
  if (!sectors.length) {
    grid.innerHTML = '<div class="empty">Chưa có dữ liệu.</div>';
    return;
  }
  grid.innerHTML = sectors
    .map(
      (s) => `<div class="sector-card">
        <div class="sector-name">${s.name}</div>
        ${s.outlook ? `<div class="sector-outlook">${s.outlook}</div>` : ""}
        ${(s.picks || [])
          .map(
            (p) => `<div class="sector-pick">
              <span class="pick-ticker">${p.ticker}</span>
              <span class="pick-reason">${p.reason}${
                p.source ? `<span class="pick-source">Nguồn: ${p.source}</span>` : ""
              }</span>
            </div>`
          )
          .join("")}
      </div>`
    )
    .join("");
}

// ===================== Đăng nhập / tài khoản =====================

function renderAuthArea() {
  const area = document.getElementById("authArea");
  if (currentUser) {
    area.innerHTML = `
      <span class="auth-name">Xin chào, ${currentUser.name || currentUser.email}</span>
      <button id="logoutBtn" class="auth-btn">Đăng xuất</button>
    `;
    document.getElementById("logoutBtn").addEventListener("click", logout);
  } else {
    area.innerHTML = `<button id="loginOpenBtn" class="auth-btn primary">Đăng nhập</button>`;
    document.getElementById("loginOpenBtn").addEventListener("click", () => openAuthModal());
  }
}

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
  refreshNews();
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
  refreshNews();
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
refreshNews();
refreshSectorAnalysis();
refreshMarketOverview();
refreshIndices();
setInterval(refreshQuotes, QUOTES_INTERVAL_MS);
setInterval(refreshNews, NEWS_INTERVAL_MS);
setInterval(refreshIndices, INDICES_INTERVAL_MS);
