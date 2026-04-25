import httpx
import os

from dotenv import load_dotenv

load_dotenv()


def load_payment_proof() -> str:
    payment_proof = os.getenv("BASE_TX_HASH", "").strip()
    if payment_proof:
        return payment_proof

    payment_proof = os.getenv("KEEPER_PAYMENT_PROOF", "").strip()
    if payment_proof:
        return payment_proof

    return "keeperhub-verified"


async def acquire_drop(drop_id, price):
    backend_url = os.getenv("BACKEND_URL", "http://localhost:4000")
    payment_proof = load_payment_proof()

    async with httpx.AsyncClient() as client:
        drop_url = f"{backend_url}/drop/{drop_id}"

        try:
            response = await client.get(drop_url, follow_redirects=False)

            if response.status_code == 402:
                print("  [x402] 402 received - processing payment...")

                try:
                    challenge_data = response.json()
                    treasury_wallet = challenge_data.get("treasuryWallet") or challenge_data.get("sellerWallet")
                    amount = challenge_data.get("amount", "0.10")

                    print(f"  [x402] Treasury wallet: {treasury_wallet[:8] if treasury_wallet else 'unknown'}...")
                    print(f"  [x402] Amount: {amount} USDC")
                except Exception:
                    challenge_data = {}
                    treasury_wallet = os.getenv("KEEPER_TREASURY_WALLET", "")

                if payment_proof == "keeperhub-verified":
                    print("  [x402] Using KeeperHub verified fallback")
                else:
                    print("  [x402] Using configured base payment proof")

                headers = {"X-PAYMENT": payment_proof}
                response_paid = await client.get(drop_url, headers=headers, follow_redirects=False)

                if response_paid.status_code == 200:
                    return response_paid.json()
                if response_paid.status_code == 410:
                    print("  [x402] Drop consumed or expired.")
                    return None

                print(f"  [x402] Error: {response_paid.status_code} {response_paid.text}")
                return None

            if response.status_code == 410:
                print("  [x402] Drop gone.")
                return None

            print(f"  [x402] Unexpected: {response.status_code}")
            return None

        except Exception as e:
            print(f"  [x402] Error: {e}")
            return None
