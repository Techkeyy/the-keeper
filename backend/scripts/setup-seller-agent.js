#!/usr/bin/env node
const { Keypair } = require('@stellar/stellar-sdk');

async function main() {
  const args = new Set(process.argv.slice(2));
  const shouldFund = args.has('--fund') || process.env.FUND_SELLER_AGENT === 'true';
  const secret = process.env.SELLER_AGENT_SECRET_KEY || Keypair.random().secret();
  const keypair = Keypair.fromSecret(secret);
  const publicKey = keypair.publicKey();

  console.log('Seller agent wallet setup');
  console.log('--------------------------');
  console.log(`SELLER_AGENT_SECRET_KEY=${secret}`);
  console.log(`SELLER_AGENT_PUBLIC_KEY=${publicKey}`);
  console.log('');
  console.log('Railway backend env vars:');
  console.log(`SELLER_AGENT_SECRET_KEY=${secret}`);
  console.log(`SELLER_AGENT_PUBLIC_KEY=${publicKey}`);
  console.log(`SELLER_PUBLIC_KEY=${publicKey}`);
  console.log('');
  console.log('Buyer env vars:');
  console.log(`SELLER_PUBLIC_KEY=${publicKey}`);
  console.log('');
  console.log('Buyer agents should send XLM directly to the seller agent wallet above.');
  console.log('Do not reuse this secret in any other wallet or environment.');

  if (!shouldFund) {
    console.log('');
    console.log('Funding skipped. Re-run with --fund to request Friendbot on Stellar testnet.');
    return;
  }

  const friendbotUrl = `https://friendbot.stellar.org?addr=${encodeURIComponent(publicKey)}`;
  console.log('');
  console.log(`Requesting Friendbot funding: ${friendbotUrl}`);

  const response = await fetch(friendbotUrl);
  if (!response.ok) {
    throw new Error(`Friendbot funding failed with HTTP ${response.status}`);
  }

  const body = await response.json();
  console.log('Friendbot response:');
  console.log(JSON.stringify(body, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
