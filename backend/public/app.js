const BACKEND = "";
const POLL_INTERVAL = 15000;
const COUNTDOWN_INTERVAL = 1000;
const BACKEND = "";
const POLL_MS = 12000;

let drops = new Map();
let acquiredIds = new Set();
let acquiredCount = 0;
let activityItems = [];
let activeFilter = "ALL";
let mySignals = [];
let connectedWallet = null;

function loadMySignals() {
  try { mySignals = JSON.parse(localStorage.getItem("tk-signals") || "[]"); } catch { mySignals = []; }
}
function saveMySignals() {
  try { localStorage.setItem("tk-signals", JSON.stringify(mySignals)); } catch {}
}
function addMySignal(data, dropId) {
  if (!mySignals.find(s => s.id === (data.id || dropId))) {
    mySignals.unshift({ id: data.id || dropId, tag: data.tag, severity: data.severity, payload: data.payload, price: data.price, purchasedAt: new Date().toISOString(), explorerUrl: data.explorerUrl || null });
    saveMySignals();
  }
  document.getElementById("filter-row").querySelector("[data-filter='MINE']").textContent = `Mine (${mySignals.length})`;
}

function pad(n) { return String(n).padStart(2, "0"); }
function fmt(s) {
  if (s <= 0) return "Expired";
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (d > 0) return `${d}d ${pad(h)}h remaining`;
  if (h > 0) return `${pad(h)}h ${pad(m)}m remaining`;
  return `${pad(m)}:${pad(sec)}`;
}
function cntClass(s) { return s <= 0 ? "expired" : s < 30 ? "danger" : ""; }
function sevClass(sev) { return (sev || "").toLowerCase(); }
function fmtTag(t) { return String(t || "").replace(/_/g, " ").toUpperCase(); }

async function fetchDrops() {
  try {
    const r = await fetch(`${BACKEND}/drops`);
    if (!r.ok) return [];
    const d = await r.json();
    return Array.isArray(d) ? d : [];
  } catch { return []; }
}

function buildCard(drop) {
  const el = document.createElement("article");
  el.className = `signal-card sev-${sevClass(drop.severity)}`;
  el.dataset.id = drop.id;
  const s = Number(drop.secondsRemaining || 0);
  el.innerHTML = `
    <div class="card-top">
      <span class="tag-pill">${fmtTag(drop.tag)}</span>
      <span class="sev-badge ${sevClass(drop.severity)}">${drop.severity || "MEDIUM"}</span>
      <span class="card-price">${drop.price || "0.00"} USDC</span>
      <span class="card-id">${String(drop.id).slice(0,8)}</span>
    </div>
    <div class="card-teaser">${drop.teaser || "Signal content encrypted. Acquire to unlock."}</div>
    <div class="card-countdown ${cntClass(s)}" data-cd="${drop.id}">${fmt(s)}</div>
    <div class="card-bottom">
      <span class="card-status" data-st="${drop.id}"><span class="status-dot"></span><span data-stl="${drop.id}">${s <= 0 ? "Expired" : "Available"}</span></span>
      <button class="btn-acquire" data-acq="${drop.id}" data-price="${drop.price || "0.00"}" ${s <= 0 || drop.used ? "disabled" : ""}>
        Acquire — ${drop.price || "0.00"} USDC
      </button>
    </div>`;
  return el;
}

function renderSignals(list) {
  const grid = document.getElementById("signal-grid");
  const empty = document.getElementById("empty-state");
  if (activeFilter === "MINE") { renderMine(); return; }
  const visible = list.filter(d => !d.used && Number(d.secondsRemaining || 0) > 0);
  const filtered = activeFilter === "ALL" ? visible : visible.filter(d => (d.severity || "").toUpperCase() === activeFilter);
  const sorted = [...filtered].sort((a, b) => { const o = {CRITICAL:0,HIGH:1,MEDIUM:2,LOW:3}; return (o[a.severity]??2) - (o[b.severity]??2) || Number(a.secondsRemaining) - Number(b.secondsRemaining); });
  document.getElementById("live-count").textContent = `${visible.length} LIVE`;
  document.getElementById("stat-live").textContent = visible.length;
  document.getElementById("live-pill-count").textContent = `${visible.length} live`;
  const cur = new Set(Array.from(grid.querySelectorAll(".signal-card")).map(c => c.dataset.id));
  const next = new Set(sorted.map(d => d.id));
  cur.forEach(id => { if (!next.has(id)) { const el = grid.querySelector(`[data-id="${id}"]`); if (el) { el.style.opacity="0"; setTimeout(()=>el.remove(),300); } } });
  sorted.forEach(d => { if (!cur.has(d.id)) { grid.appendChild(buildCard(d)); drops.set(d.id, d); } });
  empty.classList.toggle("hidden", sorted.length > 0);
}

function renderMine() {
  const grid = document.getElementById("signal-grid");
  const empty = document.getElementById("empty-state");
  grid.innerHTML = "";
  if (mySignals.length === 0) { empty.classList.remove("hidden"); return; }
  empty.classList.add("hidden");
  mySignals.forEach(s => {
    const el = document.createElement("article");
    el.className = `signal-card sev-${sevClass(s.severity)}`;
    el.innerHTML = `
      <div class="card-top">
        <span class="tag-pill">${fmtTag(s.tag)}</span>
        <span class="sev-badge ${sevClass(s.severity)}">${s.severity}</span>
        <span class="card-price">${s.price} USDC</span>
        <span class="card-id">${String(s.id).slice(0,8)}</span>
      </div>
      <div class="card-teaser" style="color:var(--text)">${(s.payload||"").replace(/\n/g,"<br>")}</div>
      ${s.explorerUrl ? `<a href="${s.explorerUrl}" target="_blank" style="font-family:var(--font-mono);font-size:11px;color:var(--green);">View on BaseScan →</a>` : ""}
      <div class="card-bottom"><span class="card-status"><span class="status-dot"></span>Acquired</span></div>`;
    grid.appendChild(el);
  });
}

function updateCountdowns() {
  document.querySelectorAll(".signal-card[data-id]").forEach(card => {
    const drop = drops.get(card.dataset.id);
    if (!drop) return;
    const s = Math.max(0, Math.floor((new Date(drop.expiresAt).getTime() - Date.now()) / 1000));
    const cd = card.querySelector(`[data-cd="${drop.id}"]`);
    const st = card.querySelector(`[data-st="${drop.id}"]`);
    const stl = card.querySelector(`[data-stl="${drop.id}"]`);
    const btn = card.querySelector("[data-acq]");
    if (cd) { cd.textContent = fmt(s); cd.className = `card-countdown ${cntClass(s)}`; }
    if (s <= 0) { if (stl) stl.textContent = "Expired"; if (st) st.classList.add("expired"); if (btn) btn.disabled = true; }
  });
}

function pushActivity(item) {
  activityItems.unshift(item);
  activityItems = activityItems.slice(0, 8);
  const feed = document.getElementById("activity-feed");
  const empty = document.getElementById("feed-empty");
  if (empty) empty.style.display = "none";
  feed.innerHTML = activityItems.map(a => `
    <div class="activity-row">
      <span class="feed-time">${a.time}</span>
      <span class="feed-id">${a.id}</span>
      <span class="feed-tag">${fmtTag(a.tag)}</span>
      <span class="feed-sev">${a.severity || ""}</span>
      <span class="feed-price">${a.price || ""} USDC</span>
      <span class="feed-status"><span class="pulse-dot" style="width:5px;height:5px"></span>${a.label}</span>
    </div>`).join("");
  updateTicker();
}

function updateTicker() {
  const t = document.getElementById("ticker-track");
  if (!t) return;
  if (activityItems.length === 0) { t.textContent = "Awaiting signal acquisitions from agents and operators..."; return; }
  const str = activityItems.map(a => `[${a.time}] ${a.id} — ${fmtTag(a.tag)} — ${a.label}`).join("  ·  ");
  t.textContent = str + "  ·  " + str;
}

function showModal(data, dropId) {
  addMySignal(data, dropId);
  const overlay = document.getElementById("modal-overlay");
  const body = document.getElementById("modal-body");
  body.textContent = [
    `Signal ID : ${String(data.id || dropId).slice(0,8)}`,
    `Tag       : ${data.tag || "unknown"}`,
    `Severity  : ${data.severity || "MEDIUM"}`,
    `Price     : ${data.price || "0.00"} USDC`,
    `Network   : Base Sepolia`,
    ``,
    data.payload || ""
  ].join("\n");
  overlay.classList.remove("hidden");
  setTimeout(() => overlay.classList.add("hidden"), 20000);
}

async function acquireSignal(dropId, price) {
  try {
    const r1 = await fetch(`${BACKEND}/drop/${dropId}`);
    if (r1.status === 410) { alert("Signal expired or already consumed."); return; }
    if (r1.status !== 402) throw new Error(`Expected 402, got ${r1.status}`);
    const challenge = await r1.json();
    const treasury = challenge.treasuryWallet || "unknown";
    const amount = challenge.amount || price;
    const network = challenge.network || "base";
    alert(`Payment required\n\nSend ${amount} USDC on ${network} to:\n${treasury}\n\nMemo: signal:${dropId.slice(0,18)}\n\nFor autonomous payment, install the KeeperHub agentic wallet:\nnpx @keeperhub/wallet skill install\n\nFor demo, this window will auto-close.`);
    acquiredCount++;
    pushActivity({ time: new Date().toLocaleTimeString(), id: String(dropId).slice(0,8), tag: drops.get(dropId)?.tag || "unknown", severity: drops.get(dropId)?.severity || "", price: amount, label: "Payment prompted" });
  } catch (err) {
    console.error("[acquire]", err);
    alert("Acquisition failed: " + err.message);
  }
}

async function checkActivity() {
  try {
    const r = await fetch(`${BACKEND}/activity`);
    if (!r.ok) return;
    const items = await r.json();
    items.forEach(a => {
      if (!acquiredIds.has(a.dropId)) {
        acquiredIds.add(a.dropId);
        acquiredCount++;
        document.getElementById("acquired-count").textContent = `${acquiredCount} ACQUIRED`;
        document.getElementById("stat-acquired").textContent = acquiredCount;
        pushActivity({ time: new Date(a.acquiredAt || Date.now()).toLocaleTimeString(), id: String(a.dropId).slice(0,8), tag: a.tag, severity: a.severity, price: a.price, label: "Agent acquired" });
      }
    });
  } catch {}
}

function wireUI() {
  document.getElementById("signal-grid").addEventListener("click", e => {
    const btn = e.target.closest("[data-acq]");
    if (btn && !btn.disabled) acquireSignal(btn.dataset.acq, btn.dataset.price);
  });
  document.getElementById("filter-row").addEventListener("click", e => {
    const btn = e.target.closest(".filter-btn");
    if (!btn) return;
    document.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    activeFilter = btn.dataset.filter;
    document.getElementById("signal-grid").innerHTML = "";
    if (activeFilter === "MINE") renderMine();
    else fetchDrops().then(renderSignals);
  });
  const close = () => document.getElementById("modal-overlay").classList.add("hidden");
  document.getElementById("modal-close").addEventListener("click", close);
  document.getElementById("modal-confirm").addEventListener("click", close);
  document.getElementById("modal-overlay").addEventListener("click", e => { if (e.target === e.currentTarget) close(); });
  document.getElementById("connect-btn").addEventListener("click", () => {
    alert("Connect your Base Sepolia wallet.\n\nFor autonomous payment, install the KeeperHub agentic wallet:\nnpx @keeperhub/wallet skill install\n\nOr use any Base Sepolia compatible wallet.");
  });
}

async function tick() {
  const list = await fetchDrops();
  list.forEach(d => drops.set(d.id, d));
  renderSignals(list);
  await checkActivity();
}

document.addEventListener("DOMContentLoaded", () => {
  loadMySignals();
  wireUI();
  tick();
  setInterval(tick, POLL_MS);
  setInterval(updateCountdowns, 1000);
  setInterval(checkActivity, 8000);
});
    if (!isGeneric && first.length > 0) {
      return domain + ' — ' + first.toLowerCase() + '.';
    }

    return domain + ' — details locked behind payment.';
  }

  if (isNew) {
    card.classList.add("new-card");
    setTimeout(() => card.classList.remove("new-card"), 600);
  }

  const previewText = buildPreview(drop);
  const aiBadge = drop.ai_score != null ? `
  <div class="ai-badge">
    <div class="ai-score-row">
      <span class="ai-rec ${drop.ai_recommendation === 'BUY' ? 'buy' : 'skip'}">
        AI: ${drop.ai_recommendation || 'SKIP'}
      </span>
      <div class="ai-bar-wrap">
        <div class="ai-bar ${drop.ai_recommendation === 'BUY' ? 'buy' : 'skip'}"
             style="width:${Math.round((drop.ai_score || 0) * 100)}%">
        </div>
      </div>
      <span class="ai-pct">${Math.round((drop.ai_score || 0) * 100)}%</span>
    </div>
    <div class="ai-reason">${drop.ai_reasoning || ''}</div>
  </div>` : '';

  card.innerHTML = `
    <div class="card-top">
      <span class="tag-badge">${drop.tag || 'UNKNOWN'}</span>
      <span class="severity severity-${(drop.severity || 'medium').toLowerCase()}">${drop.severity || 'MEDIUM'}</span>
      <span class="price">${drop.price || '0.00'} XLM</span>
      <span class="drop-id">${formatShortId(drop.id)}</span>
    </div>
    <div class="signal-preview">
      <span class="preview-domain">${previewText}</span>
      <span class="preview-locked">Full intel encrypted. Acquire to unlock.</span>
    </div>
    ${aiBadge}
    <div class="countdown ${countdownClass}" data-countdown-for="${drop.id}">${formatCountdown(secondsRemaining)}</div>
    <div class="status-row">
      <span class="status" data-status-for="${drop.id}"><span class="status-dot"></span><span data-status-label="${drop.id}">${drop.used ? 'CONSUMED' : secondsRemaining <= 0 ? 'EXPIRED' : 'AVAILABLE'}</span></span>
      <button type="button" class="acquire-btn${drop.ai_recommendation === 'SKIP' ? ' ai-skip' : ''}" data-acquire="${drop.id}" data-price="${drop.price || '0.00'}" ${drop.used || secondsRemaining <= 0 ? 'disabled' : ''}>
        ACQUIRE - ${drop.price || '0.00'} XLM
      </button>
    </div>
  `;

  return card;
}

function applyCardState(card, drop, nowMs = Date.now()) {
  const expiresAtMs = new Date(drop.expiresAt).getTime();
  const remaining = Math.max(0, Math.floor((expiresAtMs - nowMs) / 1000));

  const countdownNode = card.querySelector(`[data-countdown-for="${drop.id}"]`);
  const statusNode = card.querySelector(`[data-status-for="${drop.id}"]`);
  const statusText = card.querySelector(`[data-status-label="${drop.id}"]`);
  const button = card.querySelector("[data-acquire]");

  if (countdownNode) {
    countdownNode.textContent = formatCountdown(remaining);
    countdownNode.classList.remove("warning", "danger", "expired");
    countdownNode.classList.add(getCountdownClass(remaining));
  }

  card.classList.toggle("expiring", remaining > 0 && remaining < 30);
  card.classList.toggle("expired", remaining <= 0);

  if (statusNode && statusText) {
    if (drop.used) {
      statusText.textContent = "CONSUMED";
      statusNode.classList.add("expired");
      if (button) button.disabled = true;
    } else if (remaining <= 0) {
      statusText.textContent = "EXPIRED";
      statusNode.classList.add("expired");
      if (button) button.disabled = true;
    } else {
      statusText.textContent = "AVAILABLE";
      statusNode.classList.remove("expired");
      if (button) button.disabled = false;
    }
  }
}

function renderSignals(drops) {
  const grid = document.getElementById('signal-grid');
  const emptyState = document.getElementById('empty-state');

  // Always clear grid when rendering regular signals
  if (activeTab !== 'MINE') {
    // Remove any my-signal-card elements that shouldn't be here
    const myCards = document.querySelectorAll('.my-signal-card');
    myCards.forEach(c => c.remove());
  }

  if (activeTab === 'MINE') {
    renderMySignals();
    return;
  }

  const emptyTitle = emptyState?.querySelector('.empty-title');
  const emptyCopy = emptyState?.querySelector('.empty-copy');
  if (emptyTitle) emptyTitle.textContent = 'NO ACTIVE SIGNALS';
  if (emptyCopy) emptyCopy.textContent = 'Seller agents are standing by...';

  signalCache = Array.isArray(drops) ? drops : [];
  activeDropMeta = new Map(signalCache.map(drop => [drop.id, drop]));
  signalsById = activeDropMeta;

  const allVisible = signalCache.filter(drop =>
    !drop.used && Number(drop.secondsRemaining || 0) > 0
  );

  // Update tab counts
  ['ALL', 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].forEach(sev => {
    const count = sev === 'ALL'
      ? allVisible.length
      : allVisible.filter(d => (d.severity || 'MEDIUM').toUpperCase() === sev).length;
    const el = document.getElementById(`count-${sev}`);
    if (el) el.textContent = count;
  });
  const mineCount = document.getElementById('count-MINE');
  if (mineCount) mineCount.textContent = mySignals.length;

  setHeaderStats(allVisible.length);

  const liveBadge = document.getElementById('live-badge');
  if (liveBadge) liveBadge.textContent = `● ${allVisible.length} LIVE`;

  // Filter by active tab
  const visibleDrops = activeTab === 'ALL'
    ? allVisible
    : allVisible.filter(d => (d.severity || 'MEDIUM').toUpperCase() === activeTab);

  if (visibleDrops.length === 0) {
    grid.innerHTML = '';
    emptyState.classList.remove('hidden');
    return;
  }

  emptyState.classList.add('hidden');

  // Sort: CRITICAL first then by secondsRemaining ascending
  const sorted = [...visibleDrops].sort((a, b) => {
    const order = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
    const aOrder = order[(a.severity || 'MEDIUM').toUpperCase()] ?? 2;
    const bOrder = order[(b.severity || 'MEDIUM').toUpperCase()] ?? 2;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return Number(a.secondsRemaining) - Number(b.secondsRemaining);
  });

  // Get current card IDs in grid
  const currentCards = new Set(
    Array.from(grid.querySelectorAll('.signal-card')).map(c => c.dataset.dropId)
  );
  const newIds = new Set(sorted.map(d => d.id));

  // Remove cards that are no longer in the list (consumed/expired)
  Array.from(grid.querySelectorAll('.signal-card')).forEach(card => {
    if (!newIds.has(card.dataset.dropId)) {
      card.style.transition = 'opacity 0.3s';
      card.style.opacity = '0';
      setTimeout(() => card.remove(), 300);
    }
  });

  // Add new cards that aren't already in the grid
  sorted.forEach((drop, index) => {
    if (!currentCards.has(drop.id)) {
      const card = createSignalCard(drop, true);
      card.style.animationDelay = `${index * 40}ms`;
      grid.appendChild(card);
      discoveredIds.add(drop.id);
    }
  });
}

function initTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeTab = btn.dataset.severity;
      
      const grid = document.getElementById('signal-grid');
      grid.innerHTML = ''; // Always clear grid on tab switch
      
      if (activeTab === 'MINE') {
        renderMySignals();
      } else {
        const drops = Array.from(activeDropMeta.values());
        renderSignals(drops);
      }
    });
  });
}

function updateCountdowns() {
  document.querySelectorAll(".signal-card").forEach((card) => {
    const dropId = card.dataset.dropId;
    const drop = signalsById.get(dropId);
    if (!drop) return;
    applyCardState(card, drop, Date.now());
  });
}

function prependActivity(drop, label = "ACQUIRED") {
  const entry = {
    timestamp: new Date().toLocaleTimeString(),
    dropId: formatShortId(drop.id),
    tag: drop.tag || "unknown",
    sellerWallet: drop.sellerWallet || "",
    label,
  };

  activityItems.unshift(entry);
  activityItems = activityItems.slice(0, 5);
  renderActivityFeed();
  updateTicker();
}

function prependActivityItem(payloadData, _label) {
  prependActivity(payloadData, _label || "ACQUIRED");
}

function renderActivityFeed() {
  const feed = document.getElementById("activity-feed");

  if (activityItems.length === 0) {
    feed.innerHTML = '<div class="feed-empty">No acquisitions yet this session.</div>';
    return;
  }

  feed.innerHTML = activityItems
    .map(
      (item) => `
        <div class="feed-row">
          <span class="feed-time">${item.timestamp}</span>
          <span class="feed-id">DROP ${item.dropId}</span>
          <span class="feed-tag">${formatTag(item.tag)}</span>
          <span class="feed-seller">${item.sellerWallet ? `SELLER ${item.sellerWallet.slice(0, 8)}...` : 'SELLER n/a'}</span>
          <span class="feed-badge">${item.label || "ACQUIRED"}</span>
        </div>
      `,
    )
    .join("");
}

function updateTicker() {
  const ticker = document.getElementById("ticker-track");

  if (!ticker) return;

  if (activityItems.length === 0) {
    ticker.textContent = "[LIVE] Awaiting acquisitions from agents and operators...";
    return;
  }

  const text = activityItems
    .map(
      (item) => `[${item.timestamp}] DROP ${item.dropId} - ${item.tag} - ${item.label || "ACQUIRED"}`,
    )
    .join(" · ");

  ticker.textContent = `${text} · ${text} · `;
}

function openModal(content) {
  const overlay = document.getElementById("modal-overlay");
  const body = document.getElementById("modal-body");
  body.textContent = content;
  overlay.classList.remove("hidden");
}

function closeModal() {
  const overlay = document.getElementById("modal-overlay");
  overlay.classList.add("hidden");
  if (modalTimer) {
    clearTimeout(modalTimer);
    modalTimer = null;
  }
}

async function checkFreighterConnection() {
  await new Promise(r => setTimeout(r, 1500));
  if (typeof window.freighter !== 'undefined') {
    console.log('[Freighter] Found via window.freighter');
    return window.freighter;
  }
  if (typeof window.freighterApi !== 'undefined') {
    console.log('[Freighter] Found via window.freighterApi');
    return window.freighterApi;
  }
  console.log('[Freighter] Not found. window keys with freighter:',
    Object.keys(window).filter(k => k.toLowerCase().includes('freighter'))
  );
  return null;
}


async function connectWallet() {
  const btn = document.getElementById('connect-wallet-btn');
  const connectedUI = document.getElementById('wallet-connected-ui');
  const addressDisplay = document.getElementById('wallet-address-display');

  if (btn) btn.textContent = 'CONNECTING...';

  await new Promise(r => setTimeout(r, 1500));

  let publicKey = null;

  // METHOD 1: window.freighter (browser extension direct injection)
  if (typeof window.freighter !== 'undefined') {
    try {
      console.log('[Wallet] Trying window.freighter...');
      console.log('[Wallet] window.freighter methods:', Object.keys(window.freighter));

      if (typeof window.freighter.requestAccess === 'function') {
        await window.freighter.requestAccess();
      }

      if (typeof window.freighter.getPublicKey === 'function') {
        const result = await window.freighter.getPublicKey();
        publicKey = typeof result === 'string' ? result : result?.publicKey;
      } else if (typeof window.freighter.getAddress === 'function') {
        const result = await window.freighter.getAddress();
        publicKey = result?.address || result;
      }
    } catch(e) {
      console.log('[Wallet] window.freighter failed:', e.message);
    }
  }

  // METHOD 2: freighterApi CDN bundle named exports
  if (!publicKey && typeof window.freighterApi !== 'undefined') {
    try {
      console.log('[Wallet] Trying freighterApi...', Object.keys(window.freighterApi));
      const api = window.freighterApi;

      // CDN bundle exposes these as named functions, not methods
      if (typeof api.requestAccess === 'function') {
        await api.requestAccess();
      }

      // Try all possible function names
      if (typeof api.getPublicKey === 'function') {
        const result = await api.getPublicKey();
        publicKey = typeof result === 'string' ? result : result?.publicKey || result?.address;
      } else if (typeof api.getAddress === 'function') {
        const result = await api.getAddress();
        publicKey = result?.address || result;
      } else {
        // Log all available functions for debugging
        const fns = Object.entries(api).filter(([k, v]) => typeof v === 'function').map(([k]) => k);
        console.log('[Wallet] freighterApi available functions:', fns);

        // Try each function that might return a public key
        for (const fnName of fns) {
          if (fnName.toLowerCase().includes('key') || fnName.toLowerCase().includes('address') || fnName.toLowerCase().includes('public')) {
            try {
              const result = await api[fnName]();
              if (result && typeof result === 'string' && result.startsWith('G') && result.length === 56) {
                publicKey = result;
                console.log('[Wallet] Found key via', fnName);
                break;
              } else if (result && (result.publicKey || result.address)) {
                publicKey = result.publicKey || result.address;
                console.log('[Wallet] Found key via', fnName);
                break;
              }
            } catch(e) {}
          }
        }
      }
    } catch(e) {
      console.log('[Wallet] freighterApi failed:', e.message);
    }
  }

  if (!publicKey) {
    if (btn) btn.textContent = 'CONNECT WALLET';

    // Log everything for debugging
    console.log('[Wallet] All window keys with freighter/stellar:',
      Object.keys(window).filter(k => k.toLowerCase().includes('freighter') || k.toLowerCase().includes('stellar'))
    );

    alert(
      'Could not connect Freighter wallet.\n\n' +
      'Make sure:\n' +
      '1. Freighter extension is installed (https://freighter.app)\n' +
      '2. You are logged into Freighter\n' +
      '3. Freighter is set to TEST NET\n' +
      '4. Refresh the page and try again\n\n' +
      'Check browser console for debug info.'
    );
    return null;
  }

  // Validate testnet account and balance
  try {
    const response = await fetch('https://horizon-testnet.stellar.org/accounts/' + publicKey);
    if (!response.ok) {
      if (btn) btn.textContent = 'CONNECT WALLET';
      alert(
        'This wallet has no Stellar Testnet account.\n\n' +
        'Fund it for free at Friendbot:\n' +
        'https://friendbot.stellar.org?addr=' + publicKey + '\n\n' +
        'Opening Friendbot now...'
      );
      window.open('https://friendbot.stellar.org?addr=' + publicKey, '_blank');
      return null;
    }

    const data = await response.json();
    const xlmBalance = data.balances?.find(b => b.asset_type === 'native');
    const balance = parseFloat(xlmBalance?.balance || '0');

    if (balance < 1) {
      if (btn) btn.textContent = 'CONNECT WALLET';
      alert(
        `Low balance: ${balance} XLM\n\n` +
        'You need at least 1 XLM to acquire signals.\n\n' +
        'Get free testnet XLM from Friendbot:\n' +
        'https://friendbot.stellar.org?addr=' + publicKey
      );
      window.open('https://friendbot.stellar.org?addr=' + publicKey, '_blank');
      return null;
    }

    console.log(`[Wallet] ✓ Connected: ${publicKey} | Balance: ${balance} XLM`);

  } catch(e) {
    console.log('[Wallet] Balance check failed (non-blocking):', e.message);
  }

  connectedWalletKey = publicKey;

  if (btn) btn.style.display = 'none';
  if (connectedUI) connectedUI.classList.remove('hidden');
  if (addressDisplay) {
    addressDisplay.textContent = `${publicKey.slice(0,4)}...${publicKey.slice(-4)}`;
    addressDisplay.title = publicKey;
  }

  return publicKey;
}

function disconnectWallet() {
  connectedWalletKey = null;
  
  const connectBtn = document.getElementById('connect-wallet-btn');
  const connectedUI = document.getElementById('wallet-connected-ui');
  
  if (connectBtn) {
    connectBtn.textContent = 'CONNECT WALLET';
    connectBtn.classList.remove('connected');
    connectBtn.style.display = '';
  }
  if (connectedUI) connectedUI.classList.add('hidden');
  
  console.log('[Wallet] Disconnected');
}

function copyWalletAddress() {
  if (!connectedWalletKey) return;
  navigator.clipboard.writeText(connectedWalletKey).then(() => {
    const btn = document.getElementById('copy-address-btn');
    if (btn) {
      btn.textContent = '✓';
      setTimeout(() => { btn.textContent = '⎘'; }, 1500);
    }
  }).catch(e => {
    // Fallback for browsers that don't support clipboard API
    const el = document.createElement('textarea');
    el.value = connectedWalletKey;
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
  });
}

async function acquireWithFreighter(dropId, price) {
  const freighter = await window.getFreighterApi(5000);

  if (!freighter) {
    alert('Freighter wallet not detected.\n\nMake sure Freighter is installed, logged in, and set to TEST NET.');
    return;
  }

  try {
    // Connect wallet if not connected
    let publicKey = connectedWalletKey;

    if (!publicKey) {
      publicKey = await connectWallet();
      if (!publicKey) return;
    }

    // Step 1: Get 402 challenge with seller wallet info
    const r1 = await fetch(`${BACKEND}/drop/${dropId}`);

    if (r1.status === 410) { alert('Signal expired or consumed'); await refreshSignals(); return; }
    if (r1.status !== 402) throw new Error('Expected 402, got ' + r1.status);

    const challengeData = await r1.json();
    const sellerWallet = challengeData.sellerWallet;
    const requiredAmount = challengeData.amount || '0.10';

    if (!sellerWallet) throw new Error('No seller wallet in payment challenge');
    if (!sellerWallet || sellerWallet === 'GTESTSELLERWALLET123' || !sellerWallet.startsWith('G') || sellerWallet.length !== 56) {
      throw new Error('Invalid seller wallet address received from server: ' + sellerWallet);
    }

    console.log('[Payment] Seller wallet:', sellerWallet);
    console.log('[Payment] Required amount:', requiredAmount, 'XLM');

    // Step 2: Build Stellar payment transaction
    // Use Stellar SDK loaded from CDN
    if (typeof StellarSdk === 'undefined') {
      throw new Error('Stellar SDK not loaded');
    }

    const server = new StellarSdk.Horizon.Server('https://horizon-testnet.stellar.org');

    // Load buyer account
    const account = await server.loadAccount(publicKey);

    const transaction = new StellarSdk.TransactionBuilder(account, {
      fee: await server.fetchBaseFee(),
      networkPassphrase: StellarSdk.Networks.TESTNET
    })
    .addOperation(StellarSdk.Operation.payment({
      destination: sellerWallet,
      asset: StellarSdk.Asset.native(),
      amount: String(parseFloat(price) || 0.10)
    }))
    .addMemo(StellarSdk.Memo.text(`signal:${dropId.slice(0,18)}`))
    .setTimeout(30)
    .build();

    // Step 3: Sign with Freighter
    console.log('[Payment] Requesting Freighter signature...');
    const transactionXDR = transaction.toXDR();

    let signedXDR;
    try {
      const signResult = await freighter.signTransaction(transactionXDR, {
        networkPassphrase: StellarSdk.Networks.TESTNET
      });
      signedXDR = signResult.signedTxXdr || signResult;
    } catch (e) {
      throw new Error('Transaction signing cancelled or failed: ' + e.message);
    }

    // Step 4: Submit transaction to Stellar network
    console.log('[Payment] Submitting to Stellar testnet...');
    const signedTx = StellarSdk.TransactionBuilder.fromXDR(signedXDR, StellarSdk.Networks.TESTNET);
    const submitResult = await server.submitTransaction(signedTx);
    const txHash = submitResult.hash;

    console.log('[Payment] ✓ TX submitted:', txHash);

    // Step 5: Send TX hash to backend as payment proof

    const r2 = await fetch(`${BACKEND}/drop/${dropId}`, {
      headers: { 'X-PAYMENT': txHash }
    });

    if (r2.status === 410) { alert('Signal consumed during payment'); await refreshSignals(); return; }
    if (!r2.ok) throw new Error('Backend payment verification failed: ' + r2.status);

    const data = await r2.json();
    acquiredCount += 1;
    prependActivityItem(data, '✓ HUMAN ACQUIRED');
    showPayloadModal(data, dropId);
    await refreshSignals();

  } catch(err) {
    console.error('[Freighter]', err);
    alert('Purchase failed: ' + err.message);
    await refreshSignals();
  }
}

function showPayloadModal(payloadData, dropId) {
  addToMySignals(payloadData, dropId);

  const explorerUrl = payloadData.explorerUrl || '';
  const buyerKey = payloadData.buyerKey || 'unknown';
  const sellerWallet = payloadData.sellerWallet || 'unknown';
  const payload = payloadData.payload || '';

  // Format payload with line breaks preserved
  const formattedPayload = payload.split('\n').join('<br>');

  const overlay = document.getElementById('modal-overlay');
  const modalBody = document.getElementById('modal-body');

  modalBody.innerHTML = `
    <div style="border-bottom:1px solid var(--border);padding-bottom:1rem;margin-bottom:1rem;">
      <div style="font-size:0.7rem;color:var(--text-muted);margin-bottom:0.5rem;">DROP ${formatShortId(payloadData.id || dropId)} · ${payloadData.tag || 'unknown'} · ${payloadData.severity || 'MEDIUM'}</div>
      <div style="line-height:1.7;font-size:0.85rem;">${formattedPayload}</div>
    </div>
    <div style="font-size:0.7rem;color:var(--text-muted);line-height:1.8;">
      <div>SELLER : ${sellerWallet}</div>
      <div>BUYER &nbsp;&nbsp;&nbsp;: ${buyerKey}</div>
      <div>NETWORK : Stellar Testnet</div>
      <div>PAID AT : ${payloadData.paidAt ? new Date(payloadData.paidAt).toLocaleTimeString() : new Date().toLocaleTimeString()}</div>
    </div>
    ${explorerUrl ? `<a href="${explorerUrl}" target="_blank" style="display:block;margin-top:1rem;color:var(--green);font-size:0.8rem;text-decoration:none;letter-spacing:0.1em;">→ VIEW ON STELLAR EXPLORER</a>` : ''}
  `;

  overlay.classList.remove('hidden');
  modalTimer = setTimeout(closeModal, 20000);
}

async function checkAgentActivity() {
  try {
    const response = await fetch(`${BACKEND}/activity`);
    if (!response.ok) return;
    const activities = await response.json();

    agentScans = Math.max(agentScans, activities.length * 3);

    activities.forEach(activity => {
      if (!lastKnownConsumed.has(activity.dropId)) {
        lastKnownConsumed.add(activity.dropId);

        const price = parseFloat(activity.price || '0');
        agentAcquired += 1;
        agentSpent += price;

        addAgentLog(`→ Signal detected: ${activity.tag} [${activity.severity}]`, 'scanning');
        addAgentLog(`  [x402] 402 received — signing Stellar payment...`, 'paying');
        addAgentLog(`  ✓ Acquired DROP ${activity.dropId.slice(0,8)} — ${price} XLM`, 'success');

        const label = `⚡ AGENT ${activity.buyerKey || 'ACQUIRED'}`;

        prependActivityItem(
          { id: activity.dropId, tag: activity.tag, sellerWallet: activity.sellerWallet },
          label
        );
      }
    });

    updateAgentStats();

    agentScans += 1;
    addAgentLog(`Scanning /drops... ${signalCache.length} signals found`, 'scanning');
    updateAgentStats();

  } catch(e) {}
}

async function refreshSignals() {
  const drops = await fetchDrops();
  renderSignals(drops);
}

function wireInteractions() {
  const grid = document.getElementById("signal-grid");
  const modalClose = document.getElementById("modal-close");
  const modalOverlay = document.getElementById("modal-overlay");

  grid.addEventListener("click", (event) => {
    const button = event.target.closest("[data-acquire]");
    if (!button || button.disabled) return;

    const dropId = button.getAttribute("data-acquire");
    const price = button.getAttribute("data-price") || "0.00";
    acquireWithFreighter(dropId, price);
  });

  modalClose.addEventListener("click", closeModal);

  modalOverlay.addEventListener("click", (event) => {
    if (event.target === modalOverlay) {
      closeModal();
    }
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  loadMySignals();
  const countEl = document.getElementById('count-MINE');
  if (countEl) countEl.textContent = mySignals.length;
  addAgentLog('Waiting for agent activity...', 'muted');
  initTabs();
  renderActivityFeed();
  updateTicker();
  document.getElementById('connect-wallet-btn')?.addEventListener('click', connectWallet);
  document.getElementById('disconnect-wallet-btn')?.addEventListener('click', disconnectWallet);
  document.getElementById('copy-address-btn')?.addEventListener('click', copyWalletAddress);
  document.getElementById('wallet-address-display')?.addEventListener('click', copyWalletAddress);
  wireInteractions();
  await checkAgentActivity();
  await refreshSignals();
  updateCountdowns();

  setInterval(refreshSignals, POLL_INTERVAL);
  setInterval(checkAgentActivity, 8000);
  setInterval(updateCountdowns, COUNTDOWN_INTERVAL);
});

