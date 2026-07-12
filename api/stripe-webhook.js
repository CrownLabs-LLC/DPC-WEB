import Stripe from 'stripe';
import { Resend } from 'resend';
import {
  buildDepositNotifyEmail,
  buildWelcomeEmail,
  splitName,
} from './lib/founding-deposit-welcome.js';

// Required so Vercel leaves the request body as a raw stream for Stripe signature verification.
export const config = {
  api: {
    bodyParser: false,
  },
};

const DEPOSIT_AMOUNT_CENTS = 4900;
const WELCOME_SENT_METADATA_KEY = 'welcome_sent';
const NOTIFY_DEPOSIT_TO = (process.env.NOTIFY_DEPOSIT_TO || 'nick@downtownpourcollective.com,hello@downtownpourcollective.com')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const NOTIFY_DEPOSIT_FROM = process.env.NOTIFY_DEPOSIT_FROM || 'Downtown Pour Collective <hello@downtownpourcollective.com>';

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

function hasFoundingDepositMetadata(session) {
  // Link-level metadata is copied onto the session; product-level metadata is not,
  // so also inspect the expanded line item products (how the Payment Link is configured).
  if (session.metadata?.product_type === 'founding_deposit') return true;
  const lineItems = session.line_items?.data || [];
  return lineItems.some(
    (item) => item?.price?.product?.metadata?.product_type === 'founding_deposit'
  );
}

function isPaidFoundingDeposit(session) {
  if (!session || session.payment_status !== 'paid') return false;
  if (session.currency !== 'usd') return false;
  if (session.amount_total !== DEPOSIT_AMOUNT_CENTS) return false;
  if (!hasFoundingDepositMetadata(session)) return false;
  return true;
}

// The Resend v4 SDK does not throw on API errors — it resolves with
// { data, error }. Every Resend call must check `error` explicitly or
// failures are silently swallowed.
function resendErrorMessage(error) {
  if (!error) return '';
  return `${error.name || 'resend_error'}: ${error.message || JSON.stringify(error)}`;
}

async function markWelcomeSent(stripe, session) {
  await stripe.checkout.sessions.update(session.id, {
    metadata: {
      ...(session.metadata || {}),
      [WELCOME_SENT_METADATA_KEY]: '1',
      welcome_sent_at: new Date().toISOString(),
    },
  });
}

async function handleCheckoutSessionCompleted(stripe, resend, sessionSnapshot) {
  if (!sessionSnapshot?.id) {
    return { skipped: 'missing_session_id' };
  }

  const session = await stripe.checkout.sessions.retrieve(sessionSnapshot.id, {
    expand: ['line_items.data.price.product'],
  });

  if (!isPaidFoundingDeposit(session)) {
    console.info('stripe-webhook: ignoring session', session.id, {
      payment_status: session.payment_status,
      currency: session.currency,
      amount_total: session.amount_total,
      product_type: session.metadata?.product_type,
      product_types: (session.line_items?.data || []).map(
        (item) => item?.price?.product?.metadata?.product_type
      ),
    });
    return { skipped: 'not_founding_deposit' };
  }

  if (session.metadata?.[WELCOME_SENT_METADATA_KEY] === '1') {
    return { skipped: 'already_processed' };
  }

  const email = String(
    session.customer_details?.email || session.customer_email || ''
  ).trim().toLowerCase();
  if (!email) {
    console.error('stripe-webhook: missing customer email for session', session.id);
    return { skipped: 'missing_customer_email' };
  }

  const { first_name, last_name } = splitName(session.customer_details?.name || '');
  const phone = String(session.customer_details?.phone || '').trim();

  // Send the welcome email FIRST. This is the primary side effect, so a failure
  // here must throw and return non-2xx, letting Stripe retry. Marking the session
  // as processed before this point would make a retry skip as already_processed
  // and the customer would never receive the email.
  const welcome = buildWelcomeEmail({ first_name });
  const welcomeResult = await resend.emails.send({
    from: welcome.from,
    to: email,
    replyTo: welcome.replyTo,
    subject: welcome.subject,
    text: welcome.text,
    html: welcome.html,
  });
  if (welcomeResult?.error) {
    throw new Error(`welcome email send failed — ${resendErrorMessage(welcomeResult.error)}`);
  }

  // Best-effort dedup marker. The email already sent, so a failed write here must
  // not fail the request (returning 500 would make Stripe retry and resend). This
  // biases toward at-least-once delivery: a rare duplicate welcome beats none.
  try {
    await markWelcomeSent(stripe, session);
  } catch (err) {
    console.error('stripe-webhook: failed to mark welcome_sent (non-fatal, email already sent)', err);
  }

  // Audience add is best-effort: the welcome email already sent, so nothing
  // past this point may throw (a 500 would make Stripe retry and resend it).
  const audienceId = process.env.RESEND_FOUNDING_AUDIENCE_ID;
  if (!audienceId) {
    console.error('stripe-webhook: RESEND_FOUNDING_AUDIENCE_ID not set — skipping audience add (non-fatal)');
  } else {
    try {
      const contactResult = await resend.contacts.create({
        audienceId,
        email,
        firstName: first_name || undefined,
        lastName: last_name || undefined,
        unsubscribed: false,
      });
      const message = resendErrorMessage(contactResult?.error);
      if (message && /already exists|duplicate/i.test(message)) {
        console.info('stripe-webhook: contact already exists in audience', email);
      } else if (message) {
        console.error('stripe-webhook: resend.contacts.create failed (non-fatal)', message);
      }
    } catch (err) {
      console.error('stripe-webhook: resend.contacts.create threw (non-fatal)', err);
    }
  }

  const notify = buildDepositNotifyEmail({
    first_name,
    last_name,
    email,
    phone,
    stripe_session_id: session.id,
    amount_usd: (session.amount_total / 100).toFixed(2),
  });
  try {
    const notifyResult = await resend.emails.send({
      from: NOTIFY_DEPOSIT_FROM,
      to: NOTIFY_DEPOSIT_TO,
      replyTo: email,
      subject: notify.subject,
      html: notify.html,
    });
    if (notifyResult?.error) {
      console.error('stripe-webhook: internal deposit notify failed (non-fatal)', resendErrorMessage(notifyResult.error));
    }
  } catch (err) {
    console.error('stripe-webhook: internal deposit notify threw (non-fatal)', err);
  }

  return { processed: true, session_id: session.id, email };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ received: false, error: 'POST required' });
  }

  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const resendApiKey = process.env.RESEND_API_KEY;

  const missingEnv = [
    ['STRIPE_SECRET_KEY', stripeSecretKey],
    ['STRIPE_WEBHOOK_SECRET', webhookSecret],
    ['RESEND_API_KEY', resendApiKey],
  ].filter(([, value]) => !value).map(([name]) => name);
  if (missingEnv.length) {
    console.error('stripe-webhook: missing env vars:', missingEnv.join(', '), '— set them in Vercel and redeploy');
    return res.status(500).json({ received: false, error: 'Server not configured', missing: missingEnv });
  }

  const stripe = new Stripe(stripeSecretKey);
  const resend = new Resend(resendApiKey);
  const signature = req.headers['stripe-signature'];

  let event;
  try {
    const rawBody = await readRawBody(req);
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    console.error('stripe-webhook: signature verification failed', err?.message || err);
    return res.status(400).json({ received: false, error: 'Invalid signature' });
  }

  // A test-mode key cannot retrieve live sessions (and vice versa): every
  // event would 500 on sessions.retrieve with resource_missing. Catch the
  // misconfiguration up front and say exactly what to fix. Still return 500
  // so Stripe keeps retrying/alerting until the env var is corrected.
  const keyMode = /^(sk|rk)_live_/.test(stripeSecretKey) ? 'live' : 'test';
  const eventMode = event.livemode ? 'live' : 'test';
  if (keyMode !== eventMode) {
    console.error(
      `stripe-webhook: mode mismatch — received a ${eventMode}-mode event but STRIPE_SECRET_KEY is a ${keyMode}-mode key. ` +
      'Set the matching Stripe secret key in Vercel env vars and redeploy.'
    );
    return res.status(500).json({
      received: false,
      error: `Server misconfigured: ${eventMode}-mode event with ${keyMode}-mode API key`,
    });
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const result = await handleCheckoutSessionCompleted(stripe, resend, event.data.object);
      return res.status(200).json({ received: true, ...result });
    }

    return res.status(200).json({ received: true, skipped: 'ignored_event_type', type: event.type });
  } catch (err) {
    console.error('stripe-webhook: handler failed', event?.id, {
      message: err?.message,
      type: err?.type,
      code: err?.code,
      statusCode: err?.statusCode,
    }, err);
    return res.status(500).json({
      received: false,
      error: 'Webhook handler failed',
      detail: String(err?.message || err),
    });
  }
}
