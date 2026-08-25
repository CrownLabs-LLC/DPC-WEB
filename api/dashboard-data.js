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
    map.set(key, { date: key, visits: 0, checkout_attempts: 0, confirmations: 0 });
  }
  return map;
}

// Funnel counts from site_events over [now-2*days, now]: current-period daily
// series plus previous-period totals for the KPI deltas.
async function funnelSection(days, now) {
  if (!supabaseConfigured()) return { configured: false };
  const currentStart = now - days * DAY_MS;
  const prevStart = now - 2 * days * DAY_MS;
  const since = new Date(prevStart).toISOString();
  const [funnelRows, errorRows, checkoutRows] = await Promise.all([
    supabaseSelect(
      `site_events?select=ts,event&event=in.(page_view,membership_checkout_complete)&ts=gte.${since}&order=ts.desc&limit=20000`
    ),
    supabaseSelect(
      `site_events?select=ts,event,error_code&event=eq.join_error&ts=gte.${since}&order=ts.desc&limit=20000`
    ),
    supabaseSelect(
      `site_events?select=ts,event,flow_id&event=in.(join_submit,join_checkout_ready,join_checkout_departed,join_checkout_fallback_clicked,join_checkout_stalled)&ts=gte.${since}&order=ts.desc&limit=20000`
    ),
  ]);
  const rows = [...funnelRows, ...errorRows];
  const daily = emptyDailyMap(days, now);
  const totals = {
    visits: 0,
    confirmations: 0,
    join_errors: 0,
    join_error_codes: Object.create(null),
    join_submits: 0,
    checkout_ready: 0,
    checkout_departed: 0,
    checkout_fallback_clicks: 0,
    checkout_stalled: 0,
  };
  const prev = {
    visits: 0, confirmations: 0, join_errors: 0,
    join_submits: 0, checkout_ready: 0, checkout_departed: 0,
    checkout_fallback_clicks: 0, checkout_stalled: 0,
  };
  const field = { page_view: 'visits', membership_checkout_complete: 'confirmations' };
  for (const row of rows) {
    const ts = Date.parse(row.ts);
    if (row.event === 'join_error') {
      if (ts >= currentStart) {
        totals.join_errors += 1;
        const code = JOIN_ERROR_CODES.has(row.error_code) ? row.error_code : 'unknown';
        totals.join_error_codes[code] = (totals.join_error_codes[code] || 0) + 1;
      } else {
        prev.join_errors += 1;
      }
      continue;
    }
    const key = field[row.event];
    if (!key) continue;
    if (ts >= currentStart) {
      totals[key] += 1;
      const bucket = daily.get(dayKey(ts));
      if (bucket) bucket[key] += 1;
    } else {
      prev[key] += 1;
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
    const isCurrent = Date.parse(row.ts) >= currentStart;
    (isCurrent ? totals : prev)[key] += 1;
    if (isCurrent && row.event === 'join_submit') {
      const bucket = daily.get(dayKey(Date.parse(row.ts)));
      if (bucket) bucket.checkout_attempts += 1;
    }
  }
  return {
    configured: true,
    daily: [...daily.values()],
    totals,
    prev,
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
