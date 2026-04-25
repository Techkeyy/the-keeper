import httpx
import json
import os
from stellar_sdk import Keypair, Server, TransactionBuilder, Network, Asset
from dotenv import load_dotenv

load_dotenv()

HORIZON_TESTNET = "https://horizon-testnet.stellar.org"


def load_keypair():
    agent_secret_key = os.getenv("AGENT_SECRET_KEY", "")
    if not agent_secret_key:
        raise ValueError("AGENT_SECRET_KEY environment variable not set")
    try:
        return Keypair.from_secret(agent_secret_key)
    except Exception as e:
        raise ValueError(f"Invalid AGENT_SECRET_KEY: {e}")


async def submit_stellar_payment(keypair, seller_public_key, amount_xlm, memo_text):
    """Submit a real Stellar testnet payment and return tx hash."""
    import asyncio

    server = Server(HORIZON_TESTNET)

    try:
        # Load buyer account
        account = server.load_account(keypair.public_key)

        # Build transaction
        transaction = (
            TransactionBuilder(
                source_account=account,
                network_passphrase=Network.TESTNET_NETWORK_PASSPHRASE,
                base_fee=100
            )
            .append_payment_op(
                destination=seller_public_key,
                asset=Asset.native(),
                amount=str(amount_xlm)
            )
            .add_text_memo(memo_text[:28])
            .set_timeout(30)
            .build()
        )

        # Sign transaction
        transaction.sign(keypair)

        # Submit transaction
        response = server.submit_transaction(transaction)
        tx_hash = response['hash']

        print(f"  [Stellar] ✓ Payment submitted: {tx_hash[:16]}...")
        print(f"  [Stellar] Explorer: https://stellar.expert/explorer/testnet/tx/{tx_hash}")

        return tx_hash

    except Exception as e:
        print(f"  [Stellar] Payment failed: {e}")
        return None
    finally:
        try:
            server.close()
        except Exception:
            pass


async def acquire_drop(drop_id, price):
    keypair = load_keypair()
    backend_url = os.getenv("BACKEND_URL", "http://localhost:4000")

    async with httpx.AsyncClient() as client:
        drop_url = f"{backend_url}/drop/{drop_id}"

        try:
            # Step 1: Initial request - get 402 with payment instructions
            response = await client.get(drop_url, follow_redirects=False)

            if response.status_code == 402:
                print("  [x402] 402 received - processing payment...")

                try:
                    challenge_data = response.json()
                    seller_wallet = challenge_data.get("sellerWallet")
                    amount = challenge_data.get("amount", "0.10")

                    print(f"  [x402] Seller wallet: {seller_wallet[:8] if seller_wallet else 'unknown'}...")
                    print(f"  [x402] Amount: {amount} XLM")
                except Exception:
                    challenge_data = {}
                    seller_wallet = os.getenv("SELLER_PUBLIC_KEY", "")

                if not seller_wallet:
                    print("  [x402] No seller wallet in response, using fallback signature mode")
                    challenge_str = challenge_data.get("x402Challenge", drop_id)
                    signature_bytes = keypair.sign(challenge_str.encode())
                    signature_hex = signature_bytes.hex()
                    payment_header = f"stellar:{keypair.public_key}:{signature_hex}"
                    headers = {"X-PAYMENT": payment_header}
                else:
                    # Submit real Stellar payment
                    tx_hash = await submit_stellar_payment(
                        keypair=keypair,
                        seller_public_key=seller_wallet,
                        amount_xlm=float(price) if price else 0.10,
                        memo_text=f"signal:{drop_id[:18]}"
                    )

                    if not tx_hash:
                        print("  [x402] Payment failed, trying signature fallback...")
                        challenge_str = challenge_data.get("x402Challenge", drop_id)
                        signature_bytes = keypair.sign(challenge_str.encode())
                        signature_hex = signature_bytes.hex()
                        payment_header = f"stellar:{keypair.public_key}:{signature_hex}"
                        headers = {"X-PAYMENT": payment_header}
                    else:
                        headers = {"X-PAYMENT": tx_hash}

                # Step 2: Retry with payment proof
                response_paid = await client.get(drop_url, headers=headers, follow_redirects=False)

                if response_paid.status_code == 200:
                    return response_paid.json()
                elif response_paid.status_code == 410:
                    print("  [x402] Drop consumed or expired.")
                    return None
                else:
                    print(f"  [x402] Error: {response_paid.status_code} {response_paid.text}")
                    return None

            elif response.status_code == 410:
                print("  [x402] Drop gone.")
                return None
            else:
                print(f"  [x402] Unexpected: {response.status_code}")
                return None

        except Exception as e:
            print(f"  [x402] Error: {e}")
            return None
