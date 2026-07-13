// Scheduled health check (hourly Vercel cron, see vercel.json "crons").
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
} from './lib/ops-checks.js';

const UNDELIVERED_GRACE_MIN = 30;
const RECENT_ERROR_WINDOW_MIN = 75;
const THROTTLE_HOURS = 6;
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
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const resendKey = process.env.RESEND_API_KEY;

  const jobs = [];

  if (stripeKey && resendKey) {
    const stripe = new Stripe(stripeKey, { timeout: 5000 });
    const resend = new Resend(resendKey);

    jobs.push(
      healthChecks(stripe, resend).then((checks) => {
        for (const check of checks) {
          if (!check.ok) {
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
  }

  await Promise.allSettled(jobs);
  problems.sort((a, b) => (a.key < b.key ? -1 : 1));
  return problems;
}

function fingerprintOf(problems) {
  const keys = [...new Set(problems.map((p) => p.key))].sort();
  return createHash('sha256').update(keys.join('|')).digest('hex').slice(0, 16);
}

async function recentlyAlerted(now, fingerprint) {
  if (!supabaseConfigured()) return false;
  try {
    const sinceIso = new Date(now - THROTTLE_HOURS * 3600000).toISOString();
    const rows = await supabaseSelect(
      `webhook_logs?select=ts,detail&source=eq.health-check&level=eq.info&ts=gte.${sinceIso}&order=ts.desc&limit=10`
    );
    return rows.some((row) => row?.detail?.fingerprint === fingerprint);
  } catch {
    return false; // if the throttle store is down, prefer alerting to silence
  }
}

async function sendAlert(problems, now) {
  const resend = new Resend(process.env.RESEND_API_KEY);
  const items = problems.map((p) => `<li>${escapeHtml(p.text)}</li>`).join('');
  const result = await resend.emails.send({
    from: ALERT_FROM,
    to: ALERT_TO,
    subject: `⚠ DPC ops alert: ${problems.length} problem${problems.length === 1 ? '' : 's'} detected`,
    html: `
      <h2>DPC hourly health check found ${problems.length} problem${problems.length === 1 ? '' : 's'}</h2>
      <ul>${items}</ul>
      <p><a href="${DASHBOARD_URL}">Open the ops dashboard</a> for live status.
      Checked at ${escapeHtml(new Date(now).toISOString())}.</p>
      <p>You'll get at most one email every ${THROTTLE_HOURS} hours for this same set of problems;
      a different problem alerts immediately.</p>
    `,
  });
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
  const problems = await gatherProblems(now);
  const fingerprint = problems.length ? fingerprintOf(problems) : null;
  let alerted = false;
  let throttled = false;
  let alertError = '';

  if (problems.length) {
    console.error('health-check: problems detected', problems.map((p) => p.text));
    if (!process.env.RESEND_API_KEY) {
      alertError = 'cannot email: RESEND_API_KEY missing';
    } else if (await recentlyAlerted(now, fingerprint)) {
      throttled = true;
    } else {
      try {
        await sendAlert(problems, now);
        alerted = true;
        if (supabaseConfigured()) {
          try {
            await supabaseInsert('webhook_logs', {
              level: 'info',
              source: 'health-check',
              message: 'alert email sent',
              detail: { fingerprint, keys: problems.map((p) => p.key), problems: problems.map((p) => p.text) },
            });
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

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({
    ok: problems.length === 0,
    checked_at: new Date(now).toISOString(),
    problems: problems.map((p) => p.text),
    fingerprint,
    alerted,
    throttled,
    ...(alertError ? { alert_error: alertError } : {}),
  });
}
