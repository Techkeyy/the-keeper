import asyncio
import os
import httpx
from dotenv import load_dotenv
from signals import SIGNALS

load_dotenv()

BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:4000")
KEEPER_TREASURY_WALLET = os.getenv("KEEPER_TREASURY_WALLET", "")
POST_INTERVAL = int(os.getenv("POST_INTERVAL", "20"))
DEFAULT_TTL = int(os.getenv("DEFAULT_TTL", "300"))
DEFAULT_PRICE = os.getenv("DEFAULT_PRICE", "0.10")
KH_API_KEY = os.getenv("KH_API_KEY", "")


def print_banner():
    print("╔══════════════════════════════════════════╗")
    print("║     THEKEEPER — SELLER AGENT             ║")
    print("║     Autonomous Signal Publisher          ║")
    print("║     Powered by KeeperHub + Base USDC     ║")
    print("╚══════════════════════════════════════════╝")
    print()
    print(f"[SELLER] Backend: {BACKEND_URL}")
    print(f"[SELLER] Treasury wallet: {KEEPER_TREASURY_WALLET[:8]}..." if KEEPER_TREASURY_WALLET else "[SELLER] WARNING: No treasury wallet set")
    print(f"[SELLER] KeeperHub: {'connected' if KH_API_KEY else 'WARNING: No API key set'}")
    print(f"[SELLER] Post interval: {POST_INTERVAL}s | Default TTL: {DEFAULT_TTL}s")
    print()


async def get_active_signal_count(client: httpx.AsyncClient) -> int:
    try:
        response = await client.get(f"{BACKEND_URL}/drops", timeout=10)
        response.raise_for_status()
        drops = response.json()
        return len(drops) if isinstance(drops, list) else 0
    except Exception:
        return 0


async def fetch_coingecko_signals() -> list:
    try:
        url = (
            "https://api.coingecko.com/api/v3/simple/price"
            "?ids=bitcoin,ethereum,stellar"
            "&vs_currencies=usd"
            "&include_24hr_change=true"
        )
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(url)
            response.raise_for_status()
            data = response.json()

        coin_map = [
            ("bitcoin", "BTC", "Bitcoin"),
            ("ethereum", "ETH", "Ethereum"),
            ("stellar", "XLM", "Stellar"),
        ]
        signals = []

        for coin_key, coin_symbol, coin_name in coin_map:
            coin_data = data.get(coin_key, {})
            current_price = float(coin_data.get("usd", 0) or 0)
            change = float(coin_data.get("usd_24h_change", 0) or 0)
            abs_change = abs(change)
            if abs_change < 0.5:
                continue
            if abs_change > 5:
                severity = "CRITICAL"
                price = "0.25"
            elif abs_change >= 3:
                severity = "HIGH"
                price = "0.10"
            elif abs_change >= 1:
                severity = "MEDIUM"
                price = "0.05"
            else:
                severity = "LOW"
                price = "0.01"
            direction = "up" if change > 0 else "down"
            teaser = f"{coin_symbol} {direction} {abs_change:.1f}% in 24h - momentum detected."[:100]
            signals.append({
                "payload": (
                    f"SIGNAL: {coin_name} price movement\n"
                    f"EVENT: {coin_name} {direction} {abs_change:.1f}% in 24h\n"
                    f"INTEL: Current price ${current_price:,.2f} USD. 24h change: {change:+.2f}%.\n"
                    f"ACTION: Monitor {coin_name} for continuation.\n"
                    f"WINDOW: Next 2-4 hours\n"
                    f"CONFIDENCE: Real-time data | SOURCE: CoinGecko"
                ),
                "teaser": teaser,
                "tag": "trading_signal",
                "severity": severity,
                "price": price,
                "ttl": 1800,
            })

        return signals
    except Exception as exc:
        print(f"[SELLER] CoinGecko fetch failed: {exc}")
        return []


async def create_keeperhub_workflow(client: httpx.AsyncClient, drop_id: str, tag: str, severity: str, price: str, teaser: str) -> str | None:
    if not KH_API_KEY:
        return None
    try:
        headers = {
            "Authorization": f"Bearer {KH_API_KEY}",
            "Content-Type": "application/json"
        }
        name = f"signal:{drop_id}"
        description = f"TheKeeper signal — {tag} [{severity}] — {teaser[:60]}"
        create_res = await client.post(
            "https://app.keeperhub.com/api/workflows/create",
            json={"name": name, "description": description},
            headers=headers,
            timeout=15
        )
        if create_res.status_code != 201:
            print(f"  [KH] Workflow create failed: {create_res.status_code}")
            return None
        workflow_id = create_res.json().get("id")
        nodes = [
            {
                "id": "trigger-1",
                "type": "trigger",
                "data": {
                    "label": "Signal Request",
                    "type": "trigger",
                    "config": {"triggerType": "Webhook"},
                    "status": "idle"
                }
            },
            {
                "id": "action-1",
                "type": "action",
                "data": {
                    "label": "Deliver Signal",
                    "type": "action",
                    "config": {
                        "actionType": "web3/check-balance",
                        "network": "11155111",
                        "address": KEEPER_TREASURY_WALLET or "0x0000000000000000000000000000000000000000"
                    },
                    "status": "idle"
                }
            }
        ]
        edges = [{"id": "e1", "source": "trigger-1", "target": "action-1"}]
        await client.patch(
            f"https://app.keeperhub.com/api/workflows/{workflow_id}",
            json={"nodes": nodes, "edges": edges, "visibility": "private"},
            headers=headers,
            timeout=15
        )
        print(f"  [KH] Workflow created: {workflow_id[:16]}...")
        return workflow_id
    except Exception as exc:
        print(f"  [KH] Workflow error: {exc}")
        return None


def build_drop_payload(signal: dict) -> dict:
    return {
        "payload": signal["payload"],
        "price": signal.get("price", DEFAULT_PRICE),
        "tag": signal["tag"],
        "severity": signal.get("severity", "MEDIUM"),
        "ttl": signal.get("ttl", DEFAULT_TTL),
        "sellerWallet": KEEPER_TREASURY_WALLET,
        "teaser": signal.get("teaser", ""),
    }


async def post_signal(client: httpx.AsyncClient, signal: dict) -> dict | None:
    response = await client.post(f"{BACKEND_URL}/drop", json=build_drop_payload(signal), timeout=10)
    if response.status_code == 429:
        return {"status": 429}
    response.raise_for_status()
    return response.json()


async def run_seller() -> None:
    print_banner()
    posted_count = 0
    index = 0
    cap_paused = False
    live_signals = []

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            while True:
                if index % 3 == 0:
                    live_signals = await fetch_coingecko_signals()

                if live_signals:
                    signal = live_signals[index % len(live_signals)]
                    print("[SELLER] Using live CoinGecko signal")
                else:
                    signal = SIGNALS[index % len(SIGNALS)]
                    print("[SELLER] Using cached signal")

                active_count = await get_active_signal_count(client)
                if cap_paused and active_count < 10:
                    cap_paused = False
                    print(f"[SELLER] Resuming — active signals: {active_count}/10")
                if not cap_paused and active_count >= 15:
                    cap_paused = True
                if cap_paused:
                    print(f"[SELLER] Signal cap reached ({active_count}/15). Waiting...")
                    await asyncio.sleep(POST_INTERVAL)
                    continue

                try:
                    result = await post_signal(client, signal)
                    if result is not None and result.get("status") == 429:
                        print(f"[SELLER] Backend cap reached. Waiting {POST_INTERVAL}s...")
                        await asyncio.sleep(POST_INTERVAL)
                        continue
                    if result is not None:
                        drop_id = result.get("id", "")
                        short_id = drop_id[:8]
                        print("[SELLER] Signal posted")
                        print(f"  ID       : {short_id}")
                        print(f"  TAG      : {signal['tag']}")
                        print(f"  SEVERITY : {signal.get('severity', 'MEDIUM')}")
                        print(f"  PRICE    : {signal.get('price', DEFAULT_PRICE)} USDC")
                        print(f"  TTL      : {signal.get('ttl', DEFAULT_TTL)}s")
                        print(f"  EXPIRES  : {result.get('expiresAt', 'unknown')}")
                        await create_keeperhub_workflow(
                            client, drop_id,
                            signal["tag"],
                            signal.get("severity", "MEDIUM"),
                            signal.get("price", DEFAULT_PRICE),
                            signal.get("teaser", "")
                        )
                        print()
                        posted_count += 1
                except Exception as exc:
                    print(f"[SELLER] Failed to post signal: {exc}")

                index += 1
                await asyncio.sleep(POST_INTERVAL)
    finally:
        print(f"[SELLER] Shutting down. Total signals posted: {posted_count}")


if __name__ == "__main__":
    try:
        asyncio.run(run_seller())
    except KeyboardInterrupt:
        pass
