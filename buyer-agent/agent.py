import asyncio
import os
import httpx
from dotenv import load_dotenv

load_dotenv()

BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:4000")
MCP_URL = os.getenv("MCP_URL", "http://localhost:4001")
TARGET_TAGS = [t.strip() for t in os.getenv("TARGET_TAGS", "trading_signal,logistics_alert,intelligence,weather_alert,research,sports_intel").split(",") if t.strip()]
SCAN_INTERVAL = int(os.getenv("SCAN_INTERVAL", "15"))
MIN_SECONDS_REMAINING = int(os.getenv("MIN_SECONDS_REMAINING", "10"))
MAX_PRICE_USDC = float(os.getenv("MAX_PRICE_USDC", "0.25"))


def print_banner():
    print("╔══════════════════════════════════════════╗")
    print("║     THEKEEPER — BUYER AGENT              ║")
    print("║     Autonomous Signal Acquisition        ║")
    print("║     Powered by KeeperHub MCP + x402      ║")
    print("╚══════════════════════════════════════════╝")
    print()
    print(f"[AGENT] Backend: {BACKEND_URL}")
    print(f"[AGENT] MCP server: {MCP_URL}")
    print(f"[AGENT] Scanning for: {', '.join(TARGET_TAGS)}")
    print(f"[AGENT] Max price: {MAX_PRICE_USDC} USDC")
    print(f"[AGENT] Scan interval: {SCAN_INTERVAL}s")
    print()


async def call_mcp_tool(client: httpx.AsyncClient, tool_name: str, arguments: dict) -> dict:
    response = await client.post(
        f"{MCP_URL}/tools/call",
        json={"name": tool_name, "arguments": arguments},
        timeout=15
    )
    response.raise_for_status()
    result = response.json()
    if result.get("isError"):
        raise Exception(result["content"][0]["text"])
    import json
    return json.loads(result["content"][0]["text"])


async def discover_signals(client: httpx.AsyncClient) -> list:
    try:
        result = await call_mcp_tool(client, "discover_signals", {})
        return result.get("signals", [])
    except Exception as exc:
        print(f"[AGENT] MCP discover failed: {exc}")
        return []


async def acquire_signal(client: httpx.AsyncClient, signal_id: str) -> dict | None:
    try:
        result = await call_mcp_tool(client, "acquire_signal", {"signal_id": signal_id})
        return result
    except Exception as exc:
        print(f"[AGENT] MCP acquire failed: {exc}")
        return None


def filter_viable(signals: list, acquired_ids: set) -> list:
    viable = []
    for s in signals:
        if not s.get("id"):
            continue
        if s.get("id") in acquired_ids:
            continue
        if s.get("tag") not in TARGET_TAGS:
            continue
        if int(s.get("secondsRemaining", 0)) < MIN_SECONDS_REMAINING:
            continue
        if float(s.get("price", "999")) > MAX_PRICE_USDC:
            continue
        if s.get("used"):
            continue
        viable.append(s)
    severity_order = {"CRITICAL": 0, "HIGH": 1, "MEDIUM": 2, "LOW": 3}
    viable.sort(key=lambda x: severity_order.get(x.get("severity", "LOW"), 3))
    return viable


async def run_agent() -> None:
    print_banner()
    acquired_ids: set = set()
    total_acquired = 0

    try:
        async with httpx.AsyncClient() as client:
            while True:
                print(f"[AGENT] Scanning via MCP...")
                signals = await discover_signals(client)
                viable = filter_viable(signals, acquired_ids)

                if not viable:
                    print(f"[AGENT] No viable signals. Scanning again in {SCAN_INTERVAL}s...")
                    await asyncio.sleep(SCAN_INTERVAL)
                    continue

                target = viable[0]
                signal_id = target.get("id", "")
                short_id = signal_id[:8]
                tag = target.get("tag", "unknown")
                severity = target.get("severity", "unknown")
                price = target.get("price", "0.00")
                seconds_remaining = int(target.get("secondsRemaining", 0))

                print(f"[AGENT] Signal detected via MCP")
                print(f"  ID       : {short_id}")
                print(f"  TAG      : {tag}")
                print(f"  SEVERITY : {severity}")
                print(f"  PRICE    : {price} USDC")
                print(f"  TTL LEFT : {seconds_remaining}s")

                result = await acquire_signal(client, signal_id)

                if result and result.get("status") == "payment_required":
                    challenge = result.get("challenge", {})
                    print(f"[AGENT] Payment required: {price} USDC on Base Sepolia")
                    print(f"  Treasury : {challenge.get('treasuryWallet', 'unknown')[:16]}...")
                    print(f"  Network  : {challenge.get('network', 'base')}")
                    print(f"  x402     : Send {price} USDC then retry with X-PAYMENT header")
                    print(f"[AGENT] KeeperHub agentic wallet: run 'npx @keeperhub/wallet skill install' to enable auto-payment")
                    acquired_ids.add(signal_id)

                elif result and result.get("status") == "acquired":
                    payload = result.get("payload", {})
                    acquired_ids.add(signal_id)
                    total_acquired += 1
                    print(f"[AGENT] Signal acquired")
                    print(f"  PAYLOAD  : {payload.get('payload', '')[:120]}...")
                    print()

                else:
                    print(f"[AGENT] Acquisition failed or signal gone. Moving on.")

                await asyncio.sleep(SCAN_INTERVAL)
    finally:
        print(f"[AGENT] Shutting down. Total acquired: {total_acquired}")


if __name__ == "__main__":
    try:
        asyncio.run(run_agent())
    except KeyboardInterrupt:
        pass
