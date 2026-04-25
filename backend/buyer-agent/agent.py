import asyncio
import os

import httpx
from dotenv import load_dotenv

from utils import acquire_drop

# Optional AI module. If unavailable, the agent keeps legacy behavior.
try:
    from ai_decision import decide_which_drop
except Exception:
    decide_which_drop = None

load_dotenv()

BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:4000")
TARGET_TAGS = [tag.strip() for tag in os.getenv("TARGET_TAGS", "trading_signal,logistics_alert").split(",") if tag.strip()]
SCAN_INTERVAL = int(os.getenv("SCAN_INTERVAL", "8"))
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
    return viable


def build_acquired_history(acquired_ids: set[str], acquired_meta: dict[str, dict]) -> list[dict]:
    # Build minimal session memory for AI ranking without changing payment flow state.
    history: list[dict] = []
    for drop_id in acquired_ids:
        meta = acquired_meta.get(drop_id, {})
        history.append(
            {
                "tag": meta.get("tag", "unknown"),
                "severity": meta.get("severity", "unknown"),
                "price": str(meta.get("price", "0.00")),
            }
        )
    return history


def build_ai_drop_view(viable_drops: list[dict]) -> list[dict]:
    # Send Gemini only ranking-relevant fields to keep prompts small and deterministic.
    return [
        {
            "id": drop.get("id"),
            "tag": drop.get("tag"),
            "severity": drop.get("severity", "MEDIUM"),
            "price": str(drop.get("price", "0.00")),
            "secondsRemaining": int(drop.get("secondsRemaining", 0)),
            "expiresAt": drop.get("expiresAt"),
            "teaser": drop.get("teaser", ""),
        }
        for drop in viable_drops
        if drop.get("id")
    ]


async def run_agent() -> None:
    print_banner()

    acquired_ids: set[str] = set()
    acquired_meta: dict[str, dict] = {}
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

                selected_drop = viable_drops[0]
                if decide_which_drop is not None:
                    try:
                        # AI picks one target drop or skips; legacy fallback remains first viable drop.
                        ai_available_drops = build_ai_drop_view(viable_drops)
                        acquired_history = build_acquired_history(acquired_ids, acquired_meta)
                        ai_decision = await decide_which_drop(ai_available_drops, acquired_history)

                        reasoning = str(ai_decision.get("reasoning", "No reasoning provided."))
                        confidence = ai_decision.get("confidence", 0.0)
                        decision = str(ai_decision.get("decision", "buy")).lower()
                        target_id = ai_decision.get("target_id")

                        print(f"[AI] Reasoning: {reasoning}")
                        print(f"[AI] Confidence: {confidence}")

                        drop_map = {drop.get("id"): drop for drop in viable_drops if drop.get("id")}

                        if decision == "skip":
                            print("[AI] Decision: SKIP")
                            print(f"[AGENT] AI skipped this cycle. Scanning again in {SCAN_INTERVAL}s...")
                            await asyncio.sleep(SCAN_INTERVAL)
                            continue

                        if decision == "buy" and target_id in drop_map:
                            selected_drop = drop_map[target_id]
                            print(f"[AI] Decision: BUY {str(target_id)[:8]}")
                        else:
                            print(f"[AI] Decision: BUY {str(selected_drop.get('id', ''))[:8]}")
                    except Exception as exc:
                        print(f"[AI] Decision helper error: {exc}")
                        print("[AI] Decision: BUY (fallback to first viable drop)")

                drop_id = selected_drop.get("id", "")
                short_id = drop_id[:8]
                tag = selected_drop.get("tag", "unknown")
                severity = selected_drop.get("severity", "unknown")
                price = selected_drop.get("price", "0.00")
                expires_at = selected_drop.get("expiresAt", "unknown")
                seconds_remaining = int(selected_drop.get("secondsRemaining", 0))

                print("[AGENT] → Signal detected")
                print(f"  ID      : {short_id}")
                print(f"  TAG     : {tag}")
                print(f"  SEVERITY: {severity}")
                print(f"  PRICE   : {price} USDC")
                print(f"  EXPIRES : {expires_at}")
                print(f"  TTL LEFT: {seconds_remaining}s")

                result = await acquire_drop(drop_id, price)
                if result:
                    payload = result.get("payload", "")
                    acquired_ids.add(drop_id)
                    # Store session metadata so future AI calls can avoid duplicate tag patterns.
                    acquired_meta[drop_id] = {
                        "tag": tag,
                        "severity": severity,
                        "price": price,
                    }
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

