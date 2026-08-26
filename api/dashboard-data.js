// Data source for /dashboard. Token-protected (DASHBOARD_TOKEN env var,
// Bearer auth). Aggregates:
//   - site funnel (Supabase site_events, written by /api/track)
//   - billing-owned, PII-free subscription operations overview (Supabase RPC)
//   - alerts (Supabase webhook_logs errors + Stripe undelivered events)
//   - health checks (env presence + live key validity for Stripe/Resend/Supabase)
// Sections degrade independently: a failing source reports itself instead of
// taking the whole dashboard down.
import Stripe from 'stripe';
import { Resend } from 'resend';
import { timingSafeEqual } from 'node:crypto';
import {
  supabaseConfigured,
  supabaseRpc,
  supabaseSelect,
  listUndeliveredEvents,
  healthChecks,
} from './lib/ops-checks.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const CIRCLES = new Set(['tap', 'cellar', 'reserve']);
const BILLING_INTERVALS = new Set(['monthly', 'annual']);
const OFFER_TYPES = new Set(['standard', 'founding', 'unknown']);
const JOIN_ERROR_CODES = new Set([
  'turnstile_unavailable',
  'turnstile_incomplete',
  'legal_versions_unavailable',
  'legal_versions_changed',
  'legal_versions_rate_limited',
  'network',
  'navigation',
  'unknown',
  'CHECKOUT_IN_PROGRESS',
  'CHECKOUT_NOT_ENABLED',
  'FOUNDING_UNAVAILABLE',
  'SIGN_IN_REQUIRED',
  'RATE_LIMITED',
  'CHALLENGE_FAILED',
  'LEGAL_VERSIONS_NOT_CURRENT',
  'MEMBER_NOT_ELIGIBLE',
  'DEPOSITOR_CONFIRMATION_INVALID',
]);
// Business days are Pacific — the collective is in Livermore, CA.
const DAY_FMT = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' });

function dayKey(msEpoch) {
  return DAY_FMT.format(new Date(msEpoch));
}
const HOUR_FMT = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'America/Los_Angeles',
  hour: '2-digit',
  hourCycle: 'h23',
});

function hourKey(msEpoch) {
  return `${dayKey(msEpoch)}T${HOUR_FMT.format(new Date(msEpoch))}`;
}

// Landing pages ad traffic can arrive on. `page` is the label /api/track stores.
const PAGE_HOME = 'member';
const PAGE_JOIN = 'join';

// Referrer hosts are already reduced to a bare hostname by /api/track, so
// grouping them is enough to separate paid social from warm traffic without
// UTM tagging. Unrecognised hosts fall to 'other' rather than being dropped.
const META_HOSTS = new Set([
  'instagram.com', 'www.instagram.com', 'l.instagram.com', 'lm.instagram.com',
  'facebook.com', 'www.facebook.com', 'm.facebook.com', 'l.facebook.com',
  'lm.facebook.com', 'business.facebook.com',
]);
const SEARCH_HOSTS = new Set([
  'google.com', 'www.google.com', 'news.google.com',
  'bing.com', 'www.bing.com', 'duckduckgo.com',
  'search.yahoo.com', 'r.search.yahoo.com', 'www.ecosia.org',
]);
// Own domain and the checkout host members bounce back from: on-site movement,
// not acquisition. Counted separately so it cannot inflate a traffic source.
const INTERNAL_HOSTS = new Set([
  'downtownpourcollective.com', 'www.downtownpourcollective.com',
  'checkout.stripe.com', 'buy.stripe.com',
]);
const SOURCE_GROUPS = ['meta', 'direct', 'search', 'other', 'internal'];

function sourceGroup(referrer) {
  if (!referrer) return 'direct';
  const host = String(referrer).toLowerCase();
  if (META_HOSTS.has(host)) return 'meta';
  if (SEARCH_HOSTS.has(host)) return 'search';
  if (INTERNAL_HOSTS.has(host)) return 'internal';
  return 'other';
}

// /join has two unrelated front doors and they must not share a conversion
// rate: visitors who clicked through from the homepage have already read the
// pitch, while flyer QR scans land on /join cold with no context at all. A
// blended join-page number averages a warm audience with a cold one.
const OWN_SITE_HOSTS = new Set([
  'downtownpourcollective.com', 'www.downtownpourcollective.com',
]);
const CHECKOUT_RETURN_HOSTS = new Set(['checkout.stripe.com', 'buy.stripe.com']);
const JOIN_ENTRY_GROUPS = ['from_site', 'direct', 'meta', 'search', 'other', 'return'];

function joinEntryGroup(referrer) {
  if (!referrer) return 'direct';
  const host = String(referrer).toLowerCase();
  if (OWN_SITE_HOSTS.has(host)) return 'from_site';
  if (CHECKOUT_RETURN_HOSTS.has(host)) return 'return';
  if (META_HOSTS.has(host)) return 'meta';
  if (SEARCH_HOSTS.has(host)) return 'search';
  return 'other';
}

function authorized(req) {
  const token = process.env.DASHBOARD_TOKEN;
  if (!token) return false;
  const header = String(req.headers.authorization || '');
  const provided = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

function emptyDailyMap(days, now) {
  const map = new Map();
  for (let i = days - 1; i >= 0; i--) {
    const key = dayKey(now - i * DAY_MS);
    map.set(key, {
      date: key,
      visits: 0,
      home_views: 0,
      join_views: 0,
      checkout_attempts: 0,
      checkout_departed: 0,
      join_errors: 0,
      confirmations: 0,
    });
  }
  return map;
}

// Funnel counts from site_events over [now-2*days, now]: current-period daily
// series plus previous-period totals for the KPI deltas.
//
// Page views are split by `page` so the homepage-to-join drop-off is visible.
// A single blended "visits" number cannot show where traffic is lost, because
// it sums the top of the funnel and the confirmation pages together.
async function funnelSection(days, now) {
  if (!supabaseConfigured()) return { configured: false };
  const currentStart = now - days * DAY_MS;
  const prevStart = now - 2 * days * DAY_MS;
  const since = new Date(prevStart).toISOString();
  const [funnelRows, errorRows, checkoutRows] = await Promise.all([
    supabaseSelect(
      `site_events?select=ts,event,page,referrer&event=in.(page_view,membership_checkout_complete)&ts=gte.${since}&order=ts.desc&limit=20000`
    ),
    supabaseSelect(
      `site_events?select=ts,event,error_code&event=eq.join_error&ts=gte.${since}&order=ts.desc&limit=20000`
    ),
    supabaseSelect(
      `site_events?select=ts,event,flow_id&event=in.(join_submit,join_checkout_ready,join_checkout_departed,join_checkout_fallback_clicked,join_checkout_stalled)&ts=gte.${since}&order=ts.desc&limit=20000`
    ),
  ]);
  const daily = emptyDailyMap(days, now);
  const blankTotals = () => ({
    visits: 0,
    home_views: 0,
    join_views: 0,
    confirmations: 0,
    join_errors: 0,
    join_submits: 0,
    checkout_ready: 0,
    checkout_departed: 0,
    checkout_fallback_clicks: 0,
    checkout_stalled: 0,
  });
  const totals = { ...blankTotals(), join_error_codes: Object.create(null) };
  const prev = blankTotals();
  const sources = Object.fromEntries(SOURCE_GROUPS.map((g) => [g, 0]));
  const join_entries = Object.fromEntries(JOIN_ENTRY_GROUPS.map((g) => [g, 0]));
  // Hourly submit/departure/error tallies, used to surface windows where the
  // checkout rejected every attempt. A daily roll-up hides those: a two-hour
  // total outage inside an otherwise normal day averages away to nothing.
  const hourly = new Map();
  const hourBucket = (ts) => {
    const key = hourKey(ts);
    let bucket = hourly.get(key);
    if (!bucket) {
      bucket = { hour: key, submits: 0, departed: 0, errors: 0, codes: Object.create(null) };
      hourly.set(key, bucket);
    }
    return bucket;
  };

  for (const row of errorRows) {
    const ts = Date.parse(row.ts);
    const code = JOIN_ERROR_CODES.has(row.error_code) ? row.error_code : 'unknown';
    if (ts >= currentStart) {
      totals.join_errors += 1;
      totals.join_error_codes[code] = (totals.join_error_codes[code] || 0) + 1;
      const bucket = daily.get(dayKey(ts));
      if (bucket) bucket.join_errors += 1;
      const hour = hourBucket(ts);
      hour.errors += 1;
      hour.codes[code] = (hour.codes[code] || 0) + 1;
    } else {
      prev.join_errors += 1;
    }
  }

  for (const row of funnelRows) {
    const ts = Date.parse(row.ts);
    const isCurrent = ts >= currentStart;
    const target = isCurrent ? totals : prev;
    const bucket = isCurrent ? daily.get(dayKey(ts)) : null;
    if (row.event === 'membership_checkout_complete') {
      target.confirmations += 1;
      if (bucket) bucket.confirmations += 1;
      continue;
    }
    if (row.event !== 'page_view') continue;
    target.visits += 1;
    if (bucket) bucket.visits += 1;
    if (row.page === PAGE_HOME) {
      target.home_views += 1;
      if (bucket) bucket.home_views += 1;
    } else if (row.page === PAGE_JOIN) {
      target.join_views += 1;
      if (bucket) bucket.join_views += 1;
      if (isCurrent) join_entries[joinEntryGroup(row.referrer)] += 1;
    }
    // Attribute only landing-page views: counting every page view would credit
    // a source once per page a visitor happens to open.
    if (isCurrent && (row.page === PAGE_HOME || row.page === PAGE_JOIN)) {
      sources[sourceGroup(row.referrer)] += 1;
    }
  }

  const checkoutField = {
    join_submit: 'join_submits',
    join_checkout_ready: 'checkout_ready',
    join_checkout_departed: 'checkout_departed',
    join_checkout_fallback_clicked: 'checkout_fallback_clicks',
    join_checkout_stalled: 'checkout_stalled',
  };
  const seen = new Set();
  for (const row of checkoutRows) {
    const key = checkoutField[row.event];
    if (!key) continue;
    const identity = `${row.event}:${row.flow_id || row.ts}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    const ts = Date.parse(row.ts);
    const isCurrent = ts >= currentStart;
    (isCurrent ? totals : prev)[key] += 1;
    if (!isCurrent) continue;
    const bucket = daily.get(dayKey(ts));
    if (row.event === 'join_submit') {
      if (bucket) bucket.checkout_attempts += 1;
      hourBucket(ts).submits += 1;
    } else if (row.event === 'join_checkout_departed') {
      if (bucket) bucket.checkout_departed += 1;
      hourBucket(ts).departed += 1;
    }
  }

  // A blocked window is an hour in which people tried to check out and not one
  // of them reached Stripe. Two attempts is the floor so a single abandoned
  // form does not read as an outage.
  const blocked_windows = [...hourly.values()]
    .filter((h) => h.submits >= 2 && h.departed === 0)
    .sort((a, b) => (a.hour < b.hour ? 1 : -1))
    .slice(0, 12)
    .map((h) => {
      const top = Object.entries(h.codes).sort((a, b) => b[1] - a[1])[0];
      return {
        hour: h.hour,
        submits: h.submits,
        errors: h.errors,
        top_error_code: top ? top[0] : null,
      };
    });

  // Only the homepage lane has a meaningful click-through rate. Cold arrivals
  // (flyer QR scans, typed URLs, ads pointed straight at /join) never saw the
  // homepage, so they are reported as an entrance rather than a drop-off.
  const cold_join_entries = totals.join_views - join_entries.from_site - join_entries.return;
  const steps = [
    { key: 'home', label: 'Homepage', count: totals.home_views, of: null },
    { key: 'join_from_home', label: 'Clicked through to Join', count: join_entries.from_site, of: 'home' },
    { key: 'join', label: 'Join page (all entrances)', count: totals.join_views, of: null },
    { key: 'submit', label: 'Form submitted', count: totals.join_submits, of: 'join' },
    { key: 'stripe', label: 'Reached Stripe', count: totals.checkout_departed, of: 'submit' },
    { key: 'complete', label: 'Completed', count: totals.confirmations, of: 'stripe' },
  ];

  return {
    configured: true,
    daily: [...daily.values()],
    totals,
    prev,
    steps,
    sources,
    join_entries,
    cold_join_entries,
    blocked_windows,
    truncated: funnelRows.length >= 20000 || errorRows.length >= 20000 || checkoutRows.length >= 20000,
  };
}

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function countOrNull(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function dimensionOrUnknown(value, allowed) {
  return allowed.has(value) ? value : 'unknown';
}

// Project the cross-repository RPC response onto the fields this dashboard is
// allowed to expose. Besides containing shape drift, this keeps unexpected
// identity fields from ever crossing the DPC-WEB API boundary.
function normalizeSubscriptionOverview(overview) {
  if (!isRecord(overview.totals)) {
    throw new Error('billing report is missing totals');
  }
  const totals = overview.totals;
  const paid = isRecord(overview.new_paid) ? overview.new_paid : {};
  const payment = isRecord(overview.payment_verification) ? overview.payment_verification : {};
  const dunning = isRecord(overview.dunning) ? overview.dunning : {};
  const attempts = isRecord(dunning.attempts) ? dunning.attempts : {};
  const access = isRecord(overview.access) ? overview.access : {};
  const renewals = isRecord(overview.renewals) ? overview.renewals : {};
  return {
    totals: {
      active: countOrNull(totals.active),
      past_due: countOrNull(totals.past_due),
      cancelled: countOrNull(totals.cancelled),
      paused: countOrNull(totals.paused),
      terminated: countOrNull(totals.terminated),
      unique_active_members: countOrNull(totals.unique_active_members),
    },
    new_paid: {
      h24: countOrNull(paid.h24),
      d7: countOrNull(paid.d7),
      d30: countOrNull(paid.d30),
    },
    by_circle: (Array.isArray(overview.by_circle) ? overview.by_circle : [])
      .filter(isRecord)
      .map((row) => ({
        circle: dimensionOrUnknown(row.circle, CIRCLES),
        interval: dimensionOrUnknown(row.interval, BILLING_INTERVALS),
        offer_type: dimensionOrUnknown(row.offer_type, OFFER_TYPES),
        count: countOrNull(row.count),
      })),
    payment_verification: {
      verified: countOrNull(payment.verified),
      missing: countOrNull(payment.missing),
    },
    dunning: {
      in_dunning: countOrNull(dunning.in_dunning),
      attempts: {
        zero: countOrNull(attempts.zero),
        one: countOrNull(attempts.one),
        two: countOrNull(attempts.two),
        three: countOrNull(attempts.three),
        four_plus: countOrNull(attempts.four_plus),
      },
      next_retry_24h: countOrNull(dunning.next_retry_24h),
      retry_overdue: countOrNull(dunning.retry_overdue),
      retries_exhausted: countOrNull(dunning.retries_exhausted),
      grace_expiring_7d: countOrNull(dunning.grace_expiring_7d),
    },
    access: {
      cancelled_with_access: countOrNull(access.cancelled_with_access),
      ending_7d: countOrNull(access.ending_7d),
    },
    renewals: { due_7d: countOrNull(renewals.due_7d) },
  };
}

async function subscriptionOverviewSection(now) {
  if (!supabaseConfigured()) return { configured: false };
  const overview = await supabaseRpc('ops_subscription_overview', {
    p_now: new Date(now).toISOString(),
  });
  if (!overview || typeof overview !== 'object' || Array.isArray(overview)) {
    throw new Error('billing report returned an invalid payload');
  }
  return normalizeSubscriptionOverview(overview);
}

// Webhook failures from both sides: our own error log, and Stripe's view of
// events it could not deliver (catches outages even when our logging is down).
async function alertsSection(stripe) {
  const [undelivered, webhookErrors] = await Promise.all([
    listUndeliveredEvents(stripe),
    supabaseConfigured()
      ? supabaseSelect('webhook_logs?select=ts,level,message,event_id,session_id&level=eq.error&order=ts.desc&limit=25')
      : Promise.resolve(null),
  ]);
  return { undelivered_events: undelivered, webhook_errors: webhookErrors };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'GET required' });
  }
  if (!process.env.DASHBOARD_TOKEN) {
    return res.status(503).json({ error: 'DASHBOARD_TOKEN not configured in Vercel' });
  }
  if (!authorized(req)) {
    return res.status(401).json({ error: 'Invalid dashboard token' });
  }
  if (!process.env.STRIPE_SECRET_KEY || !process.env.RESEND_API_KEY) {
    return res.status(503).json({ error: 'STRIPE_SECRET_KEY / RESEND_API_KEY not configured' });
  }

  const days = [7, 30, 90].includes(Number(req.query?.days)) ? Number(req.query.days) : 30;
  const now = Date.now();
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const resend = new Resend(process.env.RESEND_API_KEY);

  const [funnel, subscriptionOverview, alerts, health] = await Promise.allSettled([
    funnelSection(days, now),
    subscriptionOverviewSection(now),
    alertsSection(stripe),
    healthChecks(stripe, resend),
  ]);
  const unwrap = (settled, label) =>
    settled.status === 'fulfilled' ? settled.value : { error: `${label}: ${String(settled.reason?.message || settled.reason)}` };

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({
    generated_at: new Date(now).toISOString(),
    days,
    funnel: unwrap(funnel, 'funnel'),
    subscription_overview: unwrap(subscriptionOverview, 'subscription overview'),
    alerts: unwrap(alerts, 'alerts'),
    health: unwrap(health, 'health'),
  });
}
