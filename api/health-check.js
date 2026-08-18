// Scheduled health check (every five minutes; see vercel.json "crons").
// Runs the same live checks as the dashboard and EMAILS an alert when
// something is broken:
//   - a required env var is missing
//   - Stripe rejects the key for a capability the app needs, or it's test-mode
//   - Resend rejects its key
//   - Supabase is unreachable
//   - Stripe events undelivered for >30 min (webhook failing/misconfigured)
//   - webhook errors logged in the last 75 min
//
// Alerting is throttled per incident: the normalized problem set is hashed
// into a fingerprint, and a repeat of the SAME fingerprint within 6 hours
// stays quiet while a NEW problem set alerts immediately. Fingerprints are
// stored in webhook_logs (detail.fingerprint).
//
// Auth fails closed: without CRON_SECRET the endpoint returns 503 (matching
// Vercel's documented cron-auth pattern) — a misconfigured deploy must not
// expose ops detail or let strangers trigger provider calls / emails. Vercel
// sends `Authorization: Bearer $CRON_SECRET` on cron invocations; manual runs
// may use the dashboard token instead.
import Stripe from 'stripe';
import { Resend } from 'resend';
import { timingSafeEqual, createHash } from 'node:crypto';
import {
  supabaseConfigured,
  supabaseSelect,
  supabaseInsert,
  listUndeliveredEvents,
  healthChecks,
  withTimeout,
} from './lib/ops-checks.js';

const UNDELIVERED_GRACE_MIN = 30;
const RECENT_ERROR_WINDOW_MIN = 75;
const THROTTLE_HOURS = 6;
const CHECKOUT_SIGNAL_WINDOW_MIN = 10;
const CANARY_TIMEOUT_MS = 3000;
const JOIN_URL = 'https://www.downtownpourcollective.com/join';
const CHECKOUT_ENDPOINT = 'https://ebiuspbgzggrdiaswpcc.supabase.co/functions/v1/circle-checkout';
// End-to-end budget: gather is ~4s (bounded probes, concurrent). The alert
// path below gets 2s + 4s + 2s, keeping the worst case around 12s — inside
// the 30s function limit with ample margin to return the diagnostic response.
const THROTTLE_IO_TIMEOUT_MS = 2000;
const ALERT_SEND_TIMEOUT_MS = 4000;
const DASHBOARD_URL = 'https://www.downtownpourcollective.com/dashboard';
const ALERT_TO = (process.env.ALERT_TO || process.env.NOTIFY_DEPOSIT_TO || 'nick@downtownpourcollective.com,hello@downtownpourcollective.com')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const ALERT_FROM = process.env.ALERT_FROM || process.env.NOTIFY_DEPOSIT_FROM || 'Downtown Pour Collective <hello@downtownpourcollective.com>';

function tokenMatches(provided, expected) {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Problems are {key, text}: key is stable across runs (used for the incident
// fingerprint), text carries the human/run-specific detail for the email.
async function gatherProblems(now) {
  const problems = [];
  const warnings = [];
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const resendKey = process.env.RESEND_API_KEY;

  const jobs = [];

  // Non-transactional production canary: verify the live join bundle still
  // contains its native recovery path and the checkout function rejects bad
  // input. No valid challenge or member data is sent, so no Stripe Session or
  // checkout intent can be created.
  jobs.push((async () => {
    try {
      const fetchText = (url, options, label) => withTimeout(
        fetch(url, options).then(async (response) => ({ response, body: await response.text() })),
        CANARY_TIMEOUT_MS,
        label
      );
      const [joinProbe, optionsProbe, invalidProbe] = await Promise.all([
        fetchText(JOIN_URL, { headers: { 'cache-control': 'no-cache' } }, 'join page canary'),
        fetchText(CHECKOUT_ENDPOINT, { method: 'OPTIONS' }, 'checkout OPTIONS canary'),
        fetchText(CHECKOUT_ENDPOINT, {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: '{',
        }, 'checkout invalid-request canary'),
      ]);
      const joinRes = joinProbe.response;
      const markup = joinProbe.body;
      const markers = ['id="checkout-fallback"', '.btn[hidden]', 'join_checkout_stalled', 'window.location.assign'];
      if (!joinRes.ok || markers.some((marker) => !markup.includes(marker))) {
        problems.push({ key: 'checkout-canary:join', text: `Production checkout canary failed: join recovery markup is missing or unhealthy (HTTP ${joinRes.status})` });
      }
      const optionsRes = optionsProbe.response;
      const methods = optionsRes.headers.get('access-control-allow-methods') || '';
      if (!optionsRes.ok || !methods.includes('POST')) {
        problems.push({ key: 'checkout-canary:cors', text: `Production checkout canary failed: checkout CORS preflight is unhealthy (HTTP ${optionsRes.status})` });
      }
      const invalidRes = invalidProbe.response;
      const invalidBody = invalidProbe.body;
      if (invalidRes.status !== 400 || !invalidBody.includes('INVALID_REQUEST')) {
        problems.push({ key: 'checkout-canary:validation', text: `Production checkout canary failed: safe invalid request returned HTTP ${invalidRes.status}` });
      }
    } catch (err) {
      problems.push({ key: 'checkout-canary:unreachable', text: `Production checkout canary could not run: ${String(err?.message || err)}` });
    }
  })());

  if (stripeKey && resendKey) {
    const stripe = new Stripe(stripeKey, { timeout: 5000 });
    const resend = new Resend(resendKey);

    jobs.push(
      healthChecks(stripe, resend).then((checks) => {
        for (const check of checks) {
          if (!check.ok) {
            if (check.page === false) {
              console.warn('health-check: non-paging provider warning', check.name, check.detail);
              warnings.push({
                key: `check:${check.name}`,
                text: check.detail ? `${check.name} — ${check.detail}` : check.name,
              });
              continue;
            }
            problems.push({
              key: `check:${check.name}`,
              text: check.detail ? `${check.name} — ${check.detail}` : check.name,
            });
          }
        }
      }).catch((err) => {
        problems.push({ key: 'health-checks-failed', text: `Health checks could not run: ${String(err?.message || err)}` });
      })
    );

    jobs.push(
      listUndeliveredEvents(stripe, 50).then((undelivered) => {
        const graceCutoff = Math.floor(now / 1000) - UNDELIVERED_GRACE_MIN * 60;
        const stale = undelivered.filter((e) => e.created < graceCutoff);
        if (stale.length) {
          const oldest = stale[stale.length - 1];
          problems.push({
            key: 'undelivered_events',
            text: `${stale.length} Stripe event(s) undelivered for over ${UNDELIVERED_GRACE_MIN} minutes (oldest: ${oldest.type} ${oldest.id})`,
          });
        }
      }).catch((err) => {
        problems.push({ key: 'undelivered-list-failed', text: `Could not list Stripe events: ${String(err?.message || err)}` });
      })
    );
  } else {
    if (!stripeKey) problems.push({ key: 'env:STRIPE_SECRET_KEY', text: 'STRIPE_SECRET_KEY missing in Vercel' });
    if (!resendKey) problems.push({ key: 'env:RESEND_API_KEY', text: 'RESEND_API_KEY missing in Vercel' });
  }

  if (supabaseConfigured()) {
    const sinceIso = new Date(now - RECENT_ERROR_WINDOW_MIN * 60000).toISOString();
    jobs.push(
      supabaseSelect(`webhook_logs?select=ts,message&level=eq.error&ts=gte.${sinceIso}&order=ts.desc&limit=5`)
        .then((recentErrors) => {
          if (recentErrors.length) {
            problems.push({
              key: 'webhook_errors',
              text: `${recentErrors.length} webhook error(s) in the last ${RECENT_ERROR_WINDOW_MIN} minutes (latest: ${recentErrors[0].message})`,
            });
          }
        })
        // Supabase reachability is already covered by healthChecks; don't double-report.
        .catch((err) => console.error('health-check: webhook_logs query failed', err?.message || err))
    );
    const signalSince = new Date(now - CHECKOUT_SIGNAL_WINDOW_MIN * 60000).toISOString();
    jobs.push(
      supabaseSelect(`site_events?select=event,flow_id&event=eq.join_checkout_stalled&ts=gte.${signalSince}&order=ts.desc&limit=100`)
        .then((rows) => {
          const stalled = new Set(rows.filter((row) => row.event === 'join_checkout_stalled').map((row) => row.flow_id || JSON.stringify(row))).size;
          if (stalled) problems.push({ key: 'checkout_handoff_stalled', text: `${stalled} stalled checkout handoff(s) detected in the last ${CHECKOUT_SIGNAL_WINDOW_MIN} minutes` });
        })
        .catch((err) => console.error('health-check: checkout signal query failed', err?.message || err))
    );
  }

  await Promise.allSettled(jobs);
  problems.sort((a, b) => (a.key < b.key ? -1 : 1));
  warnings.sort((a, b) => (a.key < b.key ? -1 : 1));
  return { problems, warnings };
}

function fingerprintOf(problems) {
  const keys = [...new Set(problems.map((p) => p.key))].sort();
  return createHash('sha256').update(keys.join('|')).digest('hex').slice(0, 16);
}

async function recentlyAlerted(now, fingerprint) {
  if (!supabaseConfigured()) return false;
  try {
    const sinceIso = new Date(now - THROTTLE_HOURS * 3600000).toISOString();
    // Filter by fingerprint server-side so a burst of distinct incidents can
    // never push a still-active fingerprint out of the result window.
    const rows = await supabaseSelect(
      `webhook_logs?select=ts&source=eq.health-check&level=eq.info&detail->>fingerprint=eq.${fingerprint}&ts=gte.${sinceIso}&limit=1`,
      THROTTLE_IO_TIMEOUT_MS
    );
    return rows.length > 0;
  } catch {
    return false; // if the throttle store is down, prefer alerting to silence
  }
}

async function sendAlert(problems, now) {
  const resend = new Resend(process.env.RESEND_API_KEY);
  const items = problems.map((p) => `<li>${escapeHtml(p.text)}</li>`).join('');
  // Bounded: during a Resend outage this very request would otherwise hang
  // past the function deadline and the handler would never report anything.
  const result = await withTimeout(resend.emails.send({
    from: ALERT_FROM,
    to: ALERT_TO,
    subject: `⚠ DPC ops alert: ${problems.length} problem${problems.length === 1 ? '' : 's'} detected`,
    html: `
      <h2>DPC five-minute health check found ${problems.length} problem${problems.length === 1 ? '' : 's'}</h2>
      <ul>${items}</ul>
      <p><a href="${DASHBOARD_URL}">Open the ops dashboard</a> for live status.
      Checked at ${escapeHtml(new Date(now).toISOString())}.</p>
      <p>You'll get at most one email every ${THROTTLE_HOURS} hours for this same set of problems;
      a different problem alerts immediately.</p>
    `,
  }), ALERT_SEND_TIMEOUT_MS, 'resend.emails.send');
  if (result?.error) {
    throw new Error(`alert email failed: ${result.error.message || result.error.name || 'resend error'}`);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'GET required' });
  }
  // Fail closed: no secret, no service.
  if (!process.env.CRON_SECRET) {
    console.error('health-check: CRON_SECRET not configured — refusing to run');
    return res.status(503).json({ error: 'CRON_SECRET not configured in Vercel' });
  }
  const header = String(req.headers.authorization || '');
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!tokenMatches(bearer, process.env.CRON_SECRET) && !tokenMatches(bearer, process.env.DASHBOARD_TOKEN)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const now = Date.now();
  // Per-phase durations, logged and returned so the real timeout margin can
  // be watched in production as provider latency drifts.
  const timings = {};
  const timed = async (label, fn) => {
    const startedAt = Date.now();
    try {
      return await fn();
    } finally {
      timings[label] = Date.now() - startedAt;
    }
  };

  const { problems, warnings } = await timed('gather_ms', () => gatherProblems(now));
  const fingerprint = problems.length ? fingerprintOf(problems) : null;
  let alerted = false;
  let throttled = false;
  let alertError = '';
  const alertSuppressed = Boolean(process.env.VERCEL_ENV && process.env.VERCEL_ENV !== 'production');

  if (problems.length) {
    console.error('health-check: problems detected', problems.map((p) => p.text));
    // When the gather phase already established Supabase is down, skip the
    // throttle read/write entirely — they would only burn deadline budget.
    // Trade-off: during a Supabase outage the alert repeats every five minutes.
    const supabaseDown = problems.some((p) => p.key === 'check:Supabase reachable');
    if (alertSuppressed) {
      console.info('health-check: alert email suppressed outside production');
    } else if (!process.env.RESEND_API_KEY) {
      alertError = 'cannot email: RESEND_API_KEY missing';
    } else if (!supabaseDown && (await timed('throttle_read_ms', () => recentlyAlerted(now, fingerprint)))) {
      throttled = true;
    } else {
      try {
        await timed('alert_send_ms', () => sendAlert(problems, now));
        alerted = true;
        if (supabaseConfigured() && !supabaseDown) {
          try {
            await timed('alert_record_ms', () => supabaseInsert('webhook_logs', {
              level: 'info',
              source: 'health-check',
              message: 'alert email sent',
              detail: { fingerprint, keys: problems.map((p) => p.key), problems: problems.map((p) => p.text) },
            }, THROTTLE_IO_TIMEOUT_MS));
          } catch (err) {
            console.error('health-check: could not record alert (throttle may not apply)', err?.message || err);
          }
        }
      } catch (err) {
        alertError = String(err?.message || err);
        console.error('health-check: alert email failed', alertError);
      }
    }
  }

  timings.total_ms = Date.now() - now;
  console.info('health-check: timings', timings);

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({
    ok: problems.length === 0 && warnings.length === 0,
    checked_at: new Date(now).toISOString(),
    problems: problems.map((p) => p.text),
    warnings: warnings.map((warning) => warning.text),
    fingerprint,
    alerted,
    throttled,
    ...(alertSuppressed && problems.length ? { alert_suppressed: true } : {}),
    timings,
    ...(alertError ? { alert_error: alertError } : {}),
  });
}
