/**
 * Basic example — gate the /paid route behind a trust check.
 *
 * Run:
 *   npm install express
 *   node examples/basic.js
 *
 * Then:
 *   curl -H "X-Agent-Id: base:1378" http://localhost:3000/paid
 *   curl -H "X-Agent-Id: base:18998" http://localhost:3000/paid
 */

const express = require('express');
const trustGate = require('../src/index.js');

const app = express();

app.use(
  '/paid',
  trustGate({ chain: 'base', minScore: 64 }),
  (req, res) => {
    res.json({
      ok: true,
      message: 'You made it past the trust gate.',
      caller: req.trustlayer,
    });
  }
);

app.get('/', (req, res) => {
  res.send('OK. Try GET /paid with X-Agent-Id header.');
});

app.listen(3000, () => console.log('Listening on http://localhost:3000'));
