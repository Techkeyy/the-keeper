const BACKEND = "";
const POLL_INTERVAL = 15000;
const COUNTDOWN_INTERVAL = 1000;

let signalsById = new Map();
let acquiredCount = 0;
let activityItems = [];
let modalTimer = null;
let lastKnownConsumed = new Set();
let signalCache = [];
let activeDropMeta = new Map();
let discoveredIds = new Set();
let activeTab = 'ALL';
let agentScans = 0;
let agentAcquired = 0;
let agentSpent = 0;
let agentLogEntries = [];
let connectedWalletKey = null;

// MY SIGNALS - persisted in localStorage
let mySignals = [];

function loadMySignals() {
  try {
    const stored = localStorage.getItem('thekeeper-purchases');
    mySignals = stored ? JSON.parse(stored) : [];
    // Clean up expired signals older than 7 days
    const cutoff = Date.now() - (7 * 24 * 60 * 60 * 1000);
    mySignals = mySignals.filter(s => new Date(s.purchasedAt).getTime() > cutoff);
    saveMySignals();
  } catch(e) {
    mySignals = [];
  }
}

function saveMySignals() {
  try {
    localStorage.setItem('thekeeper-purchases', JSON.stringify(mySignals));
  } catch(e) {}
}

function addToMySignals(payloadData, dropId) {
  const signal = {
    id: payloadData.id || dropId,
    tag: payloadData.tag || 'unknown',
    severity: payloadData.severity || 'MEDIUM',
    payload: payloadData.payload || '',
    buyerKey: payloadData.buyerKey || 'unknown',
    txHash: payloadData.txHash || null,
    explorerUrl: payloadData.explorerUrl || null,
    purchasedAt: new Date().toISOString(),
    expiresAt: payloadData.expiresAt || null,
    price: payloadData.price || '0.00'
  };

  // Avoid duplicates
  if (!mySignals.find(s => s.id === signal.id)) {
    mySignals.unshift(signal);
    saveMySignals();
  }

  // Update MY SIGNALS tab count
  const countEl = document.getElementById('count-MINE');
  if (countEl) countEl.textContent = mySignals.length;
}

function renderMySignals() {
  const grid = document.getElementById('signal-grid');
  const emptyState = document.getElementById('empty-state');
  const emptyTitle = emptyState?.querySelector('.empty-title');
  const emptyCopy = emptyState?.querySelector('.empty-copy');

  if (mySignals.length === 0) {
    grid.innerHTML = '';
    emptyState.classList.remove('hidden');
    if (emptyTitle) emptyTitle.textContent = 'NO PURCHASED SIGNALS';
    if (emptyCopy) emptyCopy.textContent = 'Signals you acquire will appear here.';
    return;
  }

  emptyState.classList.add('hidden');
  grid.innerHTML = '';

  mySignals.forEach(signal => {
    const card = document.createElement('div');
    card.className = 'my-signal-card';

    const now = Date.now();
    const expiresAt = signal.expiresAt ? new Date(signal.expiresAt).getTime() : null;
    const isExpired = Boolean(expiresAt && now > expiresAt);
    if (isExpired) card.classList.add('my-signal-expired');

    const secondsLeft = expiresAt ? Math.max(0, Math.floor((expiresAt - now) / 1000)) : null;
    const expiryText = isExpired
      ? 'EXPIRED'
      : secondsLeft
        ? formatCountdown(secondsLeft)
        : 'NO EXPIRY';

    const purchasedTime = new Date(signal.purchasedAt).toLocaleTimeString();

    card.innerHTML = `
      <div class="signal-acquired-badge">✓ ACQUIRED AT ${purchasedTime}</div>
      <div class="card-top">
        <span class="tag-badge">${signal.tag}</span>
        <span class="severity severity-${signal.severity.toLowerCase()}">${signal.severity}</span>
        <span class="price">${signal.price} XLM</span>
        <span class="drop-id">${signal.id.slice(0,8)}</span>
      </div>
      <div class="signal-payload-full">${signal.payload.replace(/\n/g, '<br>')}</div>
      <div class="signal-meta-row">
        <span>BUYER: ${signal.buyerKey}</span>
        <span>NETWORK: Stellar Testnet</span>
        <span class="my-signal-expires">${expiryText}</span>
      </div>
      ${signal.explorerUrl ? `<a class="explorer-link" href="${signal.explorerUrl}" target="_blank">→ VIEW ON STELLAR EXPLORER</a>` : ''}
    `;

    grid.appendChild(card);
  });
}

function formatTimeLabel() {
  return new Date().toLocaleTimeString();
}

function formatShortId(id) {
  return String(id || "").slice(0, 8);
}

function formatTag(tag) {
  return String(tag || "unknown").replace(/_/g, " ").toUpperCase();
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function formatCountdown(secondsRemaining) {
  if (secondsRemaining <= 0) return 'EXPIRED';

  const days = Math.floor(secondsRemaining / 86400);
  const hours = Math.floor((secondsRemaining % 86400) / 3600);
  const minutes = Math.floor((secondsRemaining % 3600) / 60);
  const seconds = secondsRemaining % 60;

  if (days > 0) {
    return `EXPIRES IN ${days}d ${pad(hours)}h`;
  }
  if (hours > 0) {
    return `EXPIRES IN ${pad(hours)}h ${pad(minutes)}m`;
  }
  return `EXPIRES IN ${pad(minutes)}:${pad(seconds)}`;
}

function getCountdownClass(secondsRemaining) {
  if (secondsRemaining <= 0) return "expired";
  if (secondsRemaining < 30) return "danger";
  return "warning";
}

function setHeaderStats(liveCount) {
  const liveEl = document.getElementById('live-count');
  const acquiredEl = document.getElementById('acquired-count');
  const liveBadge = document.getElementById('live-badge');
  if (liveEl) liveEl.textContent = `${liveCount} LIVE SIGNALS`;
  if (acquiredEl) acquiredEl.textContent = `${acquiredCount} ACQUIRED`;
  if (liveBadge) liveBadge.textContent = `● ${liveCount} LIVE`;
}

function addAgentLog(message, type = 'scanning') {
  const time = formatTimeLabel();
  agentLogEntries.unshift({ time, message, type });
  agentLogEntries = agentLogEntries.slice(0, 20);

  const log = document.getElementById('agent-log');
  if (!log) return;

  log.innerHTML = agentLogEntries.map(entry => `
    <div class="agent-log-entry ${entry.type}">
      <span class="feed-time">[${entry.time}]</span> ${entry.message}
    </div>
  `).join('');
}

function updateAgentStats() {
  const scansEl = document.getElementById('agent-scans');
  const acquiredEl = document.getElementById('agent-acquired');
  const spentEl = document.getElementById('agent-spent');
  if (scansEl) scansEl.textContent = agentScans;
  if (acquiredEl) acquiredEl.textContent = agentAcquired;
  if (spentEl) spentEl.textContent = agentSpent.toFixed(2);
}

async function fetchDrops() {
  try {
    const response = await fetch(`${BACKEND}/drops`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const data = await response.json();
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error("[frontend] Failed to fetch drops:", error.message);
    console.error("[frontend] Backend URL:", BACKEND);
    return [];
  }
}

function createSignalCard(drop, isNew) {
  const card = document.createElement("article");
  card.className = "signal-card";
  card.dataset.dropId = drop.id;
  const secondsRemaining = Number(drop.secondsRemaining || 0);
  const countdownClass = getCountdownClass(secondsRemaining);

  function buildPreview(dropData) {
    const tag = dropData.tag || '';
    const teaser = dropData.teaser || '';
    const severity = dropData.severity || 'MEDIUM';

    const domainMap = {
      trading_signal: 'Market activity detected',
      logistics_alert: 'Supply chain development',
      intelligence: 'Intelligence report available',
      research: 'Research finding available',
      weather_alert: 'Environmental event flagged',
      sports_intel: 'Sports market movement'
    };

    const domain = domainMap[tag] || 'Signal available';

    // Extract first meaningful phrase from teaser
    // Split by '.', take first sentence, strip generic words
    const sentences = teaser.split('.');
    const first = sentences[0] ? sentences[0].trim() : '';

    // If first sentence exists and is not too generic
    // (not just "Signal content encrypted" or similar)
    const isGeneric = first.toLowerCase().includes('encrypted')
      || first.toLowerCase().includes('purchase to reveal')
      || first.length < 15;

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

