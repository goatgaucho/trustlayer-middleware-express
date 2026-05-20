/**
 * x402 + TrustLayer composition.
 *
 * Order matters: trustGate runs first to reject low-reputation callers
 * BEFORE the x402 facilitator round-trip. This saves both compute and
 * the facilitator gas-equivalent on traffic you wouldn't want anyway.
 *
 * Run after installing peers:
 *   npm install express x402-express
 *   node examples/with-x402.js
 */

const express = require('express');
const trustGate = require('../src/index.js');
// const { paymentMiddleware } = require('x402-express'); // pseudo — replace with your version

const app = express();

const PAY_TO = '0xYourReceivingWallet';
const FACILITATOR = 'https://facilitator.coinbase.com'; // example

// The paywall is stubbed here so the file is self-contained.
function paymentMiddleware() {
  return (req, res, next) => {
    if (!req.headers['x-payment']) {
      return res.status(402).json({ pay_to: PAY_TO, amount: '0.001 USDC' });
    }
    next();
  };
}

app.use(
  '/paid',
  trustGate({
    chain: 'base',
    minScore: 64,
    // Sybil-flagged or low-score callers get blocked here — never reach paywall.
  }),
  paymentMiddleware(),
  (req, res) => {
    res.json({
      ok: true,
      caller: req.trustlayer,
      message: 'Passed trust check AND paid. Here is your data.',
    });
  }
);

app.listen(3000, () => console.log('x402 + trust-gate example on :3000'));
