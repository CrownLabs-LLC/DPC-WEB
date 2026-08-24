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

// Deliberately not ops-checks.js's shared supabaseRpc(): that helper throws on
// a non-ok response without reading the body, which would discard the very
// detail this endpoint needs to log — a permission-denied (grant regression)
// and a raised legal_currentness_unavailable (missing singleton) are the two
// failures worth telling apart in production, and both are invisible from the
// status code alone.
async function readLegalVersions() {
  const resp = await fetch(`${process.env.SUPABASE_URL}/rest/v1/rpc/${RPC_NAME}`, {
    method: 'POST',
    signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      'content-type': 'application/json',
    },
    body: '{}',
  });
  const raw = await resp.text();
  if (!resp.ok) {
    let detail = raw.slice(0, 300);
    try {
      const parsed = JSON.parse(raw);
      detail = parsed?.message || parsed?.error || detail;
    } catch { /* non-JSON error body: the raw text is the detail */ }
    throw new Error(`${RPC_NAME} returned ${resp.status}: ${detail}`);
  }
  return JSON.parse(raw);
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.setHeader('Cache-Control', UNCACHED);
    return res.status(405).json({ error: 'GET required' });
  }

  const fresh = wantsFresh(req);

  if (!supabaseConfigured()) {
    console.error('legal-versions: Supabase not configured — refusing to serve a tuple');
    res.setHeader('Cache-Control', UNCACHED);
    return res.status(503).json({ error: 'legal versions unavailable' });
  }

  let tuple;
  try {
    tuple = completeTuple(await readLegalVersions());
  } catch (err) {
    // A transient RPC blip must never be cached and replayed as a false outage.
    console.error('legal-versions: RPC failed', String(err?.message || err));
    res.setHeader('Cache-Control', UNCACHED);
    return res.status(503).json({ error: 'legal versions unavailable' });
  }

  if (!tuple) {
    console.error('legal-versions: RPC returned a structurally incomplete tuple');
    res.setHeader('Cache-Control', UNCACHED);
    return res.status(503).json({ error: 'legal versions unavailable' });
  }

  res.setHeader('Cache-Control', fresh ? UNCACHED : CACHED);
  return res.status(200).json(tuple);
}
