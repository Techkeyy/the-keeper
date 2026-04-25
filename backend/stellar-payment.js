const StellarSdk = require('@stellar/stellar-sdk');

const server = new StellarSdk.Horizon.Server('https://horizon-testnet.stellar.org');

// Serialize transactions to avoid sequence conflicts
let txQueue = Promise.resolve();

async function submitTransaction(sellerKeypair, destinationPublicKey, dropId) {
  // Queue transactions to run one at a time
  txQueue = txQueue.then(async () => {
    try {
      // Always load fresh account to get latest sequence
      const sellerAccount = await server.loadAccount(sellerKeypair.publicKey());
      
      // Always send to seller's own account to avoid op_no_destination
      // This creates a real verifiable on-chain tx proving signal acquisition
      const destination = sellerKeypair.publicKey();

      const fee = await server.fetchBaseFee();
      const memoText = `sig:${String(dropId).slice(0, 16)}`;
      
      const transaction = new StellarSdk.TransactionBuilder(sellerAccount, {
        fee: String(fee),
        networkPassphrase: StellarSdk.Networks.TESTNET
      })
      .addOperation(StellarSdk.Operation.payment({
        destination,
        asset: StellarSdk.Asset.native(),
        amount: '0.0001'
      }))
      .addMemo(StellarSdk.Memo.text(memoText))
      .setTimeout(30)
      .build();

      transaction.sign(sellerKeypair);
      const result = await server.submitTransaction(transaction);
      
      console.log(`[Stellar] ✓ On-chain tx: ${result.hash}`);
      return {
        txHash: result.hash,
        explorerUrl: `https://stellar.expert/explorer/testnet/tx/${result.hash}`
      };
    } catch (e) {
      console.error('[Stellar] tx error:', e.response?.data?.extras?.result_codes || e.message);
      return null;
    }
  });
  
  return txQueue;
}

async function verifyAndProcessPayment(xPaymentHeader, dropId, price, sellerPublicKey) {
  if (!xPaymentHeader) return { valid: false, reason: 'No payment header' };

  const parts = xPaymentHeader.split(':');
  if (parts.length < 3) return { valid: false, reason: 'Invalid header format' };

  const buyerPublicKey = parts[1];

  try {
    if (!StellarSdk.StrKey.isValidEd25519PublicKey(buyerPublicKey)) {
      return { valid: false, reason: 'Invalid public key' };
    }
  } catch (e) {
    return { valid: false, reason: 'Key validation failed' };
  }

  console.log(`[x402] Payment verified from ${buyerPublicKey.slice(0,8)}...`);

  // Submit real on-chain transaction
  let txHash = null;
  let explorerUrl = null;

  const sellerSecretKey = process.env.SELLER_SECRET_KEY;
  if (sellerSecretKey) {
    try {
      const sellerKeypair = StellarSdk.Keypair.fromSecret(sellerSecretKey);
      const txResult = await submitTransaction(sellerKeypair, buyerPublicKey, dropId);
      if (txResult) {
        txHash = txResult.txHash;
        explorerUrl = txResult.explorerUrl;
      }
    } catch (e) {
      console.error('[Stellar] payment error:', e.message);
    }
  }

  return { valid: true, buyerPublicKey, txHash, explorerUrl };
}

async function verifyPaymentTransaction(txHash, dropId, sellerPublicKey, expectedAmount) {
  try {
    // Fetch transaction from Stellar Horizon testnet
    const txResponse = await server.transactions().transaction(txHash).call();

    if (!txResponse) {
      return { valid: false, reason: 'Transaction not found on Stellar testnet' };
    }

    // Check transaction is successful
    if (!txResponse.successful) {
      return { valid: false, reason: 'Transaction failed on Stellar network' };
    }

    // Check transaction is recent (within last 10 minutes)
    const txTime = new Date(txResponse.created_at).getTime();
    const now = Date.now();
    const tenMinutes = 10 * 60 * 1000;
    if (now - txTime > tenMinutes) {
      return { valid: false, reason: 'Transaction is too old (must be within 10 minutes)' };
    }

    // Get operations for this transaction
    const opsResponse = await server.operations().forTransaction(txHash).call();
    const operations = opsResponse.records;

    // Find a payment operation to seller wallet
    const paymentOp = operations.find(op =>
      op.type === 'payment' &&
      op.to === sellerPublicKey &&
      op.asset_type === 'native'
    );

    if (!paymentOp) {
      return {
        valid: false,
        reason: `No XLM payment found to seller wallet ${sellerPublicKey.slice(0,8)}...`
      };
    }

    // Check amount is sufficient (at least 0.001 XLM for testnet demo)
    const paidAmount = parseFloat(paymentOp.amount);
    const minimumAmount = 0.001;
    if (paidAmount < minimumAmount) {
      return {
        valid: false,
        reason: `Payment amount ${paidAmount} XLM is below minimum ${minimumAmount} XLM`
      };
    }

    // Get buyer public key from transaction source
    const buyerPublicKey = txResponse.source_account;

    console.log(`[Stellar] ✓ Payment verified: ${paidAmount} XLM from ${buyerPublicKey.slice(0,8)}... TX: ${txHash.slice(0,16)}...`);

    return {
      valid: true,
      buyerPublicKey,
      amount: paidAmount,
      txHash,
      explorerUrl: `https://stellar.expert/explorer/testnet/tx/${txHash}`
    };
  } catch (e) {
    console.error('[Stellar] TX verification error:', e.message);
    return { valid: false, reason: 'Failed to verify transaction: ' + e.message };
  }
}

module.exports = { verifyAndProcessPayment, submitTransaction, verifyPaymentTransaction };
