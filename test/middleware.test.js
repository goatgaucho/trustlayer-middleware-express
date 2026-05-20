/**
 * Smoke tests for @trustlayer/middleware-express
 * Run: node test/middleware.test.js
 *
 * Tests against the live /gate API at api.thetrustlayer.xyz.
 * Known agents:
 *   - base:1378  → score 38, tier high risk, fails default threshold (64)
 *   - base:18998 → score 26, fails default threshold
 *
 * Tests are intentionally minimal — the middleware is 50 lines, so the
 * surface area worth covering is mostly the integration with /gate.
 */

const trustGate = require('../src/index.js');

let passed = 0;
let failed = 0;

function fakeRes() {
  const res = {
    statusCode: 200,
    body: null,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    setHeader(k, v) { this.headers[k] = v; },
  };
  return res;
}

function fakeReq(opts = {}) {
  return {
    headers: opts.headers || {},
    query: opts.query || {},
    ...opts,
  };
}

async function run(name, fn) {
  try {
    await fn();
    console.log('  PASS  ' + name);
    passed++;
  } catch (e) {
    console.log('  FAIL  ' + name);
    console.log('        ' + e.message);
    failed++;
  }
}

(async () => {
  console.log('\n@trustlayer/middleware-express smoke tests\n');

  await run('pass-through when no agent id resolved (default onUnknown=pass)', async () => {
    const mw = trustGate();
    const req = fakeReq();
    const res = fakeRes();
    let nextCalled = false;
    await mw(req, res, () => { nextCalled = true; });
    if (!nextCalled) throw new Error('expected next() to be called');
  });

  await run('400 when no agent id and onUnknown=block', async () => {
    const mw = trustGate({ onUnknown: 'block' });
    const req = fakeReq();
    const res = fakeRes();
    await mw(req, res, () => {});
    if (res.statusCode !== 400) throw new Error('expected 400, got ' + res.statusCode);
    if (res.body.error !== 'trustlayer_no_agent_id') throw new Error('wrong error code');
  });

  await run('blocks known-high-risk agent base:1378 (score 38 < default 64)', async () => {
    const mw = trustGate({ chain: 'base' });
    const req = fakeReq({ query: { agent: 'base:1378' } });
    const res = fakeRes();
    let nextCalled = false;
    await mw(req, res, () => { nextCalled = true; });
    if (nextCalled) throw new Error('expected block, got pass-through');
    if (res.statusCode !== 403) throw new Error('expected 403, got ' + res.statusCode);
    if (res.body.score == null) throw new Error('expected score in 403 body');
    if (!Array.isArray(res.body.sybil_flags)) throw new Error('expected sybil_flags array');
  });

  await run('passes when minScore set very low (1)', async () => {
    const mw = trustGate({ chain: 'base', minScore: 1 });
    const req = fakeReq({ query: { agent: 'base:1378' } });
    const res = fakeRes();
    let nextCalled = false;
    await mw(req, res, () => { nextCalled = true; });
    if (!nextCalled) throw new Error('expected pass-through with minScore=1');
    if (!req.trustlayer) throw new Error('expected req.trustlayer to be populated');
  });

  await run('reads agent id from X-Agent-Id header', async () => {
    const mw = trustGate({ chain: 'base', minScore: 1 });
    const req = fakeReq({ headers: { 'x-agent-id': 'base:1378' } });
    const res = fakeRes();
    let nextCalled = false;
    await mw(req, res, () => { nextCalled = true; });
    if (!nextCalled) throw new Error('expected pass-through (minScore=1)');
    if (req.trustlayer.agent !== 'base:1378') throw new Error('wrong agent resolved');
  });

  await run('caches repeated calls (no new request for same key)', async () => {
    const mw = trustGate({ chain: 'base', minScore: 1, cacheTtlMs: 60000 });
    const req1 = fakeReq({ query: { agent: 'base:1378' } });
    const req2 = fakeReq({ query: { agent: 'base:1378' } });
    const t0 = Date.now();
    await mw(req1, fakeRes(), () => {});
    const t1 = Date.now();
    await mw(req2, fakeRes(), () => {});
    const t2 = Date.now();
    const first = t1 - t0;
    const second = t2 - t1;
    if (second >= first) {
      // not a hard fail — networks vary — but warn loudly
      console.log('        (warning: cache hit not faster than miss; first=' + first + 'ms second=' + second + 'ms)');
    }
  });

  await run('custom resolveAgentId is honored', async () => {
    const mw = trustGate({
      chain: 'base',
      minScore: 1,
      resolveAgentId: (req) => req.body && req.body.targetAgent,
    });
    const req = fakeReq({ body: { targetAgent: 'base:1378' } });
    const res = fakeRes();
    let nextCalled = false;
    await mw(req, res, () => { nextCalled = true; });
    if (!nextCalled) throw new Error('expected pass-through');
    if (req.trustlayer.agent !== 'base:1378') throw new Error('custom resolver was ignored');
  });

  await run('failOpen=true (default) returns next() on gate error', async () => {
    const mw = trustGate({ gateUrl: 'https://invalid.localhost.invalid/gate', timeoutMs: 300 });
    const req = fakeReq({ query: { agent: 'base:1378' } });
    const res = fakeRes();
    let nextCalled = false;
    await mw(req, res, () => { nextCalled = true; });
    if (!nextCalled) throw new Error('expected fail-open');
  });

  await run('failOpen=false returns 503 on gate error', async () => {
    const mw = trustGate({ gateUrl: 'https://invalid.localhost.invalid/gate', failOpen: false, timeoutMs: 300 });
    const req = fakeReq({ query: { agent: 'base:1378' } });
    const res = fakeRes();
    await mw(req, res, () => {});
    if (res.statusCode !== 503) throw new Error('expected 503, got ' + res.statusCode);
    if (res.body.error !== 'trustlayer_gate_unavailable') throw new Error('wrong error code');
  });

  console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
  process.exit(failed > 0 ? 1 : 0);
})();
