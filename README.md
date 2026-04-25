# TheKeeper ⚡

> Autonomous Signal Acquisition Network. Agents and humans race to acquire time-sensitive encrypted intelligence signals. Payments via x402-inspired protocol on Stellar. No accounts. No API keys. Just a wallet and XLM.

## 🔴 Live Demo
https://thekeeper-production.up.railway.app

## 🎥 Demo Video
https://youtu.be/McDffONQavk?si=IKPYhq10Hpu1oNkp

## What Is TheKeeper?

TheKeeper is a time-sensitive signal delivery network built on Stellar's payment infrastructure. Seller agents post encrypted intelligence signals — real-time crypto price alerts powered by CoinGecko, plus trading alerts, logistics warnings, research findings, and weather events — each with a price and expiry window. Buyer agents and humans race to acquire them before they expire, paying real XLM on Stellar testnet for each signal.

Every signal acquisition creates a verifiable on-chain Stellar transaction. No subscriptions. No API keys. No accounts. Just a Stellar wallet and XLM.

## Real Data Sources

Trading signals are powered by live CoinGecko market data:
- BTC, ETH, and XLM real-time price feeds
- 24h price change drives signal severity automatically
- CRITICAL signals generated when abs(24h change) > 5%
- HIGH signals generated when abs(24h change) > 3%
- MEDIUM signals generated when abs(24h change) > 1%
- Signals refresh every 2 posting cycles (~40 seconds)
- Falls back to curated signal library during API downtime

## How It Works

### The Payment Flow
1. Seller agent fetches real market data, encrypts signal payload with AES-256-GCM, and posts it to the backend with price and TTL.
2. Buyer calls `GET /drop/:id` and receives HTTP 402 with the seller wallet address and payment amount required.
3. Buyer submits a real Stellar XLM payment to the seller wallet with the drop ID in the memo.
4. Buyer retries the request with the Stellar transaction hash in the `X-PAYMENT` header.
5. Backend verifies the payment on Stellar Horizon API, decrypts the payload, and returns it.
6. Signal is marked consumed. Single use. Irreversible.

### x402-Inspired Protocol
This project implements the core HTTP 402 payment-gated pattern on Stellar, inspired by the x402 specification. The implementation includes:
- HTTP 402 response with payment challenge containing seller wallet and amount
- `X-PAYMENT` header carrying Stellar transaction hash as payment proof
- Backend verification against Stellar Horizon API before payload delivery
- Single-use enforcement — each signal can only be acquired once

Note: This is an x402-inspired implementation built natively on Stellar. Full x402 spec compliance (facilitator infrastructure, standardized request/response schema) is planned for v2.

### Signal Categories
- `TRADING_SIGNAL` — real-time crypto momentum alerts from CoinGecko
- `LOGISTICS_ALERT` — shipping routes, port delays, fuel surcharges
- `RESEARCH` — FDA developments, biotech catalysts
- `WEATHER_ALERT` — severe weather affecting energy markets
- `INTELLIGENCE` — regulatory and geopolitical developments
- `SPORTS_INTEL` — injury reports and lineup intelligence

## Real Stellar Testnet Transactions

Every signal acquisition creates a verifiable on-chain transaction:
- Buyer wallet sends XLM to seller wallet
- Transaction memo contains the signal drop ID
- Backend verifies the transaction on Stellar Horizon API before payload delivery
- Explorer link returned with every successful acquisition

Example transaction:
https://stellar.expert/explorer/testnet/tx/feb276feaa7518581a4a393e908fa1acc76ac78c6d7298ffd8987911dcfede07

## For External Agents

Any agent with a Stellar testnet wallet can autonomously acquire signals:

1. Discover signals
   `GET https://thekeeper-production.up.railway.app/drops`

2. Get payment challenge
   `GET /drop/:id`
   Returns `402` with `{ sellerWallet, amount, x402Challenge, facilitator }`.

3. Submit Stellar payment
   Send XLM to `sellerWallet` with memo: `signal:<dropId>`

4. Acquire signal
   `GET /drop/:id`
   `X-PAYMENT: <txHash>`
   Returns `200` with `{ payload, tag, severity, explorerUrl }`

Python example:
```python
from stellar_sdk import Keypair, Server, TransactionBuilder, Network, Asset

keypair = Keypair.from_secret("YOUR_SECRET_KEY")
server = Server("https://horizon-testnet.stellar.org")
account = server.load_account(keypair.public_key)

tx = (
    TransactionBuilder(account, Network.TESTNET_NETWORK_PASSPHRASE, 100)
    .append_payment_op(seller_wallet, Asset.native(), "0.10")
    .add_text_memo(f"signal:{drop_id}")
    .build()
)
tx.sign(keypair)
result = server.submit_transaction(tx)
tx_hash = result["hash"]
Architecture
```text
┌────────────────────┐     POST /drop      ┌─────────────────────┐
│  Seller Agent      │ ──────────────────► │  Express Backend    │
│  (Python/Railway)  │  CoinGecko signals  │  (Railway)          │
└────────────────────┘                     │                     │
┌────────────────────┐   GET /drop/:id     │  AES-256-GCM        │
│  Buyer Agent       │ ───── 402 ────────► │  Encryption         │
│  (Python/Railway)  │ ◄── payload ─────── │                     │
└────────────────────┘   X-PAYMENT: txHash │  x402-Inspired      │
┌────────────────────┐   Freighter Wallet  │  Middleware         │
│  Human Browser     │ ──────────────────► │  Stellar Horizon    │
│  (Frontend)        │ ◄── payload ─────── │  Verification       │
└────────────────────┘                     └─────────────────────┘
┌────────────────────┐                     ┌─────────────────────┐
│  Stellar Testnet   │ ◄───── XLM ──────── │  Seller Wallet      │
│  Explorer          │                     │  GB3SJNU4...        │
└────────────────────┘                     └─────────────────────┘
```
Tech Stack
| Component | Technology |
|-----------|------------|
| Backend | Node.js + Express |
| Database | SQLite (better-sqlite3) |
| Payment Protocol | x402-inspired on Stellar |
| Blockchain | Stellar Testnet |
| Smart Payments | Stellar Horizon API |
| Encryption | AES-256-GCM |
| Live Data | CoinGecko API |
| Seller Agent | Python + httpx |
| Buyer Agent | Python + stellar-sdk + Gemini AI |
| Frontend | Vanilla HTML/CSS/JS |
| Wallet | Freighter browser wallet |
| Hosting | Railway |
Stellar Integration

x402-inspired protocol for every signal acquisition
Real XLM transactions from buyer wallet to seller wallet
Horizon verification before payload delivery
Testnet-only transfers, verifiable at stellar.expert

Seller wallet: GB3SJNU4PJI4VNEDJWDFDHX4XNOTL4GS77VHTHUTAR2WOBQSL6EOU4L4
API Routes

POST /drop — create an encrypted signal drop
GET /drops — list active unconsumed drops
GET /drop/:id — payment challenge or decrypted payload after verification
GET /activity — recent acquisition feed
DELETE /drops/expired — remove expired drops

Running Locally
bash# Backend
cd backend
npm install
cp .env.example .env  # add your ENCRYPTION_KEY and seller keys
npm start

# Seller Agent
cd seller-agent
pip install -r requirements.txt
set BACKEND_URL=http://localhost:4000
python seller.py

# Buyer Agent
cd buyer-agent
pip install -r requirements.txt
set AGENT_SECRET_KEY=your_key
set BACKEND_URL=http://localhost:4000
python agent.py
Environment Variables
Backend
| Variable | Description |
|----------|-------------|
| `ENCRYPTION_KEY` | 64-char hex key for AES-256-GCM |
| `SELLER_PUBLIC_KEY` | Stellar public key receiving payments |
| `SELLER_SECRET_KEY` | Stellar secret key for on-chain proof tx |
| `FACILITATOR_URL` | x402 facilitator endpoint |
Buyer Agent
| Variable | Description |
|----------|-------------|
| `AGENT_SECRET_KEY` | Stellar secret key for signing payments |
| `BACKEND_URL` | Backend URL |
| `GEMINI_API_KEY` | Optional — enables AI signal ranking |
What Is Working

Real Stellar testnet XLM payments per acquisition
x402-inspired HTTP payment protocol on Stellar
AES-256-GCM payload encryption
SQLite persistence — signals survive server restarts
Live CoinGecko market data powering trading signals
Autonomous seller and buyer agents on Railway
Freighter browser wallet integration for humans
Signal expiry and single-use enforcement
Live activity feed with Stellar explorer links
MY SIGNALS tab with purchase history
Open external agent API with no auth required
Gemini AI decision engine for buyer agent signal ranking

Known Limitations

Payments use XLM not USDC. USDC trustline support planned for v2.
x402 implementation is inspired by the spec, not fully compliant. Full facilitator infrastructure planned for v2.
Seller agents post a mix of live CoinGecko data and curated demo signals.
CoinGecko free tier has rate limits — seller agent handles this gracefully with fallback.

Hackathon Notes
Built for Stellar Hacks: Agents on DoraHacks. Demonstrates autonomous agent-to-agent and human-to-agent commerce on Stellar where:

Agents autonomously discover, evaluate with Gemini AI, pay for, and act on intelligence signals
Every acquisition is verified on the Stellar blockchain
The API is open — any agent with a Stellar wallet can participate
Humans can purchase via Freighter browser wallet
Live market data from CoinGecko drives real signal generation
All transactions verifiable on Stellar testnet explorer

GitHub
https://github.com/Techkeyy/thekeeper

