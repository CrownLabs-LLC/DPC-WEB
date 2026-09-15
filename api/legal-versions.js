// GET /api/legal-versions — the live checkout legal-version tuple.
//
// join.html and depositor-confirmation.html used to carry this tuple as a
// hardcoded literal, which meant any cached page, open tab, or stale deploy
// submitted versions the server had already moved past and checkout failed
// with LEGAL_VERSIONS_NOT_CURRENT. The pages now read it from here instead.
//
// The tuple is CONSENT EVIDENCE, not configuration: circle-checkout forwards
// what the client submits into record_pre_payment_legal_acceptance, which
// writes it with IP and user agent. So this endpoint only ever *reports* the
// current versions — the page still has to show them and get an explicit tick
// before they are submitted, and a change between load and submit forces a
// re-accept rather than a silent upgrade.
//
// Access: member_legal_current_versions is locked down (RLS on, table
// privileges to postgres only), so this calls the membership-owned
// SECURITY DEFINER RPC rather than selecting the table. The RPC returns
// version strings only — no consent rows, no member data, no PII.
//
// Caching: this route is unauthenticated and reachable before Turnstile by
// necessity (it is what the page fetches to render current-terms state).
// A Vercel WAF rule rate-limits this exact path per IP, including requests
// with `?fresh=1`; DEPLOY.md §2g documents the public behavioral contract.
// Live rule configuration belongs in the private operations note. `s-maxage`
// additionally collapses the default path to roughly one RPC per 10s window
// per Vercel cache region.
// `?fresh=1` bypasses that cache for submit-time revalidation, which must never
// read a stale tuple. See plans/join-legal-version-staleness-remediation.
//
// Fails closed in every failure mode: no baked-in fallback tuple, ever. A
// fallback would reintroduce exactly the staleness bug this endpoint exists
// to remove.
import { randomUUID } from 'node:crypto';
import { responseDiagnostics, sanitizeDiagnostics } from './lib/join-diagnostics.js';
import { supabaseConfigured } from './lib/ops-checks.js';

const RPC_NAME = 'current_checkout_legal_versions';
const RPC_TIMEOUT_MS = 4000;
const TUPLE_KEYS = ['tos', 'privacy', 'memberTerms', 'autoRenewalTerms'];

// s-maxage is load-bearing: Vercel caches a Function response only when
// Cache-Control carries s-maxage. A bare max-age would still look like a cache
// header while leaving every non-caching client (bots, crawlers, curl) to
// invoke the Function and the RPC on every request. max-age=0 keeps the
// browser revalidating instead of holding its own copy.
const CACHED = 'public, max-age=0, s-maxage=10, stale-while-revalidate=50';
const UNCACHED = 'no-store';

function wantsFresh(req) {
  const fromQuery = req?.query?.fresh;
  if (fromQuery !== undefined) {
    return String(Array.isArray(fromQuery) ? fromQuery[0] : fromQuery) === '1';
  }
  const url = String(req?.url || '');
  const qs = url.slice(url.indexOf('?') + 1);
  return url.includes('?') && new URLSearchParams(qs).get('fresh') === '1';
}

// A structurally incomplete success is a distinct failure mode from an RPC
// error — it is what future schema drift looks like — so it gets its own
// check rather than being inferred from a missing key at read time.
function completeTuple(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const tuple = {};
  for (const key of TUPLE_KEYS) {
    const version = value[key];
    if (typeof version !== 'string' || !version.trim()) return null;
    tuple[key] = version;
  }
  return tuple;
}

// A failure carries only bounded diagnostics, never the provider's raw text.
async function readLegalVersions(context) {
  const resp = await fetch(`${process.env.SUPABASE_URL}/rest/v1/rpc/${RPC_NAME}`, {
    method: 'POST', signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      'content-type': 'application/json',
    },
    body: '{}',
  });
  Object.assign(context, responseDiagnostics(resp));
  // Preserve the website request ID; the provider has its separate field.
  const raw = await resp.text();
  let body;
  try { body = JSON.parse(raw); } catch {
    if (resp.ok) throw Object.assign(new Error('invalid_json'), { kind: 'invalid_json' });
  }
  Object.assign(context, sanitizeDiagnostics({
    body_code: body?.code,
    rpc_reason: body?.code === 'P0001' ? body?.message : undefined,
  }));
  // HTTP failure describes the response, regardless of its encoding or which
  // upstream layer produced it. body_code/rpc_reason carry the finer evidence.
  if (!resp.ok) throw Object.assign(new Error('http'), { kind: 'http' });
  return body;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.setHeader('Cache-Control', UNCACHED);
    return res.status(405).json({ error: 'GET required' });
  }
  const requestId = randomUUID();
  const started = performance.now();
  const context = { component: 'legal_versions' };
  res.setHeader('X-DPC-Request-Id', requestId);
  const log = (kind) => {
    const detail = sanitizeDiagnostics({
      ...context, request_id: requestId,
      elapsed_ms: Math.round(performance.now() - started),
      ...(kind ? { failure_kind: kind } : {}),
    });
    (kind ? console.error : console.info)('legal-versions: lookup', JSON.stringify(detail));
  };
  const unavailable = (kind) => {
    log(kind);
    res.setHeader('X-DPC-Failure-Kind', kind);
    res.setHeader('Cache-Control', UNCACHED);
    return res.status(503).json({ error: 'legal versions unavailable' });
  };
  if (!supabaseConfigured()) return unavailable('configuration');
  let tuple;
  try {
    tuple = completeTuple(await readLegalVersions(context));
  } catch (err) {
    return unavailable(err?.name === 'TimeoutError' || err?.name === 'AbortError'
      ? 'timeout' : err?.kind || 'network');
  }
  if (!tuple) return unavailable('incomplete_tuple');
  log();
  res.setHeader('Cache-Control', wantsFresh(req) ? UNCACHED : CACHED);
  return res.status(200).json(tuple);
}
