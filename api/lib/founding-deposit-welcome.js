const WELCOME_FROM = process.env.WELCOME_FROM || 'Downtown Pour Collective <hello@downtownpourcollective.com>';
const WELCOME_REPLY_TO = process.env.WELCOME_REPLY_TO || 'hello@downtownpourcollective.com';
const WELCOME_SUBJECT = process.env.WELCOME_SUBJECT || 'Your Founding Spot is reserved';

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function splitName(fullName) {
  const trimmed = String(fullName || '').trim();
  if (!trimmed) return { first_name: '', last_name: '' };
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return { first_name: parts[0], last_name: '' };
  return { first_name: parts[0], last_name: parts.slice(1).join(' ') };
}

export function buildWelcomeEmail({ first_name }) {
  const greeting = first_name ? `Hi ${first_name},` : 'Hi,';
  const text = `${greeting}

You're in. Your Founding Spot is reserved, and your refundable $49 deposit is holding it. Here is what happens next, in plain terms. Right now, there is nothing more to pay and nothing more to do. Your spot is secured.

In the coming weeks, Founding activations open. That is the step that turns your reservation into a Founding membership. When activations open, you will get one email from us with your activation link. Completing that link is your next action, and it is the one that makes you a Founding Member.

At activation, your Circle's annual founding fee is billed, your $49 applies toward your Welcome Kit and Activation Fee, and your Pours are set for launch on August 1, 2026. Until you activate, your $49 stays fully refundable.

Watch your inbox for the activation email. That is the one that counts.

Nick
Downtown Pour Collective
`;

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${escapeHtml(WELCOME_SUBJECT)}</title></head>
<body style="margin:0;padding:0;background:#FFFFFF;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#FFFFFF;">
  <tr><td align="center" style="padding:40px 16px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;width:100%;">
      <tr><td style="font-family:Barlow,'Helvetica Neue',Arial,sans-serif;font-size:16px;line-height:1.6;color:#0D1B2A;">
        <p style="margin:0 0 16px 0;">${escapeHtml(greeting)}</p>
        <p style="margin:0 0 16px 0;">You&#8217;re in. Your Founding Spot is reserved, and your refundable $49 deposit is holding it. Here is what happens next, in plain terms. Right now, there is nothing more to pay and nothing more to do. Your spot is secured.</p>
        <p style="margin:0 0 16px 0;">In the coming weeks, Founding activations open. That is the step that turns your reservation into a Founding membership. When activations open, you will get one email from us with your activation link. Completing that link is your next action, and it is the one that makes you a Founding Member.</p>
        <p style="margin:0 0 16px 0;">At activation, your Circle&#8217;s annual founding fee is billed, your $49 applies toward your Welcome Kit and Activation Fee, and your Pours are set for launch on August 1, 2026. Until you activate, your $49 stays fully refundable.</p>
        <p style="margin:0 0 16px 0;">Watch your inbox for the activation email. That is the one that counts.</p>
        <p style="margin:24px 0 0 0;font-size:14px;color:#5A5A5A;line-height:1.6;">
          Nick<br>
          Downtown Pour Collective
        </p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;

  return {
    from: WELCOME_FROM,
    replyTo: WELCOME_REPLY_TO,
    subject: WELCOME_SUBJECT,
    text,
    html,
  };
}

export function buildDepositNotifyEmail({ first_name, last_name, email, phone, stripe_session_id, amount_usd }) {
  const name = [first_name, last_name].filter(Boolean).join(' ') || '—';
  const subject = `New founding deposit: ${name} (${email})`;
  const html = `
    <h2>New founding deposit</h2>
    <p><strong>Name:</strong> ${escapeHtml(name)}</p>
    <p><strong>Email:</strong> ${escapeHtml(email)}</p>
    <p><strong>Phone:</strong> ${escapeHtml(phone || '—')}</p>
    <p><strong>Amount:</strong> $${escapeHtml(amount_usd)}</p>
    <p><strong>Stripe session:</strong> ${escapeHtml(stripe_session_id)}</p>
    <p><strong>Received:</strong> ${escapeHtml(new Date().toISOString())}</p>
  `;
  return { subject, html };
}
