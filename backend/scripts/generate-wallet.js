const { Keypair } = require('@stellar/stellar-sdk');

const keypair = Keypair.random();
console.log('=== NEW STELLAR TESTNET WALLET ===');
console.log('Public Key :', keypair.publicKey());
console.log('Secret Key :', keypair.secret());
console.log('');
console.log('Fund this wallet at: https://friendbot.stellar.org?addr=' + keypair.publicKey());
console.log('View on explorer: https://stellar.expert/explorer/testnet/account/' + keypair.publicKey());
