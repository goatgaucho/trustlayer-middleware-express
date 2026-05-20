# @trustlayer/middleware-express

Drop-in Express middleware that runs every caller through the [TrustLayer](https://thetrustlayer.xyz) `/gate` before your paywall or business logic fires. Pass-through if the caller's trust score meets your threshold, `403` with structured detail if it doesn't.

Built for x402 servers, A2A endpoints, and any agent-facing API that wants to filter out Sybil-flagged or low-reputation traffic before it costs you compute.

## Install

```bash
npm install @trustlayer/middleware-express
```

## Quickstart

```js
const express = require('express');
const trustGate = require('@trustlayer/middleware-express');

const app = express();

// Gate any agent hitting /paid through the TrustLayer /gate check.
// Default threshold is 64 (medium-tier or higher).
app.use('/paid', trustGate({ chain: 'base' }), paidHandler);
```

The middleware resolves the caller's agent id from (in order):

1. Your `resolveAgentId(req)` callback (if set)
2. `X-Agent-Id` request header
3. `?agent=` query string

If no agent id resolves, the request passes through by default. Set `onUnknown: 'block'` to refuse anonymous callers.

## What the response looks like when blocked

```json
{
  "error": "trustlayer_trust_check_failed",
  "agent_id": "base:1378",
  "score": 38,
  "threshold": 64,
  "sybil_flags": ["review_bombing:high", "duplicate_feedback_content:high"],
  "reason": "below_threshold_and_sybil",
  "recommendation": "High Sybil risk detected. Block payment routing.",
  "learn_more": "https://api.thetrustlayer.xyz/trust/base%3A1378"
}
```

The full /gate result is also attached to `req.trustlayer` for downstream handlers that pass through.

## Options

| Option | Default | What it does |
|---|---|---|
| `minScore` | `64` | Trust score threshold (0–100). Caller passes if score ≥ this. Defer to the server's `pass` field if not set. |
| `chain` | — | Default chain (e.g. `"base"`, `"ethereum"`). |
| `gateUrl` | `https://api.thetrustlayer.xyz/gate` | Override the gate endpoint. |
| `apiKey` | — | API key sent as `Authorization: Bearer …`. Lifts the 100/hr/IP free-tier limit. |
| `timeoutMs` | `1500` | Per-call timeout. |
| `cacheTtlMs` | `60000` | In-memory cache TTL for repeat queries. Set `0` to disable. |
| `failOpen` | `true` | If the /gate is unreachable, pass through. Set `false` to return 503 instead. |
| `resolveAgentId` | — | `(req) => string \| null`. Custom resolver. |
| `onUnknown` | `"pass"` | `"pass"` or `"block"`. What to do when no agent id is resolved. |
| `onBlock` | — | `(req, res, gateResult) => void`. Override the default 403 response. |

## Examples

### Block low-reputation callers entirely

```js
app.use('/api', trustGate({
  minScore: 80,
  chain: 'base',
  onUnknown: 'block',
}));
```

### Pair with x402 — filter before the paywall fires

```js
const { paymentMiddleware } = require('x402-express');

app.use(
  '/paid',
  trustGate({ chain: 'base', minScore: 64 }),  // filter Sybil/low-score
  paymentMiddleware(payTo, routes, facilitator), // then run the paywall
  paidHandler
);
```

This pattern saves you the compute and the facilitator round-trip on traffic you wouldn't want anyway.

### Custom resolver for a private agent id schema

```js
app.use('/orchestrator', trustGate({
  chain: 'base',
  resolveAgentId: (req) => req.body?.delegatedAgent,
}));
```

### Custom block response

```js
app.use('/api', trustGate({
  chain: 'base',
  onBlock: (req, res, gate) => res.status(402).json({
    error: 'insufficient_reputation',
    pay_to_unblock: `https://thetrustlayer.xyz/dispute/${gate.agent}`,
  }),
}));
```

## How scoring works

Trust scores are 0–100, derived from three components — profile completeness, feedback volume weighted by reviewer quality, and feedback legitimacy (Sybil detection, spam patterns, temporal anomalies).

Current TrustLayer thresholds:

- **High risk**: score < 64
- **Medium**: 64–79
- **Low risk**: ≥ 80

These are the same thresholds applied across our 19-chain coverage (BSC, Ethereum, Base, Monad, Solana, Polygon, Celo, Gnosis, Optimism, Arbitrum, Avalanche, Linea, Mantle, Metis, Scroll, Taiko, xLayer, GOAT, Soneium).

## Free tier vs paid

- **Free tier**: 100 requests/hour/IP at `/gate`. Anonymous, no setup.
- **Paid plans**: `$49/mo` (50K calls), `$99/mo` (100K), `$199/mo` (1M). Subscribe at <https://api.thetrustlayer.xyz/pricing>. Pass the issued API key via the `apiKey` option.

## Bonus: multi-attestation envelope verifier

This repo also ships [`verify-attestation.js`](./verify-attestation.js) — a standalone CLI verifier for the [InsumerAPI multi-attestation envelope](https://github.com/douglasborthwick-crypto/insumer-examples/issues/1) returned by `GET /attest/wallet/:address`. Fetches the envelope, fetches JWKS, re-canonicalizes the signed block, verifies the P1363 ES256 sig.

```bash
node verify-attestation.js 0xda977767452c5dd021624511f14df67b6c9c2c1b
# → ✅ PASS — signature verified.
```

No npm deps — uses Node's built-in `crypto` and `fetch`. Works against any issuer that follows the envelope shape: just override `TRUSTLAYER_API` env var (script naming is a holdover; the verification logic is issuer-agnostic).

## Related

- TrustLayer API: <https://api.thetrustlayer.xyz>
- OpenAPI spec: <https://api.thetrustlayer.xyz/openapi.json>
- MCP server: <https://api.thetrustlayer.xyz/mcp>
- Multi-attestation envelope spec: <https://github.com/douglasborthwick-crypto/insumer-examples/issues/1>
- Source / issues: <https://github.com/goatgaucho/trustlayer-middleware-express>

## License

MIT — see [LICENSE](./LICENSE).
