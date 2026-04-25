const https = require('https');

async function fundTestnetWallet(publicKey) {
  return new Promise((resolve, reject) => {
    const url = `https://friendbot.stellar.org?addr=${publicKey}`;
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const result = JSON.parse(data);
        if (result.hash) {
          console.log('✓ Funded wallet:', publicKey);
          console.log('  Transaction:', result.hash);
          console.log('  View on explorer: https://stellar.expert/explorer/testnet/tx/' + result.hash);
          resolve(result);
        } else {
          console.error('✗ Failed to fund:', result);
          reject(result);
        }
      });
    }).on('error', reject);
  });
}

// Usage: node fund-testnet.js GPUBKEY...
const pubKey = process.argv[2];
if (!pubKey) {
  console.log('Usage: node fund-testnet.js YOUR_PUBLIC_KEY');
  console.log('Get your public key from Freighter wallet');
  process.exit(1);
}

fundTestnetWallet(pubKey).catch(console.error);
