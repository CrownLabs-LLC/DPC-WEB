// Shared ops primitives used by /api/dashboard-data and /api/health-check.
//
// Every external probe here carries a bounded timeout and independent probes
// run concurrently — the monitoring path must survive the exact provider
// outages it exists to detect, inside the function's 15s budget.

const PROBE_TIMEOUT_MS = 4000;

export function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    if (timer.unref) timer.unref();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export function supabaseConfigured() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export async function supabaseSelect(pathAndQuery, timeoutMs = PROBE_TIMEOUT_MS) {
  const resp = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (!resp.ok) throw new Error(`supabase returned ${resp.status}`);
  return resp.json();
}

export async function supabaseInsert(table, row, timeoutMs = PROBE_TIMEOUT_MS) {
  const resp = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      'content-type': 'application/json',
      prefer: 'return=minimal',
    },
    body: JSON.stringify(row),
  });
  if (!resp.ok) throw new Error(`supabase insert returned ${resp.status}`);
}

// Stripe's own record of events it has not (yet) successfully delivered to a
// webhook endpoint — catches outages even when our own logging is down.
export async function listUndeliveredEvents(stripe, limit = 20) {
  const page = await stripe.events.list({ delivery_success: false, limit }, { timeout: PROBE_TIMEOUT_MS });
  return page.data.map((e) => ({
    id: e.id,
    type: e.type,
    created: e.created,
    pending_webhooks: e.pending_webhooks,
  }));
}

// Env presence, live-mode, and per-capability key probes. The probes exercise
// the read permissions the app actually uses (Checkout Sessions for the
// webhook, PaymentIntents + Events for dashboard/alerts) so a least-privilege
// restricted key is judged on what production needs, not on Balance access.
// The webhook's one write (checkout.sessions.update for the welcome_sent
// marker) has no safe read-only probe — see DEPLOY.md.
export async function healthChecks(stripe, resend) {
  const checks = [];
  const envVars = [
    ['STRIPE_SECRET_KEY', 'Stripe secret key set'],
    ['STRIPE_WEBHOOK_SECRET', 'Stripe webhook secret set'],
    ['RESEND_API_KEY', 'Resend API key set'],
    ['RESEND_FOUNDING_AUDIENCE_ID', 'Resend founding audience ID set'],
    ['SUPABASE_URL', 'Supabase URL set'],
    ['SUPABASE_ANON_KEY', 'Supabase anon key set'],
    ['SUPABASE_SERVICE_ROLE_KEY', 'Supabase service role key set'],
  ];
  for (const [name, label] of envVars) {
    checks.push({
      name: label,
      ok: Boolean(process.env[name]),
      detail: process.env[name] ? '' : `${name} missing in Vercel`,
    });
  }

  // Same live/test detection the webhook itself uses.
  const liveKey = /^(sk|rk)_live_/.test(process.env.STRIPE_SECRET_KEY || '');
  checks.push({
    name: 'Stripe key is live mode',
    ok: liveKey,
    detail: liveKey ? '' : 'Key is TEST mode — live webhook events will fail',
  });

  const stripeProbes = [
    ['Stripe key can read checkout sessions', () => stripe.checkout.sessions.list({ limit: 1 }, { timeout: PROBE_TIMEOUT_MS })],
    ['Stripe key can read payment intents', () => stripe.paymentIntents.list({ limit: 1 }, { timeout: PROBE_TIMEOUT_MS })],
    ['Stripe key can read events', () => stripe.events.list({ limit: 1 }, { timeout: PROBE_TIMEOUT_MS })],
  ];
  const results = await Promise.allSettled([
    ...stripeProbes.map(([, probe]) => probe()),
    withTimeout(resend.domains.list(), PROBE_TIMEOUT_MS, 'resend.domains.list'),
    supabaseConfigured() ? supabaseSelect('site_events?select=id&limit=1') : Promise.resolve(null),
  ]);

  stripeProbes.forEach(([name], i) => {
    const r = results[i];
    checks.push({
      name,
      ok: r.status === 'fulfilled',
      detail: r.status === 'fulfilled' ? '' : String(r.reason?.message || r.reason),
    });
  });

  const resendResult = results[stripeProbes.length];
  let resendOk = false;
  let resendDetail = '';
  let resendPage = true;
  if (resendResult.status === 'fulfilled') {
    resendOk = !resendResult.value?.error;
    resendDetail = resendResult.value?.error
      ? String(resendResult.value.error.message || resendResult.value.error.name || 'error')
      : '';
    if (!resendOk) {
      const errorName = String(resendResult.value.error?.name || '').toLowerCase();
      // A single timeout, rate limit, or provider-side failure is noisy on a
      // five-minute cadence. Keep it visible on the dashboard and in logs,
      // but page only for an explicit credential rejection.
      resendPage = errorName === 'missing_api_key' || errorName === 'invalid_api_key';
    }
  } else {
    resendDetail = String(resendResult.reason?.message || resendResult.reason);
    resendPage = false;
  }
  checks.push({ name: 'Resend key accepted by Resend', ok: resendOk, detail: resendDetail, page: resendPage });

  if (supabaseConfigured()) {
    const supabaseResult = results[stripeProbes.length + 1];
    checks.push({
      name: 'Supabase reachable',
      ok: supabaseResult.status === 'fulfilled',
      detail: supabaseResult.status === 'fulfilled' ? '' : String(supabaseResult.reason?.message || supabaseResult.reason),
    });
  }

  return checks;
}
