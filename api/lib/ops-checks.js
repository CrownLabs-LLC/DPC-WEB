// Shared ops primitives used by /api/dashboard-data and /api/health-check.

export function supabaseConfigured() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export async function supabaseSelect(pathAndQuery) {
  const resp = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (!resp.ok) throw new Error(`supabase returned ${resp.status}`);
  return resp.json();
}

export async function supabaseInsert(table, row) {
  const resp = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
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
  const page = await stripe.events.list({ delivery_success: false, limit });
  return page.data.map((e) => ({
    id: e.id,
    type: e.type,
    created: e.created,
    pending_webhooks: e.pending_webhooks,
  }));
}

// Env-presence plus LIVE key validity. The live calls are the checks that
// catch a rotated/revoked key (like the July 8 incident) — env presence alone
// cannot see that.
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

  let stripeOk = false;
  let liveMode = false;
  let stripeDetail = '';
  try {
    const balance = await stripe.balance.retrieve();
    stripeOk = true;
    liveMode = Boolean(balance.livemode);
  } catch (err) {
    stripeDetail = String(err?.message || err);
  }
  checks.push({ name: 'Stripe key accepted by Stripe', ok: stripeOk, detail: stripeDetail });
  checks.push({
    name: 'Stripe key is live mode',
    ok: stripeOk && liveMode,
    detail: stripeOk && !liveMode ? 'Key is TEST mode — live webhook events will fail' : stripeOk ? '' : 'unknown (key invalid)',
  });

  let resendOk = false;
  let resendDetail = '';
  try {
    const domains = await resend.domains.list();
    resendOk = !domains?.error;
    resendDetail = domains?.error ? String(domains.error.message || domains.error.name || 'error') : '';
  } catch (err) {
    resendDetail = String(err?.message || err);
  }
  checks.push({ name: 'Resend key accepted by Resend', ok: resendOk, detail: resendDetail });

  if (supabaseConfigured()) {
    let supabaseOk = false;
    let supabaseDetail = '';
    try {
      await supabaseSelect('site_events?select=id&limit=1');
      supabaseOk = true;
    } catch (err) {
      supabaseDetail = String(err?.message || err);
    }
    checks.push({ name: 'Supabase reachable', ok: supabaseOk, detail: supabaseDetail });
  }

  return checks;
}
