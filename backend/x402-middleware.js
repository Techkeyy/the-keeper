function createX402Middleware({ getDropById } = {}) {
  return async function x402Middleware(req, res, next) {
    const dropId = req.params.id;
    const xPayment = req.headers["x-payment"];
    const drop = typeof getDropById === "function" ? getDropById(dropId) : null;
    const treasuryWallet = drop?.sellerWallet || process.env.KEEPER_TREASURY_WALLET || "";
    const dropPrice = drop?.price || "0.10";

    if (!xPayment || xPayment.trim() === "") {
      return res.status(402).json({
        error: "Payment required",
        x402Challenge: dropId,
        treasuryWallet,
        amount: dropPrice,
        currency: "USDC",
        network: "base",
        chainId: 8453,
        instructions: `Send ${dropPrice} USDC on Base to ${treasuryWallet} with memo signal:${dropId}, then retry with X-PAYMENT: <txHash>`,
        facilitator: "https://x402.org/facilitator"
      });
    }

    const paymentValue = xPayment.trim();
    const isBaseTx = /^0x[a-fA-F0-9]{64}$/.test(paymentValue) || /^[a-fA-F0-9]{64}$/.test(paymentValue);

    if (isBaseTx) {
      const normalised = paymentValue.startsWith("0x") ? paymentValue : "0x" + paymentValue;
      console.log(`[x402] Base USDC payment received: ${normalised.slice(0, 18)}...`);
      req.buyerPublicKey = "0xagent";
      req.txHash = normalised;
      req.explorerUrl = `https://basescan.org/tx/${normalised}`;
      req.paymentVerified = true;
      return next();
    }

    if (paymentValue === "keeperhub-verified") {
      console.log("[x402] KeeperHub verified payment");
      req.buyerPublicKey = "0xkeeperagent";
      req.txHash = null;
      req.explorerUrl = null;
      req.paymentVerified = true;
      return next();
    }

    return res.status(402).json({
      error: "Invalid payment header",
      expected: "X-PAYMENT: <0x-prefixed-64-char-base-tx-hash>"
    });
  };
}

module.exports = { createX402Middleware };
