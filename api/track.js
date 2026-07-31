// First-party, anonymous funnel beacon. Stores only the event name, page
// label, path, referrer hostname, and allowlisted join failure code/status —
// no cookies, IPs, or user identifiers, consistent with the privacy policy's
// "aggregated, de-identified analytics".
//
// Always responds 202: telemetry must never surface an error to the site.

const ALLOWED_EVENTS = new Set([
  'page_view',
  'deposit_click',
  'deposit_confirmed',
  'form_submit',
  'join_submit',
  'join_checkout_redirect',
  'join_error',
  'membership_checkout_complete',
  'membership_checkout_cancelled',
  'partner_subscription_checkout_submitted',
  'partner_subscription_checkout_cancelled',
]);
const ALLOWED_ERROR_CODES = new Set([
  'turnstile_unavailable',
  'turnstile_incomplete',
  'network',
  'unknown',
  'CHECKOUT_NOT_ENABLED',
  'FOUNDING_UNAVAILABLE',
  'SIGN_IN_REQUIRED',
  'RATE_LIMITED',
  'CHALLENGE_FAILED',
  'LEGAL_VERSIONS_NOT_CURRENT',
  'MEMBER_NOT_ELIGIBLE',
  'DEPOSITOR_CONFIRMATION_INVALID',
]);
const MAX_LEN = 200;

function clean(value) {
  if (typeof value !== 'string') return null;
  const s = value.trim().slice(0, MAX_LEN);
  return s || null;
}

function referrerHost(value) {
  const s = clean(value);
  if (!s) return null;
  try {
    return new URL(s).hostname.slice(0, MAX_LEN) || null;
  } catch {
    return null;
  }
}

function errorCode(value) {
  if (typeof value !== 'string') return null;
  const s = value.trim().slice(0, 100);
  if (!/^[A-Za-z0-9_.:-]{1,100}$/.test(s)) return null;
  return ALLOWED_ERROR_CODES.has(s) ? s : 'unknown';
}

function httpStatus(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 100 && n <= 599 ? n : null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ stored: false });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    return res.status(202).json({ stored: false });
  }

  // navigator.sendBeacon posts a JSON blob; Vercel parses it when the
  // content-type is set, but fall back to parsing a raw string body.
  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      body = null;
    }
  }

  const event = clean(body?.event);
  if (!event || !ALLOWED_EVENTS.has(event)) {
    return res.status(202).json({ stored: false });
  }

  try {
    const payload = {
      event,
      page: clean(body?.page),
      path: clean(body?.path),
      referrer: referrerHost(body?.referrer),
    };
    if (event === 'join_error') {
      payload.error_code = errorCode(body?.error_code);
      payload.http_status = httpStatus(body?.http_status);
    }
    const resp = await fetch(`${supabaseUrl}/rest/v1/site_events`, {
      method: 'POST',
      signal: AbortSignal.timeout(3000),
      headers: {
        apikey: anonKey,
        authorization: `Bearer ${anonKey}`,
        'content-type': 'application/json',
        prefer: 'return=minimal',
      },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      console.error('track: supabase insert rejected', resp.status);
    }
    return res.status(202).json({ stored: resp.ok });
  } catch (err) {
    console.error('track: insert failed (non-fatal)', err?.message || err);
    return res.status(202).json({ stored: false });
  }
}
