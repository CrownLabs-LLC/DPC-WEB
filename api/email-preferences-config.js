// Public configuration only. Capabilities go directly to DPC's membership API;
// this endpoint never receives a token or holds a Supabase credential.
const targets = {
  production: 'https://ebiuspbgzggrdiaswpcc.supabase.co/functions/v1/pour-reminder-preferences',
  preview: 'https://hohbsqkmrlhkstojfdgx.supabase.co/functions/v1/pour-reminder-preferences',
  development: 'https://hohbsqkmrlhkstojfdgx.supabase.co/functions/v1/pour-reminder-preferences',
};

export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ enabled: false });
  }
  const apiUrl = targets[process.env.VERCEL_ENV];
  if (process.env.POUR_REMINDER_PAGE_ENABLED !== 'true' || !apiUrl ||
      process.env.POUR_REMINDER_API_URL !== apiUrl) {
    return res.status(200).json({ enabled: false });
  }
  return res.status(200).json({ enabled: true, apiUrl });
}
