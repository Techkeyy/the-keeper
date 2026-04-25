# REDEPLOYED: 2026-04-08 - Updated signals with real teasers and correct severity
import asyncio
import os
from typing import Any

import httpx
from dotenv import load_dotenv
from stellar_sdk import Keypair, Server

from signals import SIGNALS

load_dotenv()

SELLER_AGENT_SECRET = os.getenv("SELLER_AGENT_SECRET_KEY", "")
SELLER_AGENT_PUBLIC = os.getenv("SELLER_AGENT_PUBLIC_KEY", "")

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


def get_seller_wallet() -> str:
    """Get seller agent's own Stellar wallet."""
    if SELLER_AGENT_SECRET:
        try:
            keypair = Keypair.from_secret(SELLER_AGENT_SECRET)
            return keypair.public_key
        except Exception:
            pass

    if SELLER_AGENT_PUBLIC:
        return SELLER_AGENT_PUBLIC

    return SELLER_WALLET


async def check_earnings(public_key: str) -> float:
    """Check how much XLM the seller agent has earned."""
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"https://horizon-testnet.stellar.org/accounts/{public_key}",
                timeout=10,
            )
            if response.status_code == 200:
                data = response.json()
                for balance in data.get("balances", []):
                    if balance.get("asset_type") == "native":
                        return float(balance.get("balance", 0))
    except Exception:
        pass
    return 0.0


def print_banner() -> None:
    print("╔══════════════════════════════════════╗")
    print("║     TheKeeper — SELLER AGENT      ║")
    print("║     Autonomous Signal Publisher      ║")
    print("╚══════════════════════════════════════╝")
    print()
    print("[SELLER] Starting autonomous signal publisher...")
    print(f"[SELLER] Backend: {BACKEND_URL}")
    print(f"[SELLER] Post interval: {POST_INTERVAL}s | Default TTL: {DEFAULT_TTL}s")
    seller_wallet = get_seller_wallet()
    print(f"[SELLER] Wallet: {seller_wallet[:8]}...")
    print(f"[SELLER] Signals sold go directly to this wallet")
    print(f"[SELLER] Track earnings: https://stellar.expert/explorer/testnet/account/{seller_wallet}")
    print()


def build_drop_payload(signal: dict[str, Any]) -> dict[str, Any]:
    return {
        "payload": signal["payload"],
        "teaser": signal.get("teaser", "Signal content encrypted. Purchase to reveal."),
        "severity": signal.get("severity", "MEDIUM"),
        "price": signal.get("price", DEFAULT_PRICE),
        "tag": signal["tag"],
        "ttl": signal.get("ttl", DEFAULT_TTL),
        "sellerWallet": get_seller_wallet(),
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

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            while True:
                signal = SIGNALS[index % len(SIGNALS)]

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

                        if posted_count % 5 == 0 and posted_count > 0:
                            wallet = get_seller_wallet()
                            if wallet and not wallet.startswith("GTEST"):
                                earnings = await check_earnings(wallet)
                                print(f"[SELLER] 💰 Earnings update: {earnings:.4f} XLM in wallet")
                                print(f"[SELLER] Explorer: https://stellar.expert/explorer/testnet/account/{wallet}")
                                print()
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
