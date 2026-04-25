# REDEPLOYED: 2026-04-09 - Added CoinGecko live signal feed
import asyncio
import os
from typing import Any

import httpx
from dotenv import load_dotenv

from signals import SIGNALS

load_dotenv()

BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:4000")
SELLER_WALLET = os.getenv("SELLER_WALLET", "GTESTSELLERWALLET123")
POST_INTERVAL = int(os.getenv("POST_INTERVAL", "15"))
DEFAULT_TTL = int(os.getenv("DEFAULT_TTL", "120"))
DEFAULT_PRICE = os.getenv("DEFAULT_PRICE", "0.10")


async def get_active_signal_count(client: httpx.AsyncClient) -> int:
    try:
        response = await client.get(f"{BACKEND_URL}/drops", timeout=10)
        response.raise_for_status()
        drops = response.json()
        return len(drops) if isinstance(drops, list) else 0
    except Exception:
        return 0


async def fetch_coingecko_signals() -> list[dict[str, Any]]:
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
            coin_data = data.get(coin_key, {}) if isinstance(data, dict) else {}
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
            teaser = f"{coin_symbol} {direction} {abs_change:.1f}% in 24h - momentum detected."
            teaser = teaser[:100]

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


def print_banner() -> None:
    print("╔══════════════════════════════════════╗")
    print("║     TheKeeper — SELLER AGENT      ║")
    print("║     Autonomous Signal Publisher      ║")
    print("╚══════════════════════════════════════╝")
    print()
    print("[SELLER] Starting autonomous signal publisher...")
    print(f"[SELLER] Backend: {BACKEND_URL}")
    print(f"[SELLER] Post interval: {POST_INTERVAL}s | Default TTL: {DEFAULT_TTL}s")
    print()


def build_drop_payload(signal: dict[str, Any]) -> dict[str, Any]:
    return {
        "payload": signal["payload"],
        "price": signal.get("price", DEFAULT_PRICE),
        "tag": signal["tag"],
        "severity": signal.get("severity", "MEDIUM"),
        "ttl": signal.get("ttl", DEFAULT_TTL),
        "sellerWallet": SELLER_WALLET,
        "teaser": signal.get("teaser", ""),
    }


async def post_signal(client: httpx.AsyncClient, signal: dict[str, Any]) -> dict[str, Any] | None:
    response = await client.post(f"{BACKEND_URL}/drop", json=build_drop_payload(signal))
    if response.status_code == 429:
        return {"status": 429}
    response.raise_for_status()
    return response.json()


async def run_seller() -> None:
    print_banner()

    posted_count = 0
    index = 0
    cap_paused = False
    live_signals: list[dict[str, Any]] = []

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            while True:
                # Refresh live signals from CoinGecko every 3rd iteration
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
                    print(f"[SELLER] Active signals below resume threshold ({active_count}/10). Resuming posts.")

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
                        created = result
                        signal_id = created.get("id", "")
                        short_id = signal_id[:8] if signal_id else "unknown"

                        print("[SELLER] ✓ Signal posted")
                        print(f"  ID      : {short_id}")
                        print(f"  TAG     : {signal['tag']}")
                        print(f"  PRICE   : {signal.get('price', DEFAULT_PRICE)} XLM")
                        print(f"  TTL     : {signal.get('ttl', DEFAULT_TTL)}s")
                        print(f"  EXPIRES : {created.get('expiresAt', 'unknown')}")
                        print()

                        posted_count += 1
                except Exception as exc:
                    print(f"[SELLER] ✗ Failed to post signal: {exc}")

                index += 1
                await asyncio.sleep(POST_INTERVAL)
    finally:
        print(f"[SELLER] Shutting down. Total signals posted: {posted_count}")


if __name__ == "__main__":
    try:
        asyncio.run(run_seller())
    except KeyboardInterrupt:
        pass

