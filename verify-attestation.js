#!/usr/bin/env node
/**
 * TrustLayer multi-attestation envelope verifier.
 *
 * Usage:
 *   node verify-attestation.js <wallet> [chain]
 *   node verify-attestation.js 0x... base
 *
 * What it does:
 *   1. Fetches GET /attest/wallet/:address from api.thetrustlayer.xyz
 *   2. Fetches the JWKS at envelope.jwks
 *   3. Re-canonicalizes the `signed` block with sorted keys
 *   4. Verifies the P1363 (raw R||S) ES256 sig against the canonical bytes
 *   5. Prints PASS/FAIL with the resolved fields
 *
 * Matches the format defined in:
 *   github.com/douglasborthwick-crypto/insumer-examples issue #1
 */

const crypto = require('crypto');

const API = process.env.TRUSTLAYER_API || 'https://api.thetrustlayer.xyz';

function canonicalize(obj) {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(canonicalize).join(',') + ']';
  const keys = Object.keys(obj).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalize(obj[k])).join(',') + '}';
}

async function main() {
  const wallet = process.argv[2];
  const chain = process.argv[3];
  if (!wallet) {
    console.error('Usage: node verify-attestation.js <wallet> [chain]');
    process.exit(1);
  }

  const url = `${API}/attest/wallet/${wallet}` + (chain ? `?chain=${chain}` : '');
  console.log(`[1/4] GET ${url}`);
  const envelope = await fetch(url).then(r => r.json());

  if (envelope.found === false) {
    console.log('Wallet not found in any indexed registry:', envelope.note);
    process.exit(0);
  }
  if (!envelope.sig) {
    console.error('No envelope returned:', envelope);
    process.exit(1);
  }

  console.log(`[2/4] Envelope: type=${envelope.type} kid=${envelope.kid} alg=${envelope.alg}`);
  console.log(`      Cross-chain primitive: identity_group_id=${envelope.signed.identity_group_id} linked_addresses_count=${envelope.signed.linked_addresses_count}`);
  console.log(`      Chains present: ${envelope.signed.chains_present.join(', ')}`);

  console.log(`[3/4] Fetching JWKS at ${envelope.jwks}`);
  const jwks = await fetch(envelope.jwks).then(r => r.json());
  const jwk = jwks.keys.find(k => k.kid === envelope.kid);
  if (!jwk) {
    console.error(`No JWK with kid=${envelope.kid} in JWKS`);
    process.exit(1);
  }

  console.log(`[4/4] Verifying P1363 ES256 sig over canonicalized signed block`);
  const publicKey = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  const canonical = canonicalize(envelope.signed);
  const sigBuffer = Buffer.from(envelope.sig, 'base64url');

  const ok = crypto.verify(
    'sha256',
    Buffer.from(canonical),
    { key: publicKey, dsaEncoding: 'ieee-p1363' },
    sigBuffer
  );

  if (ok) {
    console.log('\n✅ PASS — signature verified.');
    console.log('\nSigned payload:');
    console.log(JSON.stringify(envelope.signed, null, 2));
    process.exit(0);
  } else {
    console.error('\n❌ FAIL — signature did not verify.');
    process.exit(1);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
