import { Resend } from 'resend';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ALLOWED_SOURCES = new Set(['partner-landing-june2026', 'partner-waitlist-2026']);
const ALLOWED_CIRCLES = new Set(['Tap', 'Cellar', 'Reserve']);
const NOTIFY_FROM = process.env.NOTIFY_FROM || 'DPC Partners <partners@downtownpourcollective.com>';
const NOTIFY_TO = (process.env.NOTIFY_TO || 'nick@downtownpourcollective.com,partners@downtownpourcollective.com')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// Auto-acknowledgment per DPC_Partner_Intake_Email_Spec_v1_0. Subject and body are locked.
// Defaults are the production values; overrideable via env for local dev only.
const AUTOACK_FROM = process.env.AUTOACK_FROM || 'Downtown Pour Collective <partners@downtownpourcollective.com>';
const AUTOACK_REPLY_TO = process.env.AUTOACK_REPLY_TO || 'nick@downtownpourcollective.com';

function bad(res, code, message) {
  return res.status(code).json({ success: false, error: { code: 'BAD_REQUEST', message } });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function buildAutoAck({ first_name, venue_name }) {
  const venue = venue_name || 'your venue';
  const salutation = first_name ? `${first_name},\n\n` : '';
  const text = `${salutation}Your note on ${venue} is with Nick. He reads every one of these himself and replies within 48 hours with whether DPC is a fit for your venue and what the next step looks like.

Downtown Pour Collective
partners@downtownpourcollective.com
(925) 488-4889
`;
  const salutationHtml = first_name
    ? `<p style="margin:0 0 16px 0;">${escapeHtml(first_name)},</p>`
    : '';
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>We got it.</title></head>
<body style="margin:0;padding:0;background:#FFFFFF;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#FFFFFF;">
  <tr><td align="center" style="padding:40px 16px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;width:100%;">
      <tr><td style="font-family:Barlow,'Helvetica Neue',Arial,sans-serif;font-size:16px;line-height:1.6;color:#0D1B2A;">
        ${salutationHtml}
        <p style="margin:0 0 16px 0;">Your note on ${escapeHtml(venue)} is with Nick. He reads every one of these himself and replies within 48 hours with whether DPC is a fit for your venue and what the next step looks like.</p>
        <p style="margin:24px 0 0 0;font-size:14px;color:#5A5A5A;line-height:1.6;">
          Downtown Pour Collective<br>
          partners@downtownpourcollective.com<br>
          (925) 488-4889
        </p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
  return { text, html };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'POST required' } });
  }

  const apiKey = process.env.RESEND_API_KEY;
  const audienceId = process.env.RESEND_PARTNER_AUDIENCE_ID;
  if (!apiKey || !audienceId) {
    console.error('partner-intake: missing RESEND_API_KEY or RESEND_PARTNER_AUDIENCE_ID');
    return res.status(500).json({ success: false, error: { code: 'SERVER_NOT_CONFIGURED', message: 'Server is missing email configuration.' } });
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const first_name = String(body.first_name || '').trim();
  const last_name = String(body.last_name || '').trim();
  const venue_name = String(body.venue_name || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const phone = String(body.phone || '').trim();
  const q1_answer = String(body.q1_answer || '').trim();
  const q2_answer = String(body.q2_answer || '').trim();
  const sourceRaw = String(body.source || 'partner-landing-june2026').trim();
  const source = ALLOWED_SOURCES.has(sourceRaw) ? sourceRaw : 'partner-landing-june2026';
  const circles = Array.isArray(body.circles_interest)
    ? body.circles_interest.filter((c) => ALLOWED_CIRCLES.has(c))
    : ALLOWED_CIRCLES.has(body.circles_interest) ? [body.circles_interest] : [];

  if (!first_name || !last_name) return bad(res, 400, 'Please add your first and last name.');
  if (!venue_name) return bad(res, 400, 'Please add your venue name.');
  if (!EMAIL_RE.test(email)) return bad(res, 400, "That email doesn't look right. Try again.");
  if (!q1_answer || !q2_answer) return bad(res, 400, 'Please answer both questions so Nick can reply with something useful.');

  if (first_name.length > 80 || last_name.length > 80 || venue_name.length > 200 || email.length > 200 || phone.length > 40 || q1_answer.length > 4000 || q2_answer.length > 4000) {
    return bad(res, 400, 'One of those fields is unusually long. Trim and try again.');
  }

  const resend = new Resend(apiKey);
  const signup_date = new Date().toISOString();
  const circlesStr = circles.join(', ');

  try {
    await resend.contacts.create({
      audienceId,
      email,
      firstName: first_name,
      lastName: last_name,
      unsubscribed: false,
    });
  } catch (err) {
    console.error('resend.contacts.create failed', err);
    return res.status(502).json({ success: false, error: { code: 'AUDIENCE_FAIL', message: 'Something stuck on our end. Try once more or email partners@downtownpourcollective.com directly.' } });
  }

  const ack = buildAutoAck({ first_name, venue_name });
  try {
    await resend.emails.send({
      from: AUTOACK_FROM,
      to: email,
      replyTo: AUTOACK_REPLY_TO,
      subject: 'We got it.',
      text: ack.text,
      html: ack.html,
    });
  } catch (err) {
    console.error('resend autoack send failed', err);
    return res.status(502).json({ success: false, error: { code: 'AUTOACK_FAIL', message: 'Something stuck on our end. Try once more or email partners@downtownpourcollective.com directly.' } });
  }

  const subject = `New partner intake: ${venue_name} (${first_name} ${last_name})`;
  const html = `
    <h2>New partner intake</h2>
    <p><strong>Venue:</strong> ${escapeHtml(venue_name)}</p>
    <p><strong>Name:</strong> ${escapeHtml(first_name)} ${escapeHtml(last_name)}</p>
    <p><strong>Email:</strong> ${escapeHtml(email)}</p>
    <p><strong>Phone:</strong> ${escapeHtml(phone || '—')}</p>
    <p><strong>Circles of interest:</strong> ${escapeHtml(circlesStr || '—')}</p>
    <p><strong>Source:</strong> ${escapeHtml(source)}</p>
    <p><strong>Signup date:</strong> ${escapeHtml(signup_date)}</p>
    <hr>
    <h3>Q1 — Filling your quiet hours</h3>
    <p style="white-space:pre-wrap">${escapeHtml(q1_answer)}</p>
    <h3>Q2 — Your beverage program</h3>
    <p style="white-space:pre-wrap">${escapeHtml(q2_answer)}</p>
  `;

  try {
    await resend.emails.send({
      from: NOTIFY_FROM,
      to: NOTIFY_TO,
      replyTo: email,
      subject,
      html,
    });
  } catch (err) {
    console.error('resend.emails.send failed', err);
    return res.status(502).json({ success: false, error: { code: 'NOTIFY_FAIL', message: 'Something stuck on our end. Try once more or email partners@downtownpourcollective.com directly.' } });
  }

  return res.status(200).json({ success: true });
}
