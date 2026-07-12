// Scheduled health check (hourly Vercel cron, see vercel.json "crons").
// Runs the same live checks as the dashboard and EMAILS an alert when
// something is broken:
//   - a required env var is missing
//   - Stripe rejects the API key, or the key is test-mode
//   - Resend rejects its key
//   - Supabase is unreachable
//   - Stripe events undelivered for >30 min (webhook failing/misconfigured)
//   - webhook errors logged in the last 75 min
//
// Alert emails are throttled to one per 6 hours (tracked in webhook_logs) so
// an ongoing outage doesn't flood the inbox; the dashboard stays the live view.
//
// Auth: Vercel cron sends `Authorization: Bearer $CRON_SECRET` when the
// CRON_SECRET env var is set. Manual runs may use the dashboard token instead.
import Stripe from 'stripe';
import { Resend } from 'resend';
import { timingSafeEqual } from 'node:crypto';
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

function authorized(req) {
  const cronSecret = process.env.CRON_SECRET;
  // Without CRON_SECRET, Vercel's cron invokes with no auth header — allow,
  // but DEPLOY.md tells you to set it.
  if (!cronSecret) return true;
  const header = String(req.headers.authorization || '');
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';
  return tokenMatches(bearer, cronSecret) || tokenMatches(bearer, process.env.DASHBOARD_TOKEN);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function gatherProblems(now) {
  const problems = [];
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const resendKey = process.env.RESEND_API_KEY;

  if (stripeKey && resendKey) {
    const stripe = new Stripe(stripeKey);
    const resend = new Resend(resendKey);

    const checks = await healthChecks(stripe, resend);
    for (const check of checks) {
      if (!check.ok) problems.push(check.detail ? `${check.name} — ${check.detail}` : check.name);
    }

    try {
      const undelivered = await listUndeliveredEvents(stripe, 50);
      const graceCutoff = Math.floor(now / 1000) - UNDELIVERED_GRACE_MIN * 60;
      const stale = undelivered.filter((e) => e.created < graceCutoff);
      if (stale.length) {
        problems.push(
          `${stale.length} Stripe event(s) undelivered for over ${UNDELIVERED_GRACE_MIN} minutes (oldest: ${stale[stale.length - 1].type} ${stale[stale.length - 1].id})`
        );
      }
    } catch (err) {
      problems.push(`Could not list Stripe events: ${String(err?.message || err)}`);
    }
  } else {
    // healthChecks needs both clients; report the missing keys directly.
    if (!stripeKey) problems.push('STRIPE_SECRET_KEY missing in Vercel');
    if (!resendKey) problems.push('RESEND_API_KEY missing in Vercel');
  }

  if (supabaseConfigured()) {
    try {
      const sinceIso = new Date(now - RECENT_ERROR_WINDOW_MIN * 60000).toISOString();
      const recentErrors = await supabaseSelect(
        `webhook_logs?select=ts,message&level=eq.error&ts=gte.${sinceIso}&order=ts.desc&limit=5`
      );
      if (recentErrors.length) {
        problems.push(
          `${recentErrors.length} webhook error(s) in the last ${RECENT_ERROR_WINDOW_MIN} minutes (latest: ${recentErrors[0].message})`
        );
      }
    } catch (err) {
      // Supabase reachability is already covered by healthChecks; don't double-report.
      console.error('health-check: webhook_logs query failed', err?.message || err);
    }
  }

  return problems;
}

async function recentlyAlerted(now) {
  if (!supabaseConfigured()) return false;
  try {
    const sinceIso = new Date(now - THROTTLE_HOURS * 3600000).toISOString();
    const rows = await supabaseSelect(
      `webhook_logs?select=ts&source=eq.health-check&level=eq.info&ts=gte.${sinceIso}&limit=1`
    );
    return rows.length > 0;
  } catch {
    return false; // if the throttle store is down, prefer alerting to silence
  }
}

async function sendAlert(problems, now) {
  const resend = new Resend(process.env.RESEND_API_KEY);
  const items = problems.map((p) => `<li>${escapeHtml(p)}</li>`).join('');
  const result = await resend.emails.send({
    from: ALERT_FROM,
    to: ALERT_TO,
    subject: `⚠ DPC ops alert: ${problems.length} problem${problems.length === 1 ? '' : 's'} detected`,
    html: `
      <h2>DPC hourly health check found ${problems.length} problem${problems.length === 1 ? '' : 's'}</h2>
      <ul>${items}</ul>
      <p><a href="${DASHBOARD_URL}">Open the ops dashboard</a> for live status.
      Checked at ${escapeHtml(new Date(now).toISOString())}.</p>
      <p>You'll get at most one of these every ${THROTTLE_HOURS} hours while the problem persists.</p>
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
  if (!authorized(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const now = Date.now();
  const problems = await gatherProblems(now);
  let alerted = false;
  let throttled = false;
  let alertError = '';

  if (problems.length) {
    console.error('health-check: problems detected', problems);
    if (!process.env.RESEND_API_KEY) {
      alertError = 'cannot email: RESEND_API_KEY missing';
    } else if (await recentlyAlerted(now)) {
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
              detail: { problems },
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
    problems,
    alerted,
    throttled,
    ...(alertError ? { alert_error: alertError } : {}),
  });
}
