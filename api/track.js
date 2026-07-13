// First-party, anonymous funnel beacon. Stores only the event name, page
// label, path, and referrer hostname — no cookies, IPs, or user identifiers,
// consistent with the privacy policy's "aggregated, de-identified analytics".
//
// Always responds 202: telemetry must never surface an error to the site.

const ALLOWED_EVENTS = new Set([
  'page_view',
  'deposit_click',
  'deposit_confirmed',
  'form_submit',
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
    const resp = await fetch(`${supabaseUrl}/rest/v1/site_events`, {
      method: 'POST',
      signal: AbortSignal.timeout(3000),
      headers: {
        apikey: anonKey,
        authorization: `Bearer ${anonKey}`,
        'content-type': 'application/json',
        prefer: 'return=minimal',
      },
      body: JSON.stringify({
        event,
        page: clean(body?.page),
        path: clean(body?.path),
        referrer: referrerHost(body?.referrer),
      }),
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
