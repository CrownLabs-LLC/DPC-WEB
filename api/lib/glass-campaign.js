import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';

export const TASTING_DATES = ['2026-09-29', '2026-09-30', '2026-10-06', '2026-10-13', '2026-10-14'];
export const MARKETING_VERSION = 'glass-2026-09-24-v1';
export const MARKETING_WORDING = 'Email me DPC news and upcoming events.';

export function pickupRateKey(req, secret, now = new Date()) {
  // Vercel supplies this header at its edge. Never trust a browser-supplied
  // address in the body or fall back to a possibly forwarded proxy chain.
  const hosted = ['production', 'preview'].includes(process.env.VERCEL_ENV);
  const address = hosted ? req.headers['x-vercel-forwarded-for'] : req.socket?.remoteAddress;
  if (typeof address !== 'string' || !isIP(address)) return null;
  const normalized = isIP(address) === 6 ? new URL('http://[' + address + ']').hostname : address;
  return createHmac('sha256', secret)
    .update('glass-pickup:' + now.toISOString().slice(0, 10) + ':' + normalized)
    .digest('hex');
}

export function tastingSchedule(now = new Date()) {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
  const endDate = TASTING_DATES.at(-1);
  return { today, dates: TASTING_DATES.filter(date => date >= today), endDate, ended: today > endDate };
}

export function pickupConfiguration() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (process.env.GLASS_PICKUP_ENABLED !== 'true' || !url || !key) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) return null;
    // A preview must never fall through to the production campaign database.
    const expected = process.env.VERCEL_ENV === 'production' ? 'ebiuspbgzggrdiaswpcc.supabase.co'
      : process.env.VERCEL_ENV === 'preview' ? 'hohbsqkmrlhkstojfdgx.supabase.co' : null;
    if (expected && parsed.hostname !== expected) return null;
    return { url: parsed.origin, key };
  } catch { return null; }
}
