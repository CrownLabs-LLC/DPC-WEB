import { isAdmin, reportingConfiguration, reportingPublicConfig, validateReport, reportCsv } from './lib/glass-reporting.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Vary', 'Authorization');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  const fail = (status, code, message) => res.status(status).json({ success: false, code, message });
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET'); return fail(405, 'method_not_allowed', 'Use the campaign results page.');
  }
  const kind = req.query?.kind || 'summary';
  if (!['config', 'summary', 'participation', 'marketing'].includes(kind)
    || Object.keys(req.query || {}).some(k => k !== 'kind')) return fail(400, 'invalid_report', 'Choose a report from the results page.');
  const config = reportingConfiguration();
  if (kind === 'config') return res.status(200).json(reportingPublicConfig(config));
  const authorization = req.headers.authorization;
  if (typeof authorization !== 'string' || !/^Bearer [^\s]{1,8192}$/i.test(authorization)) return fail(401, 'sign_in_required', 'Sign in to view campaign results.');
  if (!config) return fail(503, 'unavailable', 'Campaign results are unavailable. Try again shortly.');
  try {
    // Verify the access token with Auth and read fresh server-owned app_metadata.
    // Never authorize from browser state, a decoded JWT or user_metadata.
    const identity = await fetch(config.url + '/auth/v1/user', {
      headers: { apikey: config.key, Authorization: authorization }, signal: AbortSignal.timeout(8000),
    });
    if ([401, 403].includes(identity.status)) return fail(401, 'session_expired', 'Your session has expired. Sign in again.');
    if (!identity.ok) throw Error('Identity unavailable');
    const user = await identity.json();
    if (!isAdmin(user)) return fail(403, 'admin_required', 'This account does not have DPC admin access.');
    const response = await fetch(config.url + '/rest/v1/rpc/read_glass_campaign_report', {
      method: 'POST', headers: { 'Content-Type': 'application/json', apikey: config.key, Authorization: 'Bearer ' + config.key },
      body: JSON.stringify({ p_kind: kind }), signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw Error('Report unavailable');
    const report = validateReport(await response.json(), kind);
    if (kind === 'summary') return res.status(200).json(report);
    const csv = reportCsv(report);
    // Vercel's response size is bounded. Fail explicitly before sending any bytes;
    // never silently truncate rows or return a partial download as success.
    if (Buffer.byteLength(csv) > 4_000_000) return fail(413, 'export_too_large', 'This report is too large to download here. Contact DPC for a complete export.');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="glass-${kind}-${report.asOf.slice(0, 10)}.csv"`);
    res.setHeader('X-Report-As-Of', report.asOf);
    res.setHeader('X-Report-Rows', String(report.total));
    return res.status(200).send(csv);
  } catch {
    // Do not log tokens, email addresses, response bodies or private query errors.
    return fail(503, 'unavailable', 'Campaign results are unavailable. Try again shortly.');
  }
}
