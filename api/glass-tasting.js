import { MARKETING_VERSION, TASTING_DATES, tastingSchedule } from './lib/glass-campaign.js';
import { restaurantFor, tastingConfiguration, tastingRateKey, tastingState } from './lib/glass-tasting.js';

const EMAIL = /^[^\s@\x00-\x1f\x7f]+@[^\s@\x00-\x1f\x7f]+\.[^\s@\x00-\x1f\x7f]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const unavailable = 'Tasting check-in is unavailable right now. Please try again or ask restaurant staff for the paper option.';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const fail = (status, message) => res.status(status).json({ success: false, message });
  if (!['GET', 'POST'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST');
    return fail(405, "Use the restaurant's tasting form.");
  }
  const config = tastingConfiguration();
  if (req.method === 'GET') {
    const restaurant = restaurantFor(req.query?.restaurant);
    if (!restaurant) return fail(404, "Please scan the restaurant's tasting QR again.");
    const state = tastingState();
    return res.status(200).json({ ...state, enabled: Boolean(config), available: Boolean(config) && state.eligible, restaurant });
  }
  if (!config) return fail(503, unavailable);
  if (req.headers.origin) {
    try {
      if (new URL(req.headers.origin).host !== req.headers.host) return fail(403, "Please reopen the restaurant's tasting page and try again.");
    } catch { return fail(403, "Please reopen the restaurant's tasting page and try again."); }
  }
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) return fail(415, "Use the restaurant's tasting form.");
  let body = req.body;
  try {
    if (Buffer.byteLength(typeof body === 'string' ? body : JSON.stringify(body ?? {})) > 2048) return fail(413, 'Please check your email and try again.');
    if (typeof body === 'string') body = JSON.parse(body);
  } catch { return fail(400, 'Please check your email and try again.'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fail(400, 'Please check your email and try again.');
  if (Object.keys(body).some(key => !['email', 'requestId', 'marketingOptIn', 'marketingChanged', 'restaurant'].includes(key))) {
    return fail(400, "Please reload the restaurant's tasting page and try again.");
  }
  const restaurant = restaurantFor(body.restaurant);
  if (!restaurant) return fail(404, "Please scan the restaurant's tasting QR again.");
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (email.length > 254 || !EMAIL.test(email)) return fail(400, 'Enter a valid email address to continue.');
  if (!UUID.test(body.requestId || '') || typeof body.marketingOptIn !== 'boolean' || typeof body.marketingChanged !== 'boolean'
    || (!body.marketingOptIn && !body.marketingChanged)) return fail(400, 'Please reload the page and choose your email preference again.');
  // Database time is authoritative for submission eligibility; no browser date
  // or preview clock override can reach the RPC.
  try {
    const rateKey = tastingRateKey(req, config.key);
    if (!rateKey) return fail(503, unavailable);
    const response = await fetch(config.url + '/rest/v1/rpc/register_glass_tasting', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: config.key, Authorization: 'Bearer ' + config.key },
      body: JSON.stringify({ p_request_id: body.requestId, p_email: email, p_marketing_opt_in: body.marketingOptIn,
        p_marketing_changed: body.marketingChanged, p_wording_version: MARKETING_VERSION,
        p_restaurant: restaurant.slug, p_rate_key: rateKey }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return fail(503, unavailable);
    const result = await response.json();
    if (result?.status === 'limited') {
      res.setHeader('Retry-After', '60');
      return fail(429, 'A lot of guests are checking in right now. Please wait a minute, then try again. Your entries are still here.');
    }
    if (result?.status === 'closed') return fail(409, 'Tasting check-in is not open for this date. Please check the tasting dates below.');
    if (result?.status === 'expired') return fail(409, 'The tasting date has changed. Please check in again for today.');
    const now = Date.parse(result?.serverNow);
    const until = Date.parse(result?.validUntil);
    if (result?.status !== 'confirmed' || !TASTING_DATES.includes(result.date)
      || !Number.isFinite(now) || !Number.isFinite(until) || until <= now || until - now > 86400000
      || tastingSchedule(new Date(now)).today !== result.date) return fail(503, unavailable);
    return res.status(200).json({ success: true, restaurant, date: result.date, serverNow: result.serverNow, validUntil: result.validUntil });
  } catch { return fail(503, unavailable); }
}
