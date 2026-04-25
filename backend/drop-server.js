const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const Database = require('better-sqlite3');
const { createX402Middleware } = require("./x402-middleware");

const app = express();
const corsOptions = {
  origin: function(origin, callback) {
    callback(null, true);
  },
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-PAYMENT'],
  credentials: false
};
app.use(cors(corsOptions));
app.options('*', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, X-PAYMENT');
  res.sendStatus(200);
});

dotenv.config({ path: path.join(__dirname, ".env") });

const PORT = Number(process.env.PORT || 4000);
const ENCRYPTION_KEY_HEX = process.env.ENCRYPTION_KEY;
const ALGORITHM = "aes-256-gcm";
const DEFAULT_TTL_SECONDS = 300;
const CLEANUP_INTERVAL_MS = 30_000;
const VALID_TAGS = new Set([
  "trading_signal",
  "logistics_alert",
  "intelligence",
  "research",
  "weather_alert",
  "sports_intel",
]);
const VALID_SEVERITIES = new Set(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);

if (!ENCRYPTION_KEY_HEX || !/^[0-9a-fA-F]{64}$/.test(ENCRYPTION_KEY_HEX)) {
  throw new Error("ENCRYPTION_KEY must be a 64-char hex string (32 bytes)");
}

const ENCRYPTION_KEY = Buffer.from(ENCRYPTION_KEY_HEX, "hex");
if (ENCRYPTION_KEY.length !== 32) {
  throw new Error("ENCRYPTION_KEY must decode to exactly 32 bytes");
}

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'signals.db');
const db = new Database(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS drops (
    id TEXT PRIMARY KEY,
    encryptedPayload TEXT NOT NULL,
    iv TEXT NOT NULL,
    authTag TEXT NOT NULL,
    price TEXT NOT NULL,
    tag TEXT NOT NULL,
    teaser TEXT,
    severity TEXT DEFAULT 'MEDIUM',
    sellerWallet TEXT NOT NULL,
    used INTEGER DEFAULT 0,
    createdAt TEXT NOT NULL,
    expiresAt TEXT NOT NULL,
    ttl INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dropId TEXT NOT NULL,
    tag TEXT,
    severity TEXT,
    price TEXT,
    sellerWallet TEXT,
    acquiredAt TEXT,
    acquiredBy TEXT,
    buyerKey TEXT,
    txHash TEXT,
    explorerUrl TEXT
  );
`);

function encryptPayload(payload) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
  const encryptedPayload = Buffer.concat([
    cipher.update(Buffer.from(payload, "utf8")),
    cipher.final(),
  ]);

  return {
    encryptedPayload: encryptedPayload.toString("hex"),
    iv: iv.toString("hex"),
    authTag: cipher.getAuthTag().toString("hex"),
  };
}

function decryptPayload(drop) {
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    ENCRYPTION_KEY,
    Buffer.from(drop.iv, "hex"),
  );
  decipher.setAuthTag(Buffer.from(drop.authTag, "hex"));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(drop.encryptedPayload, "hex")),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}

function parseTtl(ttl) {
  if (ttl === undefined || ttl === null || ttl === "") {
    return DEFAULT_TTL_SECONDS;
  }

  const ttlNumber = Number(ttl);
  if (!Number.isInteger(ttlNumber) || ttlNumber <= 0) {
    return null;
  }

  return ttlNumber;
}

function isExpired(drop, nowMs = Date.now()) {
  return new Date(drop.expiresAt).getTime() < nowMs;
}

function getSecondsRemaining(expiresAtIso, nowMs = Date.now()) {
  const expiresMs = new Date(expiresAtIso).getTime();
  return Math.max(0, Math.floor((expiresMs - nowMs) / 1000));
}

function cleanupExpiredDrops() {
  const nowMs = Date.now();
  const result = db.prepare(`DELETE FROM drops WHERE expiresAt < ?`).run(new Date(nowMs).toISOString());
  console.log(`[cleanup] Removed ${result.changes} expired drops`);
  return result.changes;
}

function validateCreateDropBody(body) {
  const { payload, teaser, severity, price, tag, sellerWallet, ttl } = body || {};

  if (typeof payload !== "string" || payload.trim().length === 0) {
    return "payload must be a non-empty string";
  }

  if (typeof price !== "string" || !/^\d+(\.\d{1,2})?$/.test(price)) {
    return "price must be a string amount like 0.10";
  }

  if (!VALID_TAGS.has(tag)) {
    return "tag must be one of: trading_signal, logistics_alert, intelligence, research, weather_alert, sports_intel";
  }

  if (teaser !== undefined) {
    if (typeof teaser !== "string") {
      return "teaser must be a string";
    }

    if (teaser.length > 100) {
      return "teaser must be at most 100 chars";
    }
  }

  if (severity !== undefined && !VALID_SEVERITIES.has(String(severity).toUpperCase())) {
    return "severity must be LOW, MEDIUM, HIGH, or CRITICAL";
  }

  if (typeof sellerWallet !== "string" || sellerWallet.trim().length === 0) {
    return "sellerWallet must be a non-empty string";
  }

  const parsedTtl = parseTtl(ttl);
  if (parsedTtl === null) {
    return "ttl must be a positive integer in seconds";
  }

  return null;
}

function buildDropIndexItem(drop, nowMs = Date.now()) {
  return {
    id: drop.id,
    price: drop.price,
    tag: drop.tag,
    teaser: drop.teaser,
      severity: drop.severity || 'MEDIUM',
    used: drop.used,
    expiresAt: drop.expiresAt,
    ttl: drop.ttl,
    secondsRemaining: getSecondsRemaining(drop.expiresAt, nowMs),
  };
}

function getDropById(id) {
  const row = db.prepare(`SELECT * FROM drops WHERE id = ?`).get(id);
  if (!row) return null;
  return { ...row, used: row.used === 1 };
}

app.use(express.json({ limit: "1mb" }));

app.post("/drop", (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, X-PAYMENT');
  const validationError = validateCreateDropBody(req.body);
  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  const { payload, price, tag, sellerWallet } = req.body;
  const teaser = typeof req.body.teaser === "string" && req.body.teaser.length > 0
    ? req.body.teaser
    : "Signal content encrypted. Purchase to reveal.";
  const severity = VALID_SEVERITIES.has(String(req.body.severity || "").toUpperCase())
    ? String(req.body.severity).toUpperCase()
    : "MEDIUM";
  const ttl = parseTtl(req.body.ttl);
  const createdAtDate = new Date();
  const createdAt = createdAtDate.toISOString();
  const expiresAt = new Date(createdAtDate.getTime() + ttl * 1000).toISOString();

  const encrypted = encryptPayload(payload);
  const id = uuidv4();

  db.prepare(`
  INSERT INTO drops (id, encryptedPayload, iv, authTag, price, tag, teaser, severity, sellerWallet, used, createdAt, expiresAt, ttl)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
`).run(id, encrypted.encryptedPayload, encrypted.iv, encrypted.authTag, price, tag, teaser, severity, sellerWallet, createdAt, expiresAt, ttl);

  return res.status(201).json({
    id,
    price,
    tag,
    teaser,
    severity,
    expiresAt,
    ttl,
  });
});

app.get("/drops", (_req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, X-PAYMENT');
  const nowMs = Date.now();
  const rows = db.prepare(`SELECT * FROM drops WHERE used = 0 AND expiresAt > ?`).all(new Date(nowMs).toISOString());
  const visible = rows.map(row => buildDropIndexItem({ ...row, used: false }, nowMs));

  return res.json(visible);
});

const x402Middleware = createX402Middleware({ getDropById });
app.get("/drop/:id", x402Middleware, (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, X-PAYMENT');
  const drop = getDropById(req.params.id);

  if (!drop) {
    return res.status(404).json({ error: "Signal not found" });
  }

  if (isExpired(drop)) {
    return res.status(410).json({ error: "Signal expired" });
  }

  if (drop.used) {
    return res.status(410).json({ error: "Signal already consumed" });
  }

  try {
    const id = drop.id;
    const payload = decryptPayload(drop);
    db.prepare('UPDATE drops SET used = 1 WHERE id = ?').run(drop.id);

    console.log('[activity] Logging acquisition for drop:', drop.id);

    db.prepare(`
  INSERT INTO activity_log (dropId, tag, severity, price, sellerWallet, acquiredAt, acquiredBy, buyerKey, txHash, explorerUrl)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run(
  drop.id, drop.tag, drop.severity || 'MEDIUM', drop.price || '0.00',
  drop.sellerWallet || '', new Date().toISOString(),
  req.buyerPublicKey ? 'agent' : 'unknown',
  req.buyerPublicKey ? req.buyerPublicKey.slice(0, 8) + '...' : 'unknown',
  req.txHash || null, req.explorerUrl || null
);

    return res.json({
      id,
      payload,
      tag: drop.tag,
      severity: drop.severity || 'MEDIUM',
      price: drop.price,
      sellerWallet: drop.sellerWallet || '',
      expiresAt: drop.expiresAt,
      buyerKey: req.buyerPublicKey ? req.buyerPublicKey.slice(0, 8) + '...' : 'unknown',
      paidAt: new Date().toISOString(),
      network: 'stellar-testnet',
      txHash: req.txHash || null,
      explorerUrl: req.explorerUrl || `https://stellar.expert/explorer/testnet/account/${req.buyerPublicKey || ''}`
    });
  } catch (error) {
    return res.status(500).json({ error: "Failed to decrypt signal", details: error.message });
  }
});

app.delete("/drops/expired", (_req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, X-PAYMENT');
  const removed = cleanupExpiredDrops();
  return res.json({ removed });
});

app.get('/activity', (_req, res) => {
  const rows = db.prepare(`SELECT * FROM activity_log ORDER BY id DESC LIMIT 20`).all();
  res.json(rows);
});

const publicPath = path.join(__dirname, 'public');
app.use(express.static(publicPath));

app.use((err, _req, res, _next) => {
  console.error('[server]', err.message);
  return res.status(500).json({ error: 'Unexpected server error' });
});

setInterval(() => {
  cleanupExpiredDrops();
}, CLEANUP_INTERVAL_MS);

app.listen(PORT, () => {
  console.log(`TheKeeper drop server listening on port ${PORT}`);
});







