import { MARKETING_VERSION, pickupConfiguration, pickupRateKey, tastingSchedule } from './lib/glass-campaign.js';

const EMAIL = /^[^\s@\x00-\x1f\x7f]+@[^\s@\x00-\x1f\x7f]+\.[^\s@\x00-\x1f\x7f]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const unavailable = 'Pickup check-in is unavailable right now. Please try again or ask the person handing out glasses for the paper option.';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const fail = (status, message) => res.status(status).json({ success: false, message });
  if (!['GET', 'POST'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST');
    return fail(405, 'Use the glass pickup form.');
  }
  const config = pickupConfiguration();
  if (req.method === 'GET') return res.status(200).json({ available: Boolean(config), schedule: tastingSchedule() });
  if (!config) return fail(503, unavailable);
  // Browser submissions are same-origin. No CORS or email-based read endpoint.
  if (req.headers.origin) {
    try {
      if (new URL(req.headers.origin).host !== req.headers.host) return fail(403, 'Please reopen the glass pickup page and try again.');
    } catch { return fail(403, 'Please reopen the glass pickup page and try again.'); }
  }
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) return fail(415, 'Use the glass pickup form.');
  let body = req.body;
  try {
    if (Buffer.byteLength(typeof body === 'string' ? body : JSON.stringify(body ?? {})) > 2048) return fail(413, 'Please check your email and try again.');
    if (typeof body === 'string') body = JSON.parse(body);
  } catch { return fail(400, 'Please check your email and try again.'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fail(400, 'Please check your email and try again.');
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (email.length > 254 || !EMAIL.test(email)) return fail(400, 'Enter a valid email address to continue.');
  if (!UUID.test(body.requestId || '') || typeof body.marketingOptIn !== 'boolean' || typeof body.marketingChanged !== 'boolean'
      || (!body.marketingOptIn && !body.marketingChanged)) return fail(400, 'Please reload the page and choose your email preference again.');
  try {
    const rateKey = pickupRateKey(req, config.key);
    if (!rateKey) return fail(503, unavailable);
    const response = await fetch(config.url + '/rest/v1/rpc/register_glass_pickup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: config.key, Authorization: 'Bearer ' + config.key },
      body: JSON.stringify({ p_request_id: body.requestId, p_email: email, p_marketing_opt_in: body.marketingOptIn,
        p_marketing_changed: body.marketingChanged, p_wording_version: MARKETING_VERSION, p_rate_key: rateKey }),
      signal: AbortSignal.timeout(8000),
    });
    // Never relay database bodies: they can contain email or conflict details.
    if (!response.ok) return fail(503, unavailable);
    const recorded = await response.json();
    if (recorded === false) {
      res.setHeader('Retry-After', '60');
      return fail(429, 'A lot of guests are checking in right now. Please wait a minute, then try again. Your entries are still here.');
    }
    if (recorded !== true) return fail(503, unavailable);
    return res.status(200).json({ success: true, schedule: tastingSchedule() });
  } catch { return fail(503, unavailable); }
}
