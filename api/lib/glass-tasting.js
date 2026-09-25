import { createHmac } from 'node:crypto';
import { pickupRateKey, tastingSchedule, TASTING_DATES } from './glass-campaign.js';

export const RESTAURANTS = Object.freeze({
  'demitris-taverna': "Demitri's Taverna",
  'swirl-on-the-square': 'Swirl on the Square',
  'calamari-bistro-bar': 'Calamari Bistro & Bar',
  'l-campo': 'L Campo',
});
export function restaurantFor(slug) {
  return typeof slug === 'string' && Object.hasOwn(RESTAURANTS, slug) ? { slug, name: RESTAURANTS[slug] } : null;
}
export function tastingState(now = new Date()) {
  const schedule = tastingSchedule(now);
  return { schedule, eligible: TASTING_DATES.includes(schedule.today), serverNow: now.toISOString() };
}
export function tastingConfiguration() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (process.env.GLASS_TASTING_ENABLED !== 'true' || !url || !key) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) return null;
    const expected = process.env.VERCEL_ENV === 'production' ? 'ebiuspbgzggrdiaswpcc.supabase.co'
      : process.env.VERCEL_ENV === 'preview' ? 'hohbsqkmrlhkstojfdgx.supabase.co' : null;
    if (expected && parsed.hostname !== expected) return null;
    return { url: parsed.origin, key };
  } catch { return null; }
}
export function tastingRateKey(req, secret) {
  const networkKey = pickupRateKey(req, secret);
  return networkKey ? createHmac('sha256', secret).update('glass-tasting:' + networkKey).digest('hex') : null;
}
