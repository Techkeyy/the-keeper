import asyncio
import os

import httpx
from dotenv import load_dotenv

from utils import acquire_drop

load_dotenv()

BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:4000")
TARGET_TAGS = [tag.strip() for tag in os.getenv("TARGET_TAGS", "trading_signal,logistics_alert,intelligence,weather_alert,research,sports_intel").split(",") if tag.strip()]
SCAN_INTERVAL = int(os.getenv("SCAN_INTERVAL", "45"))
MIN_SECONDS_REMAINING = int(os.getenv("MIN_SECONDS_REMAINING", "10"))


def print_banner() -> None:
    print("╔══════════════════════════════════════╗")
    print("║     TheKeeper — BUYER AGENT       ║")
    print("║     Autonomous Signal Acquisition    ║")
    print("╚══════════════════════════════════════╝")
    print()
    print("[AGENT] Starting autonomous buyer agent...")
    print(f"[AGENT] Scanning for: {', '.join(TARGET_TAGS)}")
    print(
        f"[AGENT] Scan interval: {SCAN_INTERVAL}s | "
        f"Min expiry buffer: {MIN_SECONDS_REMAINING}s"
    )
    print()


async def fetch_drops(client: httpx.AsyncClient) -> list[dict]:
    try:
        response = await client.get(f"{BACKEND_URL}/drops", timeout=10)
        response.raise_for_status()
        data = response.json()
        return data if isinstance(data, list) else []
    except Exception as exc:
        print(f"[AGENT] Failed to fetch drops: {exc}")
        return []


def filter_viable_drops(drops: list[dict], acquired_ids: set[str]) -> list[dict]:
    viable = []
    for drop in drops:
        drop_id = drop.get("id")
        if not drop_id:
            continue
        if drop.get("used") is not False:
            continue
        if drop.get("tag") not in TARGET_TAGS:
            continue
        if int(drop.get("secondsRemaining", 0)) < MIN_SECONDS_REMAINING:
            continue
        if drop_id in acquired_ids:
            continue
        viable.append(drop)
    return viable[:1]


async def run_agent() -> None:
    print_banner()

    acquired_ids: set[str] = set()
    total_acquired = 0

    try:
        async with httpx.AsyncClient() as client:
            while True:
                drops = await fetch_drops(client)
                viable_drops = filter_viable_drops(drops, acquired_ids)

                if not viable_drops:
                    print(
                        f"[AGENT] No viable signals found. "
                        f"Scanning again in {SCAN_INTERVAL}s..."
                    )
                    await asyncio.sleep(SCAN_INTERVAL)
                    continue

                drop = viable_drops[0]
                drop_id = drop.get("id", "")
                short_id = drop_id[:8]
                tag = drop.get("tag", "unknown")
                price = drop.get("price", "0.00")
                expires_at = drop.get("expiresAt", "unknown")
                seconds_remaining = int(drop.get("secondsRemaining", 0))

                print("[AGENT] → Signal detected")
                print(f"  ID      : {short_id}")
                print(f"  TAG     : {tag}")
                print(f"  PRICE   : {price} USDC")
                print(f"  EXPIRES : {expires_at}")
                print(f"  TTL LEFT: {seconds_remaining}s")

                result = await acquire_drop(drop_id, price)
                if result:
                    payload = result.get("payload", "")
                    acquired_ids.add(drop_id)
                    total_acquired += 1
                    print("[AGENT] ✓ Signal acquired")
                    print(f"  DROP ID : {short_id}")
                    print(f"  PAYLOAD : {payload}")
                    print("  ACTION  : Executing signal...")
                    print()
                else:
                    print("[AGENT] ✗ Acquisition failed. Moving on.")

                await asyncio.sleep(SCAN_INTERVAL)
    finally:
        print(f"[AGENT] Shutting down. Total signals acquired: {total_acquired}")


if __name__ == "__main__":
    try:
        asyncio.run(run_agent())
    except KeyboardInterrupt:
        pass

