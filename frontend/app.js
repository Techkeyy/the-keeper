const BACKEND = "http://localhost:4000";
const POLL_INTERVAL = 5000;
const COUNTDOWN_INTERVAL = 1000;

let signalsById = new Map();
let acquiredCount = 0;
let activityItems = [];
let modalTimer = null;
let lastKnownConsumed = new Set();

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
  document.getElementById("live-count").textContent = `${liveCount} LIVE`;
  document.getElementById("live-badge-count").textContent = `${liveCount} LIVE`;
  document.getElementById("acquired-count").textContent = `${acquiredCount} ACQUIRED`;
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

  if (isNew) {
    card.classList.add("new-card");
    setTimeout(() => card.classList.remove("new-card"), 600);
  }

  card.innerHTML = `
    <div class="card-top">
      <span class="tag-badge">${drop.tag || 'UNKNOWN'}</span>
      <span class="severity severity-${(drop.severity || 'medium').toLowerCase()}">${drop.severity || 'MEDIUM'}</span>
      <span class="price">${drop.price || '0.00'} USDC</span>
      <span class="drop-id">${formatShortId(drop.id)}</span>
    </div>
    <div class="teaser">${drop.teaser || 'Signal content encrypted. Purchase to reveal.'}</div>
    <div class="countdown ${countdownClass}" data-countdown-for="${drop.id}">${formatCountdown(secondsRemaining)}</div>
    <div class="status-row">
      <span class="status" data-status-for="${drop.id}"><span class="status-dot"></span><span data-status-label="${drop.id}">${drop.used ? 'CONSUMED' : secondsRemaining <= 0 ? 'EXPIRED' : 'AVAILABLE'}</span></span>
      <button type="button" class="acquire-btn" data-acquire="${drop.id}" data-price="${drop.price || '0.00'}" ${drop.used || secondsRemaining <= 0 ? 'disabled' : ''}>
        ACQUIRE - ${drop.price || '0.00'} USDC
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
  const grid = document.getElementById("signal-grid");
  const emptyState = document.getElementById("empty-state");

  const visible = (Array.isArray(drops) ? drops : []).filter(
    (drop) => !drop.used && Number(drop.secondsRemaining || 0) > 0,
  );

  const incoming = new Map(visible.map((drop) => [drop.id, drop]));
  signalsById = incoming;

  const existingCards = new Map();
  grid.querySelectorAll(".signal-card").forEach((card) => {
    existingCards.set(card.dataset.dropId, card);
  });

  for (const [dropId, card] of existingCards.entries()) {
    if (!incoming.has(dropId)) {
      card.remove();
    }
  }

  for (const drop of visible) {
    let card = existingCards.get(drop.id);
    if (!card) {
      card = createSignalCard(drop, true);
      grid.appendChild(card);
    }
    applyCardState(card, drop);
  }

  setHeaderStats(visible.length);
  emptyState.classList.toggle("hidden", visible.length > 0);
}

function updateCountdowns() {
  const now = Date.now();
  document.querySelectorAll(".signal-card").forEach((card) => {
    const dropId = card.dataset.dropId;
    const drop = signalsById.get(dropId);
    if (!drop) return;
    applyCardState(card, drop, now);
  });
}

function prependActivity(drop, label = "ACQUIRED") {
  const entry = {
    timestamp: new Date().toLocaleTimeString(),
    dropId: formatShortId(drop.id),
    tag: drop.tag || "unknown",
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
  // Give extension time to inject if page just loaded
  if (!window._freighterReady) {
    await new Promise(r => setTimeout(r, 1000));
  }

  if (typeof window.freighter !== 'undefined') return window.freighter;
  if (typeof window.freighterApi !== 'undefined') return window.freighterApi;
  return null;
}

async function acquireWithFreighter(dropId, price) {
  const freighter = await checkFreighterConnection();

  if (!freighter) {
    alert(
      'Freighter wallet not found.\n\n' +
      'Steps to fix:\n' +
      '1. Install Freighter from https://freighter.app\n' +
      '2. Open Freighter and switch to TEST NET\n' +
      '3. Make sure you are logged in\n' +
      '4. Hard refresh this page (Ctrl+Shift+R)\n' +
      '5. Try again'
    );
    return;
  }

  try {
    // Trigger connection popup
    let publicKey;
    try {
      // requestAccess triggers the Freighter popup asking user to connect
      await freighter.requestAccess();
      const result = await freighter.getPublicKey();
      publicKey = typeof result === 'string' ? result : result.publicKey;
    } catch(e) {
      throw new Error('Freighter connection failed: ' + e.message);
    }

    if (!publicKey) throw new Error('No public key from Freighter');

    // Get 402 challenge
    const r1 = await fetch(`${BACKEND}/drop/${dropId}`);
    if (r1.status === 410) { alert('Signal expired or consumed'); await refreshSignals(); return; }
    if (r1.status !== 402) throw new Error('Expected 402, got ' + r1.status);

    const challengeData = await r1.json();
    const challenge = challengeData.x402Challenge;
    if (!challenge) throw new Error('No x402Challenge in response');

    // Sign with Freighter
    let signed;
    try {
      const signResult = await freighter.signMessage(challenge, 'UTF-8');
      signed = signResult.signedMessage || signResult.signature || signResult;
    } catch(e) {
      throw new Error('Signing cancelled or failed: ' + e.message);
    }

    // Submit payment
    const paymentHeader = `stellar:${publicKey}:${signed}`;
    const r2 = await fetch(`${BACKEND}/drop/${dropId}`, {
      headers: { 'X-PAYMENT': paymentHeader }
    });

    if (r2.status === 410) { alert('Signal consumed during payment'); await refreshSignals(); return; }
    if (!r2.ok) throw new Error('Payment rejected: ' + r2.status);

    const data = await r2.json();
    acquiredCount += 1;
    prependActivityItem(data, '✓ HUMAN ACQUIRED');
    showPayloadModal(data, dropId);
    await refreshSignals();

  } catch(err) {
    console.error('[Freighter]', err);
    alert('Failed: ' + err.message);
    await refreshSignals();
  }
}

function showPayloadModal(payloadData, dropId) {
  const modalContent = [
    '━━━━━━━━━━━━━━━━━━━━',
    `DROP ID  : ${formatShortId(payloadData.id || dropId)}`,
    `TAG      : ${payloadData.tag || 'unknown'}`,
    `SEVERITY : ${payloadData.severity || 'MEDIUM'}`,
    `PAYLOAD  : ${payloadData.payload || ''}`,
    '━━━━━━━━━━━━━━━━━━━━',
    'Verified on Stellar Testnet'
  ].join('\n');
  openModal(modalContent);
  modalTimer = setTimeout(closeModal, 10000);
}

async function checkAgentActivity() {
  try {
    const response = await fetch(`${BACKEND}/activity`);
    if (!response.ok) return;
    const activities = await response.json();

    activities.forEach(activity => {
      if (!lastKnownConsumed.has(activity.dropId)) {
        lastKnownConsumed.add(activity.dropId);
        const label = activity.acquiredBy === 'agent' ? '⚡ AGENT ACQUIRED' : '✓ ACQUIRED';
        prependActivityItem(
          { id: activity.dropId, tag: activity.tag },
          label
        );
      }
    });
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
  renderActivityFeed();
  updateTicker();
  wireInteractions();
  await checkAgentActivity();
  await refreshSignals();
  updateCountdowns();

  setInterval(refreshSignals, POLL_INTERVAL);
  setInterval(checkAgentActivity, 8000);
  setInterval(updateCountdowns, COUNTDOWN_INTERVAL);
});
