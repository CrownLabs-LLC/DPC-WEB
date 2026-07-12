// Data source for /dashboard. Token-protected (DASHBOARD_TOKEN env var,
// Bearer auth). Aggregates:
//   - site funnel (Supabase site_events, written by /api/track)
//   - live deposits (Stripe payment intents — ground truth for money)
//   - alerts (Supabase webhook_logs errors + Stripe undelivered events)
//   - health checks (env presence + live key validity for Stripe/Resend/Supabase)
// Sections degrade independently: a failing source reports itself instead of
// taking the whole dashboard down.
import Stripe from 'stripe';
import { Resend } from 'resend';
import { timingSafeEqual } from 'node:crypto';
import {
  supabaseConfigured,
  supabaseSelect,
  listUndeliveredEvents,
  healthChecks,
} from './lib/ops-checks.js';

const DEPOSIT_AMOUNT_CENTS = 4900;
const DAY_MS = 24 * 60 * 60 * 1000;
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
    map.set(key, { date: key, visits: 0, clicks: 0, confirmations: 0, deposits: 0 });
  }
  return map;
}

// Funnel counts from site_events over [now-2*days, now]: current-period daily
// series plus previous-period totals for the KPI deltas.
async function funnelSection(days, now) {
  if (!supabaseConfigured()) return { configured: false };
  const currentStart = now - days * DAY_MS;
  const prevStart = now - 2 * days * DAY_MS;
  const rows = await supabaseSelect(
    `site_events?select=ts,event&ts=gte.${new Date(prevStart).toISOString()}&order=ts.desc&limit=20000`
  );
  const daily = emptyDailyMap(days, now);
  const totals = { visits: 0, clicks: 0, confirmations: 0 };
  const prev = { visits: 0, clicks: 0, confirmations: 0 };
  const field = { page_view: 'visits', deposit_click: 'clicks', deposit_confirmed: 'confirmations' };
  for (const row of rows) {
    const key = field[row.event];
    if (!key) continue;
    const ts = Date.parse(row.ts);
    if (ts >= currentStart) {
      totals[key] += 1;
      const bucket = daily.get(dayKey(ts));
      if (bucket) bucket[key] += 1;
    } else {
      prev[key] += 1;
    }
  }
  return { configured: true, daily: [...daily.values()], totals, prev, truncated: rows.length >= 20000 };
}

// Deposits straight from Stripe — the money ground truth, independent of our
// own telemetry. Covers 2*days so KPI deltas compare like-for-like periods.
async function depositsSection(stripe, days, now) {
  const prevStartSec = Math.floor((now - 2 * days * DAY_MS) / 1000);
  const currentStartSec = Math.floor((now - days * DAY_MS) / 1000);
  const intents = [];
  const params = { created: { gte: prevStartSec }, limit: 100, expand: ['data.latest_charge'] };
  let page = await stripe.paymentIntents.list(params);
  intents.push(...page.data);
  let guard = 0;
  while (page.has_more && guard++ < 4) {
    page = await stripe.paymentIntents.list({ ...params, starting_after: intents[intents.length - 1].id });
    intents.push(...page.data);
  }

  const deposits = intents.filter(
    (pi) => pi.status === 'succeeded' && pi.currency === 'usd' && pi.amount === DEPOSIT_AMOUNT_CENTS
  );
  const daily = emptyDailyMap(days, now);
  let count = 0;
  let amountCents = 0;
  let prevCount = 0;
  const recent = [];
  for (const pi of deposits) {
    if (pi.created >= currentStartSec) {
      count += 1;
      amountCents += pi.amount;
      const bucket = daily.get(dayKey(pi.created * 1000));
      if (bucket) bucket.deposits += 1;
      recent.push({
        id: pi.id,
        created: pi.created,
        email: pi.latest_charge?.billing_details?.email || pi.receipt_email || '',
        name: pi.latest_charge?.billing_details?.name || '',
        amount_cents: pi.amount,
      });
    } else {
      prevCount += 1;
    }
  }
  recent.sort((a, b) => b.created - a.created);
  return {
    daily: [...daily.values()],
    count,
    amount_cents: amountCents,
    prev_count: prevCount,
    recent: recent.slice(0, 12),
  };
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

  const [funnel, deposits, alerts, health] = await Promise.allSettled([
    funnelSection(days, now),
    depositsSection(stripe, days, now),
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
    deposits: unwrap(deposits, 'deposits'),
    alerts: unwrap(alerts, 'alerts'),
    health: unwrap(health, 'health'),
  });
}
