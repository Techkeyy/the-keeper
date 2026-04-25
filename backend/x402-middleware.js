const { verifyPaymentTransaction, verifyAndProcessPayment } = require('./stellar-payment');
const StellarSdk = require('@stellar/stellar-sdk');

function createX402Middleware({ getDropById } = {}) {
  return async function x402Middleware(req, res, next) {
    const dropId = req.params.id;
    const xPayment = req.headers['x-payment'];
    const drop = typeof getDropById === 'function' ? getDropById(dropId) : null;
    const sellerPublicKey = drop?.sellerWallet || process.env.SELLER_PUBLIC_KEY || '';
    const dropPrice = drop?.price || '0.10';

    if (!xPayment || xPayment.trim() === '') {
      return res.status(402).json({
        error: 'Payment required',
        x402Challenge: dropId,
        sellerWallet: sellerPublicKey,
        amount: dropPrice,
        currency: 'XLM',
        network: 'stellar-testnet',
        instructions: `Send ${dropPrice} XLM to sellerWallet with drop ID as memo, then retry with X-PAYMENT: <txHash>`,
        facilitator: process.env.FACILITATOR_URL || 'https://x402.org/facilitator'
      });
    }

    const paymentValue = xPayment.trim();
    const isRealTx = /^[a-f0-9]{64}$/i.test(paymentValue);
    const isSignatureMode = paymentValue.startsWith('stellar:');

    if (isRealTx) {
      const verification = await verifyPaymentTransaction(
        paymentValue,
        dropId,
        sellerPublicKey,
        dropPrice
      );

      if (!verification.valid) {
        console.log('[x402] TX verification failed:', verification.reason);
        return res.status(402).json({
          error: 'Payment verification failed',
          reason: verification.reason,
          txHash: paymentValue
        });
      }

      console.log(`[x402] ✓ Real TX verified: ${paymentValue.slice(0,16)}... from ${verification.buyerPublicKey.slice(0,8)}...`);
      req.buyerPublicKey = verification.buyerPublicKey;
      req.txHash = paymentValue;
      req.explorerUrl = `https://stellar.expert/explorer/testnet/tx/${paymentValue}`;
      req.paymentVerified = true;
      return next();
    }

    if (isSignatureMode) {
      const parts = paymentValue.split(':');
      if (parts.length >= 3) {
        const pubKey = parts[1];
        try {
          if (StellarSdk.StrKey.isValidEd25519PublicKey(pubKey)) {
            console.log(`[x402] Signature mode from ${pubKey.slice(0,8)}...`);
            req.buyerPublicKey = pubKey;
            req.paymentVerified = true;
            const result = await verifyAndProcessPayment(paymentValue, dropId, dropPrice, sellerPublicKey);
            req.txHash = result.txHash;
            req.explorerUrl = result.explorerUrl;
            return next();
          }
        } catch(e) {
          console.log('[x402] Invalid public key:', e.message);
        }
      }
    }

    return res.status(402).json({
      error: 'Invalid payment header',
      expected: 'X-PAYMENT: <64-char-tx-hash> OR X-PAYMENT: stellar:<pubkey>:<signature>'
    });
  };
}

module.exports = { createX402Middleware };
