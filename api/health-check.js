// Scheduled health check (every five minutes; see vercel.json "crons").
// Runs the same live checks as the dashboard and EMAILS an alert when
// something is broken:
//   - a required env var is missing
//   - Stripe rejects the key for a capability the app needs, or it's test-mode
//   - Resend rejects its key
//   - Supabase is unreachable
//   - Stripe events undelivered for >30 min (webhook failing/misconfigured)
//   - webhook errors logged in the last 75 min
//   - the latest production observation is at least 15 minutes old
//
// Alerting is throttled per incident: the normalized problem set is hashed
// into a fingerprint. SEV-0 repeats after 30 minutes; SEV-1 retains the
// six-hour window. A new problem set alerts immediately. Fingerprints are
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
const SEV0_REMINDER_MIN = 30;
const CHECKOUT_SIGNAL_WINDOW_MIN = 10;
const OBSERVATION_STALE_MIN = 15;
const CANARY_TIMEOUT_MS = 3000;
const JOIN_URL = 'https://www.downtownpourcollective.com/join';
// Probed with ?fresh=1 so the check exercises the live RPC rather than a CDN
// hit: a cached 200 would keep reporting healthy through a grant regression
// or a missing singleton. /join and /depositor-confirmation block checkout
// entirely when this endpoint is down, so it is a checkout-critical surface.
const LEGAL_VERSIONS_URL = 'https://www.downtownpourcollective.com/api/legal-versions?fresh=1';
const LEGAL_VERSION_KEYS = ['tos', 'privacy', 'memberTerms', 'autoRenewalTerms'];
const CHECKOUT_ENDPOINT = 'https://ebiuspbgzggrdiaswpcc.supabase.co/functions/v1/circle-checkout';
// End-to-end budget: gather is ~4s (bounded probes, concurrent). The alert
// path below gets 2s + 2s + 4s + 2s. The worst case is around 14s, inside the
// 30s function limit with ample margin to return the diagnostic response.
const THROTTLE_IO_TIMEOUT_MS = 2000;
const ALERT_SEND_TIMEOUT_MS = 4000;
const DASHBOARD_URL = 'https://www.downtownpourcollective.com/dashboard';
const DEFAULT_ALERT_FROM =
  'Downtown Pour Collective Operations <support@downtownpourcollective.com>';
const PROHIBITED_OPS_ADDRESSES = new Set([
  'hello@downtownpourcollective.com',
  'nick@downtownpourcollective.com',
]);
const SENSITIVE_STRIPE_EVENT_TYPES = new Set([
  'checkout.session.completed',
  'checkout.session.async_payment_failed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.payment_failed',
  'invoice.paid',
  'charge.refunded',
  'charge.dispute.created',
]);
const POLICY = Object.freeze({
  'legal-versions:unavailable': {
    severity: 'SEV-1', capability: 'CHECKOUT',
    title: 'Checkout legal terms are unavailable',
    action: 'Check the legal-versions endpoint',
  },
  'legal-versions:incomplete': {
    severity: 'SEV-0', capability: 'CHECKOUT',
    title: 'Checkout legal terms are incomplete',
    action: 'Restore the complete legal-version tuple',
  },
  'legal-versions:unreachable': {
    severity: 'SEV-1', capability: 'CHECKOUT',
    title: 'Checkout legal terms could not be verified',
    action: 'Check the site and legal-versions endpoint',
  },
  'checkout-canary:join': {
    severity: 'SEV-1', capability: 'CHECKOUT',
    title: 'Checkout recovery path is unhealthy',
    action: 'Inspect the production join page',
  },
  'checkout-canary:cors': {
    severity: 'SEV-0', capability: 'CHECKOUT',
    title: 'Checkout CORS contract is broken',
    action: 'Restore the checkout preflight response',
  },
  'checkout-canary:validation': {
    severity: 'SEV-0', capability: 'CHECKOUT',
    title: 'Checkout validation contract is broken',
    action: 'Inspect the checkout edge function',
  },
  'checkout-canary:unreachable': {
    severity: 'SEV-1', capability: 'CHECKOUT',
    title: 'Checkout canary could not complete',
    action: 'Check the site and checkout function',
  },
  'check:Stripe secret key set': {
    severity: 'SEV-0', capability: 'BILLING',
    title: 'Stripe secret key is missing',
    action: 'Restore the production Stripe key',
  },
  'check:Stripe webhook secret set': {
    severity: 'SEV-0', capability: 'BILLING',
    title: 'Stripe webhook secret is missing',
    action: 'Restore the production webhook secret',
  },
  'check:Resend API key set': {
    severity: 'SEV-1', capability: 'EMAIL',
    title: 'Resend API key is missing',
    action: 'Restore the production Resend key',
  },
  'check:Resend founding audience ID set': {
    severity: 'SEV-2', capability: 'EMAIL',
    title: 'Founding audience configuration is missing',
    action: 'Restore the Resend audience ID',
  },
  'check:Supabase URL set': {
    severity: 'SEV-1', capability: 'DATA',
    title: 'Supabase URL is missing',
    action: 'Restore the production Supabase URL',
  },
  'check:Supabase anon key set': {
    severity: 'SEV-1', capability: 'DATA',
    title: 'Supabase public key is missing',
    action: 'Restore the production Supabase public key',
  },
  'check:Supabase service role key set': {
    severity: 'SEV-1', capability: 'DATA',
    title: 'Supabase service key is missing',
    action: 'Restore the production Supabase service key',
  },
  'check:Stripe key is live mode': {
    severity: 'SEV-0', capability: 'BILLING',
    title: 'Stripe is not using a live-mode key',
    action: 'Restore the production Stripe key',
  },
  'check:Stripe key can read checkout sessions': {
    severity: 'SEV-0', capability: 'BILLING',
    title: 'Stripe checkout access is rejected',
    action: 'Restore the required Stripe key permission',
  },
  'check:Stripe key can read subscriptions': {
    severity: 'SEV-0', capability: 'BILLING',
    title: 'Stripe subscription access is rejected',
    action: 'Restore the required Stripe key permission',
  },
  'check:Stripe key can read events': {
    severity: 'SEV-0', capability: 'BILLING',
    title: 'Stripe event access is rejected',
    action: 'Restore the required Stripe key permission',
  },
  'check:Resend key accepted by Resend': {
    severity: 'SEV-1', capability: 'EMAIL',
    title: 'Resend credentials are rejected',
    action: 'Restore a valid production Resend key',
  },
  'check:Supabase reachable': {
    severity: 'SEV-0', capability: 'DATA',
    title: 'Supabase is unreachable',
    action: 'Check Supabase production availability',
  },
  'health-checks-failed': {
    severity: 'SEV-1', capability: 'MONITORING',
    title: 'Provider checks could not complete',
    action: 'Inspect the health-check runtime',
  },
  undelivered_events: {
    severity: 'SEV-2', capability: 'BILLING',
    title: 'Stripe events are undelivered',
    action: 'Inspect Stripe webhook delivery',
  },
  'undelivered-list-failed': {
    severity: 'SEV-2', capability: 'MONITORING',
    title: 'Stripe delivery status is unknown',
    action: 'Check Stripe event visibility',
  },
  webhook_errors: {
    severity: 'SEV-1', capability: 'BILLING',
    title: 'Stripe webhook errors are active',
    action: 'Inspect the webhook error dashboard',
  },
  checkout_handoff_stalled: {
    severity: 'SEV-2', capability: 'CHECKOUT',
    title: 'Checkout handoffs are stalling',
    action: 'Inspect checkout handoff telemetry',
  },
  'env:STRIPE_SECRET_KEY': {
    severity: 'SEV-0', capability: 'BILLING',
    title: 'Stripe secret key is missing',
    action: 'Restore the production Stripe key',
  },
  'env:RESEND_API_KEY': {
    severity: 'SEV-1', capability: 'EMAIL',
    title: 'Resend API key is missing',
    action: 'Restore the production Resend key',
  },
  'env:ALERT_TO': {
    severity: 'SEV-0', capability: 'MONITORING',
    title: 'Operations recipient is invalid',
    action: 'Restore the direct operations recipient',
  },
  'env:ALERT_FROM': {
    severity: 'SEV-1', capability: 'MONITORING',
    title: 'Operations sender is invalid',
    action: 'Restore the verified operations sender',
  },
  'env:ALERT_REPLY_TO': {
    severity: 'SEV-1', capability: 'MONITORING',
    title: 'Operations reply-to is invalid',
    action: 'Restore the direct operations reply-to',
  },
  'env:VERCEL_ENV': {
    severity: 'SEV-1', capability: 'MONITORING',
    title: 'Runtime environment is ambiguous',
    action: 'Restore the Vercel environment identity',
  },
  'monitoring:observation-append': {
    severity: 'SEV-1', capability: 'MONITORING',
    title: 'Health evidence could not be recorded',
    action: 'Check the observation store',
  },
  'monitoring:observation-stale': {
    severity: 'SEV-1', capability: 'MONITORING',
    title: 'Health evidence is stale',
    action: 'Check health-check observation writes',
  },
});
const DEFAULT_POLICY = Object.freeze({
  severity: 'SEV-1',
  capability: 'MONITORING',
  title: 'An operations check is unhealthy',
  action: 'Open the operations dashboard',
});
const EMAIL_ATOM_CHARS = "a-z0-9!#$%&'*+/=?^_`{|}~-";
const EMAIL_LOCAL_PATTERN =
  `[${EMAIL_ATOM_CHARS}]+(?:\\.[${EMAIL_ATOM_CHARS}]+)*`;
const DOMAIN_LABEL_PATTERN = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
const BARE_EMAIL_PATTERN = new RegExp(
  `^${EMAIL_LOCAL_PATTERN}@${DOMAIN_LABEL_PATTERN}` +
    `(?:\\.${DOMAIN_LABEL_PATTERN})+\\.?$`,
  'i',
);

function addressesIn(value) {
  return String(value).toLowerCase().match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+/g) || [];
}

function canonicalOpsAddress(address) {
  const [localPart, domain] = String(address).toLowerCase().split('@');
  const normalizedDomain = domain?.replace(/\.$/, '');
  if (!localPart || normalizedDomain !== 'downtownpourcollective.com') {
    return String(address).toLowerCase();
  }
  const normalizedLocal = localPart.split('+', 1)[0].replaceAll('.', '');
  return `${normalizedLocal}@${normalizedDomain}`;
}

function isBareMailbox(value) {
  return BARE_EMAIL_PATTERN.test(String(value).trim());
}

function isSenderIdentity(value) {
  const sender = String(value).trim();
  if (isBareMailbox(sender)) return true;
  const formatted = /^[^<>\r\n]+\s*<([^<>\r\n]+)>$/.exec(sender);
  return Boolean(formatted && isBareMailbox(formatted[1]));
}

function readAlertConfiguration(env = process.env) {
  const config = {
    to: (env.ALERT_TO || '').split(',').map((s) => s.trim()).filter(Boolean),
    from: String(env.ALERT_FROM || '').trim(),
    replyTo: String(env.ALERT_REPLY_TO || '').trim(),
  };
  const fields = [
    ['ALERT_TO', config.to, () => config.to.every(isBareMailbox)],
    ['ALERT_FROM', config.from, () => isSenderIdentity(config.from)],
    ['ALERT_REPLY_TO', config.replyTo, () => isBareMailbox(config.replyTo)],
  ];
  const issues = [];
  for (const [name, value, isValid] of fields) {
    if (!value || value.length === 0) {
      issues.push({ name, reason: 'missing in Vercel' });
    } else if (!isValid()) {
      issues.push({ name, reason: 'is invalid' });
    } else if (addressesIn(value).some((address) =>
      PROHIBITED_OPS_ADDRESSES.has(canonicalOpsAddress(address)))) {
      issues.push({ name, reason: 'contains a prohibited operational identity' });
    }
  }
  const invalidFields = new Set(issues.map((issue) => issue.name));
  return {
    ...config,
    from: invalidFields.has('ALERT_FROM') ? DEFAULT_ALERT_FROM : config.from,
    replyTo: invalidFields.has('ALERT_REPLY_TO') ? '' : config.replyTo,
    issues,
  };
}

function tokenMatches(provided, expected) {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function policyFor(key, severity) {
  return {
    ...(POLICY[key] || DEFAULT_POLICY),
    ...(severity ? { severity } : {}),
  };
}

function publicObservations(states) {
  const keys = new Set([...Object.keys(POLICY), ...states.keys()]);
  return [...keys].sort().map((key) => {
    const observed = states.get(key) || {};
    return {
      key,
      severity: observed.severity || policyFor(key).severity,
      state: observed.state || 'unknown',
    };
  });
}

// Diagnostic text remains available in the authenticated JSON response. It is
// deliberately excluded from notifications and durable observation evidence.
async function gatherProblems(
  now,
  { checkObservationFreshness = false } = {},
) {
  const problems = [];
  const warnings = [];
  const states = new Map();
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const resendKey = process.env.RESEND_API_KEY;
  const observe = (key, state, severity) => {
    states.set(key, { state, ...(severity ? { severity } : {}) });
  };
  const add = (target, key, text, options = {}) => {
    const state = options.state || 'unhealthy';
    observe(key, state, options.severity);
    target.push({ key, text, severity: options.severity, state });
  };

  observe(
    'env:STRIPE_SECRET_KEY',
    stripeKey ? 'healthy' : 'unhealthy',
  );
  observe(
    'env:RESEND_API_KEY',
    resendKey ? 'healthy' : 'unhealthy',
  );

  const jobs = [];

  // Checkout blocks when the live legal-version tuple cannot be read, so probe
  // the endpoint itself — including the shape, since a structurally incomplete
  // 200 fails checkout exactly as hard as a 503 does.
  jobs.push((async () => {
    try {
      const { response, body } = await withTimeout(
        fetch(LEGAL_VERSIONS_URL, { headers: { accept: 'application/json' } })
          .then(async (res) => ({ response: res, body: await res.text() })),
        CANARY_TIMEOUT_MS,
        'legal-versions canary'
      );
      if (!response.ok) {
        add(
          problems,
          'legal-versions:unavailable',
          `/api/legal-versions is unhealthy (HTTP ${response.status}) — ` +
            'join and depositor checkout are blocked',
        );
        observe('legal-versions:incomplete', 'unknown');
        observe('legal-versions:unreachable', 'healthy');
        return;
      }
      observe('legal-versions:unavailable', 'healthy');
      observe('legal-versions:unreachable', 'healthy');
      let tuple = null;
      try { tuple = JSON.parse(body); } catch { /* handled as incomplete below */ }
      const missing = LEGAL_VERSION_KEYS.filter((key) =>
        typeof tuple?.[key] !== 'string' || !tuple[key]);
      if (missing.length) {
        add(
          problems,
          'legal-versions:incomplete',
          `/api/legal-versions returned an incomplete tuple ` +
            `(missing: ${missing.join(', ')})`,
        );
      } else {
        observe('legal-versions:incomplete', 'healthy');
      }
    } catch (err) {
      observe('legal-versions:unavailable', 'unknown');
      observe('legal-versions:incomplete', 'unknown');
      add(
        problems,
        'legal-versions:unreachable',
        `/api/legal-versions could not be probed: ` +
          String(err?.message || err),
        { state: 'unknown' },
      );
    }
  })());

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
        add(
          problems,
          'checkout-canary:join',
          'Production checkout canary failed: join recovery markup is ' +
            `missing or unhealthy (HTTP ${joinRes.status})`,
        );
      } else {
        observe('checkout-canary:join', 'healthy');
      }
      const optionsRes = optionsProbe.response;
      const methods = optionsRes.headers.get('access-control-allow-methods') || '';
      if (!optionsRes.ok || !methods.includes('POST')) {
        add(
          problems,
          'checkout-canary:cors',
          'Production checkout canary failed: checkout CORS preflight is ' +
            `unhealthy (HTTP ${optionsRes.status})`,
        );
      } else {
        observe('checkout-canary:cors', 'healthy');
      }
      const invalidRes = invalidProbe.response;
      const invalidBody = invalidProbe.body;
      if (invalidRes.status !== 400 || !invalidBody.includes('INVALID_REQUEST')) {
        add(
          problems,
          'checkout-canary:validation',
          'Production checkout canary failed: safe invalid request returned ' +
            `HTTP ${invalidRes.status}`,
        );
      } else {
        observe('checkout-canary:validation', 'healthy');
      }
      observe('checkout-canary:unreachable', 'healthy');
    } catch (err) {
      observe('checkout-canary:join', 'unknown');
      observe('checkout-canary:cors', 'unknown');
      observe('checkout-canary:validation', 'unknown');
      add(
        problems,
        'checkout-canary:unreachable',
        `Production checkout canary could not run: ` +
          String(err?.message || err),
        { state: 'unknown' },
      );
    }
  })());

  if (stripeKey && resendKey) {
    const stripe = new Stripe(stripeKey, { timeout: 5000 });
    const resend = new Resend(resendKey);

    jobs.push(
      healthChecks(stripe, resend).then((checks) => {
        observe('health-checks-failed', 'healthy');
        for (const check of checks) {
          const key = `check:${check.name}`;
          observe(key, check.ok ? 'healthy' : 'unhealthy');
          if (!check.ok) {
            const severity = check.page === false
              ? 'SEV-2'
              : policyFor(key).severity;
            if (severity === 'SEV-2') {
              console.warn(
                'health-check: non-paging provider warning',
                check.name,
                check.detail,
              );
              add(
                warnings,
                key,
                check.detail ? `${check.name} — ${check.detail}` : check.name,
                { severity },
              );
              continue;
            }
            add(
              problems,
              key,
              check.detail ? `${check.name} — ${check.detail}` : check.name,
            );
          }
        }
      }).catch((err) => {
        add(
          problems,
          'health-checks-failed',
          `Health checks could not run: ${String(err?.message || err)}`,
          { state: 'unknown' },
        );
      })
    );

    jobs.push(
      listUndeliveredEvents(stripe, 50).then((undelivered) => {
        const graceCutoff = Math.floor(now / 1000) - UNDELIVERED_GRACE_MIN * 60;
        const stale = undelivered.filter((e) => e.created < graceCutoff);
        observe('undelivered-list-failed', 'healthy');
        if (stale.length) {
          const oldest = stale[stale.length - 1];
          const sensitive = stale.some((event) =>
            SENSITIVE_STRIPE_EVENT_TYPES.has(event.type));
          const target = sensitive ? problems : warnings;
          add(
            target,
            'undelivered_events',
            `${stale.length} Stripe event(s) undelivered for over ` +
              `${UNDELIVERED_GRACE_MIN} minutes ` +
              `(oldest: ${oldest.type} ${oldest.id})`,
            { severity: sensitive ? 'SEV-0' : 'SEV-2' },
          );
        } else {
          observe('undelivered_events', 'healthy');
        }
      }).catch((err) => {
        observe('undelivered_events', 'unknown');
        add(
          warnings,
          'undelivered-list-failed',
          `Could not list Stripe events: ${String(err?.message || err)}`,
          { state: 'unknown' },
        );
      })
    );
  } else {
    if (!stripeKey) {
      add(
        problems,
        'env:STRIPE_SECRET_KEY',
        'STRIPE_SECRET_KEY missing in Vercel',
      );
    }
    if (!resendKey) {
      add(
        problems,
        'env:RESEND_API_KEY',
        'RESEND_API_KEY missing in Vercel',
      );
    }
  }

  if (supabaseConfigured()) {
    if (checkObservationFreshness) {
      jobs.push(
        supabaseSelect(
          'webhook_logs?select=ts' +
            '&source=eq.health-check-observation' +
            '&level=eq.info' +
            '&order=ts.desc&limit=1',
        )
          .then((rows) => {
            const latestAt = Date.parse(rows[0]?.ts || '');
            if (!rows.length || !Number.isFinite(latestAt)) {
              add(
                warnings,
                'monitoring:observation-stale',
                'Observation freshness is unknown: no prior evidence row',
                { state: 'unknown', severity: 'SEV-2' },
              );
              return;
            }
            const ageMs = now - latestAt;
            if (ageMs >= OBSERVATION_STALE_MIN * 60000) {
              add(
                problems,
                'monitoring:observation-stale',
                `Latest health observation is ${Math.floor(ageMs / 60000)} ` +
                  'minutes old',
              );
            } else {
              observe('monitoring:observation-stale', 'healthy');
            }
          })
          .catch((err) => {
            add(
              warnings,
              'monitoring:observation-stale',
              'Observation freshness is unknown: ' +
                String(err?.message || err),
              { state: 'unknown', severity: 'SEV-2' },
            );
          }),
      );
    }
    const sinceIso = new Date(now - RECENT_ERROR_WINDOW_MIN * 60000).toISOString();
    jobs.push(
      // Reviewed source allowlist: any new webhook_logs error writer must be
      // added here, in the dashboard query, and in the contract tests.
      supabaseSelect(
        'webhook_logs?select=ts,message&level=eq.error' +
          `&source=eq.stripe-webhook&ts=gte.${sinceIso}` +
          '&order=ts.desc&limit=5',
      )
        .then((recentErrors) => {
          if (recentErrors.length) {
            add(
              problems,
              'webhook_errors',
              `${recentErrors.length} webhook error(s) in the last ` +
                `${RECENT_ERROR_WINDOW_MIN} minutes ` +
                `(latest: ${recentErrors[0].message})`,
            );
          } else {
            observe('webhook_errors', 'healthy');
          }
        })
        .catch((err) => {
          add(
            warnings,
            'webhook_errors',
            `Webhook error status is unknown: ${String(err?.message || err)}`,
            { state: 'unknown', severity: 'SEV-2' },
          );
        })
    );
    const signalSince = new Date(now - CHECKOUT_SIGNAL_WINDOW_MIN * 60000).toISOString();
    jobs.push(
      supabaseSelect(`site_events?select=event,flow_id&event=eq.join_checkout_stalled&ts=gte.${signalSince}&order=ts.desc&limit=100`)
        .then((rows) => {
          const stalled = new Set(rows
            .filter((row) => row.event === 'join_checkout_stalled')
            .map((row) => row.flow_id || JSON.stringify(row))).size;
          if (stalled) {
            const severity = stalled > 1 ? 'SEV-1' : 'SEV-2';
            add(
              stalled > 1 ? problems : warnings,
              'checkout_handoff_stalled',
              `${stalled} stalled checkout handoff(s) detected in the last ` +
                `${CHECKOUT_SIGNAL_WINDOW_MIN} minutes`,
              { severity },
            );
          } else {
            observe('checkout_handoff_stalled', 'healthy');
          }
        })
        .catch((err) => {
          add(
            warnings,
            'checkout_handoff_stalled',
            'Checkout handoff status is unknown: ' +
              String(err?.message || err),
            { state: 'unknown', severity: 'SEV-2' },
          );
        })
    );
  }

  await Promise.allSettled(jobs);
  problems.sort((a, b) => (a.key < b.key ? -1 : 1));
  warnings.sort((a, b) => (a.key < b.key ? -1 : 1));
  return { problems, warnings, states };
}

function fingerprintOf(problems) {
  const keys = [...new Set(problems.map((p) => p.key))].sort();
  return createHash('sha256').update(keys.join('|')).digest('hex').slice(0, 16);
}

function highestSeverity(items) {
  return items.reduce(
    (highest, item) => {
      const severity = policyFor(item.key, item.severity).severity;
      return severity < highest ? severity : highest;
    },
    'SEV-2',
  );
}

async function recentlyAlerted(now, fingerprint, severity) {
  if (!supabaseConfigured()) return false;
  try {
    const windowMs = severity === 'SEV-0'
      ? SEV0_REMINDER_MIN * 60000
      : THROTTLE_HOURS * 3600000;
    const sinceIso = new Date(now - windowMs).toISOString();
    // Filter by fingerprint server-side so a burst of distinct incidents can
    // never push a still-active fingerprint out of the result window.
    const rows = await supabaseSelect(
      'webhook_logs?select=ts&source=eq.health-check&level=eq.info' +
        `&detail->>fingerprint=eq.${fingerprint}` +
        `&ts=gte.${sinceIso}&limit=1`,
      THROTTLE_IO_TIMEOUT_MS,
    );
    return rows.length > 0;
  } catch {
    return false; // if the throttle store is down, prefer alerting to silence
  }
}

async function sendAlert(
  problems,
  now,
  alertConfig,
  environmentLabel,
) {
  const resend = new Resend(process.env.RESEND_API_KEY);
  const ordered = [...problems].sort((a, b) => {
    const aSeverity = policyFor(a.key, a.severity).severity;
    const bSeverity = policyFor(b.key, b.severity).severity;
    return aSeverity.localeCompare(bSeverity) || a.key.localeCompare(b.key);
  });
  const lead = policyFor(ordered[0].key, ordered[0].severity);
  const additional = ordered.length > 1
    ? ` + ${ordered.length - 1} additional finding` +
      (ordered.length === 2 ? '' : 's')
    : '';
  const groups = ['SEV-0', 'SEV-1', 'SEV-2'].map((severity) => {
    const items = ordered
      .filter((problem) =>
        policyFor(problem.key, problem.severity).severity === severity)
      .map((problem) => {
        const policy = policyFor(problem.key, problem.severity);
        return '<li><strong>' + escapeHtml(policy.title) + '</strong> — ' +
          escapeHtml(policy.action) + '</li>';
      })
      .join('');
    return items
      ? `<h3>${escapeHtml(severity)}</h3><ul>${items}</ul>`
      : '';
  }).join('');
  const email = {
    from: alertConfig.from,
    to: alertConfig.to,
    subject: `[${lead.severity}][${environmentLabel}][${lead.capability}] ` +
      `${lead.title} — ${lead.action}${additional}`,
    html: `
      <h2>DPC operations alert</h2>
      ${groups}
      <p><a href="${DASHBOARD_URL}">Open the ops dashboard</a> for live status.
      Checked at ${escapeHtml(new Date(now).toISOString())}.</p>
      <p>SEV-0 incidents remind every ${SEV0_REMINDER_MIN} minutes;
      other active incidents retain the ${THROTTLE_HOURS}-hour window.</p>
    `,
  };
  if (alertConfig.replyTo) email.replyTo = alertConfig.replyTo;
  // Bounded: during a Resend outage this very request would otherwise hang
  // past the function deadline and the handler would never report anything.
  const result = await withTimeout(
    resend.emails.send(email),
    ALERT_SEND_TIMEOUT_MS,
    'resend.emails.send',
  );
  if (result?.error) {
    throw new Error(
      `alert email failed: ` +
        (result.error.message || result.error.name || 'resend error'),
    );
  }
}

function integerTimings(timings) {
  return Object.fromEntries(
    Object.entries(timings).map(([key, value]) => [key, Math.round(value)]),
  );
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
  const runtimeEnvironment = process.env.VERCEL_ENV;
  const alertSuppressed = ['preview', 'development']
    .includes(runtimeEnvironment);
  const productionRun = runtimeEnvironment === 'production';
  const alertConfig = readAlertConfiguration();
  const alertConfigIssues = alertSuppressed ? [] : alertConfig.issues;
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

  const gathered = await timed(
    'gather_ms',
    () => gatherProblems(now, {
      checkObservationFreshness: productionRun,
    }),
  );
  const { problems, warnings, states } = gathered;
  if (productionRun || alertSuppressed) {
    states.set('env:VERCEL_ENV', { state: 'healthy' });
  } else {
    states.set('env:VERCEL_ENV', { state: 'unhealthy' });
    problems.push({
      key: 'env:VERCEL_ENV',
      text: 'VERCEL_ENV missing or unrecognized',
    });
  }
  for (const issue of alertConfigIssues) {
    const key = `env:${issue.name}`;
    states.set(key, { state: 'unhealthy' });
    problems.push({ key, text: `${issue.name} ${issue.reason}` });
  }
  for (const name of ['ALERT_TO', 'ALERT_FROM', 'ALERT_REPLY_TO']) {
    const key = `env:${name}`;
    if (!states.has(key)) states.set(key, { state: 'healthy' });
  }

  const supabaseDown = problems.some((problem) =>
    problem.key === 'check:Supabase reachable');
  states.set('monitoring:observation-append', {
    state: productionRun && supabaseConfigured() && !supabaseDown
      ? 'healthy'
      : 'unknown',
  });
  problems.sort((a, b) => (a.key < b.key ? -1 : 1));
  const alertableProblems = problems.filter((problem) =>
    policyFor(problem.key, problem.severity).severity !== 'SEV-2');
  let fingerprint = alertableProblems.length
    ? fingerprintOf(alertableProblems)
    : null;
  let severity = alertableProblems.length
    ? highestSeverity(alertableProblems)
    : null;
  let alerted = false;
  let throttled = false;
  let alertError = '';
  const alertDeliveryIssues = [
    ...(!process.env.RESEND_API_KEY ? ['RESEND_API_KEY missing'] : []),
    ...alertConfigIssues
      .filter((issue) => issue.name === 'ALERT_TO')
      .map((issue) => `${issue.name} ${issue.reason}`),
  ];

  if (alertableProblems.length) {
    console.error(
      'health-check: problems detected',
      alertableProblems.map((problem) => problem.text),
    );
    // When the gather phase already established Supabase is down, skip the
    // throttle read/write entirely — they would only burn deadline budget.
    // Trade-off: during a Supabase outage the alert repeats every five minutes.
    if (alertSuppressed) {
      console.info('health-check: alert email suppressed outside production');
    } else if (alertDeliveryIssues.length) {
      alertError = `cannot email: ${alertDeliveryIssues.join('; ')}`;
    } else if (!supabaseDown && (await timed(
      'throttle_read_ms',
      () => recentlyAlerted(now, fingerprint, severity),
    ))) {
      throttled = true;
    } else {
      try {
        await timed(
          'alert_send_ms',
          () => sendAlert(
            alertableProblems,
            now,
            alertConfig,
            productionRun ? 'PROD' : 'UNKNOWN',
          ),
        );
        alerted = true;
        if (supabaseConfigured() && !supabaseDown) {
          try {
            await timed('alert_record_ms', () => supabaseInsert('webhook_logs', {
              level: 'info',
              source: 'health-check',
              message: 'alert email sent',
              detail: {
                fingerprint,
                keys: alertableProblems.map((problem) => problem.key),
                severity,
              },
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

  // Write evidence after the bounded notification path. Its total_ms therefore
  // covers healthy, throttled, successful-alert, and failed-alert runs on the
  // same basis. The database row timestamp also captures time to the insert.
  timings.total_ms = Date.now() - now;
  if (productionRun && supabaseConfigured() && !supabaseDown) {
    const evidence = {
      level: 'info',
      source: 'health-check-observation',
      message: 'health check observations',
      detail: {
        checked_at: new Date(now).toISOString(),
        environment: 'production',
        observations: publicObservations(states),
        timings: integerTimings(timings),
      },
    };
    try {
      await timed(
        'observation_write_ms',
        () => supabaseInsert(
          'webhook_logs',
          evidence,
          THROTTLE_IO_TIMEOUT_MS,
        ),
      );
    } catch (err) {
      states.set('monitoring:observation-append', { state: 'unknown' });
      const observationProblem = {
        key: 'monitoring:observation-append',
        state: 'unknown',
        text: `Health observation append failed: ` +
          String(err?.message || err),
      };
      problems.push(observationProblem);
      if (!fingerprint) {
        fingerprint = fingerprintOf([observationProblem]);
        severity = policyFor(observationProblem.key).severity;
      }
      const gap = {
        level: 'info',
        source: 'health-check-observation-gap',
        message: 'health check observation gap',
        detail: {
          checked_at: new Date(now).toISOString(),
          environment: 'production',
          observations: publicObservations(states),
          timings: integerTimings(timings),
        },
      };
      try {
        await timed(
          'observation_gap_write_ms',
          () => supabaseInsert(
            'webhook_logs',
            gap,
            THROTTLE_IO_TIMEOUT_MS,
          ),
        );
      } catch (gapError) {
        console.error(
          'health-check: could not record observation coverage gap',
          gapError?.message || gapError,
        );
      }
      // The primary evidence store cannot safely deduplicate its own failure.
      // Notify statelessly after the gap attempt rather than hide the outage.
      if (!alerted && !alertDeliveryIssues.length) {
        try {
          await timed(
            'observation_alert_send_ms',
            () => sendAlert(
              [observationProblem],
              now,
              alertConfig,
              'PROD',
            ),
          );
          alerted = true;
        } catch (notificationError) {
          const message = String(
            notificationError?.message || notificationError,
          );
          alertError = alertError
            ? `${alertError}; ${message}`
            : message;
        }
      }
    }
  }

  problems.sort((a, b) => (a.key < b.key ? -1 : 1));
  timings.total_ms = Date.now() - now;
  console.info('health-check: timings', timings);

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({
    ok: problems.length === 0 && warnings.length === 0,
    checked_at: new Date(now).toISOString(),
    problems: problems.map((p) => p.text),
    warnings: warnings.map((warning) => warning.text),
    observations: publicObservations(states),
    fingerprint,
    alerted,
    throttled,
    ...(alertSuppressed && alertableProblems.length
      ? { alert_suppressed: true }
      : {}),
    timings,
    ...(alertError ? { alert_error: alertError } : {}),
  });
}
