/**
 * @trustlayer/middleware-express
 *
 * Express middleware that screens incoming callers through the TrustLayer
 * /gate API before any paywall or business logic runs. Pass-through when
 * the caller's score meets the threshold; 403 with a structured payload
 * when it doesn't. Unknown agents and gate errors are configurable.
 *
 * Quickstart:
 *   const trustGate = require('@trustlayer/middleware-express');
 *
 *   app.use('/paid', trustGate({ minScore: 64 }), paidHandler);
 *
 * The middleware resolves the agent id from (in order):
 *   1. opts.resolveAgentId(req)  — your custom resolver
 *   2. req.header('X-Agent-Id')
 *   3. req.query.agent
 *
 * No agent id resolved → opts.onUnknown decides (default: pass-through).
 */

const DEFAULT_GATE_URL = 'https://api.thetrustlayer.xyz/gate';
const DEFAULT_TIMEOUT_MS = 1500;
const DEFAULT_MIN_SCORE = 64;
const DEFAULT_CACHE_TTL_MS = 60_000;

function defaultResolver(req) {
  return req.headers['x-agent-id'] || req.query.agent || null;
}

function makeCache(ttlMs) {
  const store = new Map();
  return {
    get(key) {
      const entry = store.get(key);
      if (!entry) return null;
      if (Date.now() > entry.expires) {
        store.delete(key);
        return null;
      }
      return entry.value;
    },
    set(key, value) {
      store.set(key, { value, expires: Date.now() + ttlMs });
    },
    clear() {
      store.clear();
    },
  };
}

async function callGate({ gateUrl, agentId, chain, apiKey, timeoutMs }) {
  const url = new URL(gateUrl);
  url.searchParams.set('agent', agentId);
  if (chain) url.searchParams.set('chain', chain);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers = { Accept: 'application/json' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
    const res = await fetch(url.toString(), { headers, signal: controller.signal });
    if (!res.ok) {
      throw new Error(`gate returned ${res.status}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {object} opts
 * @param {number} [opts.minScore=64]            Trust score threshold for pass-through.
 * @param {string} [opts.chain]                  Default chain (e.g. "base"). Skipped if not set.
 * @param {string} [opts.gateUrl]                Override the /gate endpoint URL.
 * @param {string} [opts.apiKey]                 API key sent as `Authorization: Bearer …` (skips the 100/hr/IP free tier).
 * @param {number} [opts.timeoutMs=1500]         Per-call timeout. Hard-fails to opts.onError on timeout.
 * @param {number} [opts.cacheTtlMs=60000]       In-memory cache TTL. Set 0 to disable.
 * @param {boolean} [opts.failOpen=true]         If true, gate errors fall through to the next handler.
 * @param {Function} [opts.resolveAgentId]       (req) => string|null. Custom agent id resolver.
 * @param {"pass"|"block"} [opts.onUnknown="pass"]  Behavior when no agent id is resolved.
 * @param {Function} [opts.onBlock]              (req, res, gateResult) => void. Override the 403 response.
 */
function trustGate(opts = {}) {
  const config = {
    minScore: opts.minScore ?? DEFAULT_MIN_SCORE,
    chain: opts.chain,
    gateUrl: opts.gateUrl || DEFAULT_GATE_URL,
    apiKey: opts.apiKey,
    timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    cacheTtlMs: opts.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS,
    failOpen: opts.failOpen !== false,
    resolveAgentId: opts.resolveAgentId || defaultResolver,
    onUnknown: opts.onUnknown || 'pass',
    onBlock: opts.onBlock,
  };

  const cache = config.cacheTtlMs > 0 ? makeCache(config.cacheTtlMs) : null;

  return async function trustGateMiddleware(req, res, next) {
    const agentId = config.resolveAgentId(req);

    if (!agentId) {
      if (config.onUnknown === 'block') {
        return res.status(400).json({
          error: 'trustlayer_no_agent_id',
          message: 'No agent id resolved from request. Pass `X-Agent-Id` header or `?agent=` query.',
        });
      }
      return next();
    }

    const cacheKey = config.chain ? `${agentId}|${config.chain}` : agentId;
    let gateResult = cache ? cache.get(cacheKey) : null;

    if (!gateResult) {
      try {
        gateResult = await callGate({
          gateUrl: config.gateUrl,
          agentId,
          chain: config.chain,
          apiKey: config.apiKey,
          timeoutMs: config.timeoutMs,
        });
        if (cache) cache.set(cacheKey, gateResult);
      } catch (err) {
        if (config.failOpen) return next();
        return res.status(503).json({
          error: 'trustlayer_gate_unavailable',
          message: err.message,
        });
      }
    }

    req.trustlayer = gateResult;

    const score = typeof gateResult.score === 'number' ? gateResult.score : null;
    // If caller supplied minScore, re-evaluate locally. Otherwise trust the server's pass field.
    const pass = opts.minScore != null
      ? (score !== null && score >= config.minScore)
      : !!gateResult.pass;

    if (pass) return next();

    if (config.onBlock) return config.onBlock(req, res, gateResult);

    return res.status(403).json({
      error: 'trustlayer_trust_check_failed',
      agent_id: agentId,
      score,
      threshold: opts.minScore != null ? config.minScore : (gateResult.threshold ?? config.minScore),
      sybil_flags: gateResult.sybil_flags || [],
      reason: gateResult.reason || 'score below threshold',
      recommendation: gateResult.recommendation || null,
      learn_more: 'https://api.thetrustlayer.xyz/trust/' + encodeURIComponent(agentId),
    });
  };
}

trustGate.DEFAULT_GATE_URL = DEFAULT_GATE_URL;
trustGate.DEFAULT_MIN_SCORE = DEFAULT_MIN_SCORE;

module.exports = trustGate;
module.exports.default = trustGate;
