import Stripe from 'stripe';
import { checkoutSummary, SESSION_ID } from './lib/welcome-checkout.js';

// A session ID is a bearer reference. Accept it only in the body; never log it,
// echo Stripe objects, or permit caching. Configure Vercel WAF for distributed
// rate limiting; the bounded per-instance limiter protects warm invocations.
const attempts = new Map();
function allowed(ip, now = Date.now()) {
  if (!ip) return false;
  for (const [key, entry] of attempts) if (entry.until <= now) attempts.delete(key);
  const entry = attempts.get(ip) || { count: 0, until: now + 60_000 };
  if (!attempts.has(ip) && attempts.size >= 1000) return false;
  attempts.set(ip, entry);
  return ++entry.count <= 20;
}

export function createWelcomeHandler({ retrieve, rateLimit = allowed, env = process.env } = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Referrer-Policy', 'no-referrer');
    const fail = (code, status) => res.status(code).json({ status });
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return fail(405, 'unavailable');
    }
    const host = req.headers.host;
    if (!host || req.headers.origin !== 'https://' + host
      || (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin')) {
      return fail(403, 'unavailable');
    }
    if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) return fail(415, 'unavailable');
    let body = req.body;
    try { if (typeof body === 'string' && body.length <= 512) body = JSON.parse(body); } catch {}
    if (!body || Array.isArray(body) || Object.keys(body).length !== 1 || typeof body.sessionId !== 'string' || !SESSION_ID.test(body.sessionId)) {
      return fail(400, 'unavailable');
    }
    const live = env.VERCEL_ENV === 'production';
    const key = env.STRIPE_SECRET_KEY || '';
    if (!(live ? /^(sk|rk)_live_/ : /^(sk|rk)_test_/).test(key)) return fail(503, 'unavailable');
    if (!body.sessionId.startsWith(live ? 'cs_live_' : 'cs_test_')) return fail(404, 'unavailable');
    const ip = req.headers['x-vercel-forwarded-for'] || req.socket?.remoteAddress;
    if (!rateLimit(ip)) {
      res.setHeader('Retry-After', '60');
      return fail(429, 'unavailable');
    }
    try {
      const stripe = retrieve ? null : new Stripe(key, {
        apiVersion: '2024-06-20', timeout: 5000, maxNetworkRetries: 0,
      });
      const session = await (retrieve || ((id) => stripe.checkout.sessions.retrieve(id, {
        expand: ['line_items', 'invoice'],
      })))(body.sessionId);
      const summary = checkoutSummary(session, body.sessionId, live);
      return summary ? res.status(200).json(summary) : fail(404, 'unavailable');
    } catch (error) {
      return fail(error?.code === 'resource_missing' ? 404 : 503, 'unavailable');
    }
  };
}

export default createWelcomeHandler();
