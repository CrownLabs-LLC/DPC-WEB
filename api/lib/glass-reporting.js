import { looksLikeSecretKey } from '../admin-config.js';
import { RESTAURANTS } from './glass-tasting.js';
import { TASTING_DATES } from './glass-campaign.js';

export const CSV_COLUMNS = Object.freeze({
  participation: ['record_type', 'event_date', 'email', 'restaurant', 'origin', 'recorded_at', 'record_id'],
  marketing: ['email', 'marketing_opt_in', 'choice_basis', 'wording', 'wording_version', 'choice_occurred_at', 'choice_recorded_at'],
});
export function reportingConfiguration() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  try {
    const url = new URL(process.env.SUPABASE_URL || '');
    const expected = process.env.VERCEL_ENV === 'production' ? 'ebiuspbgzggrdiaswpcc.supabase.co'
      : process.env.VERCEL_ENV === 'preview' ? 'hohbsqkmrlhkstojfdgx.supabase.co' : null;
    if (!key || url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
      || url.pathname !== '/' || (expected && url.hostname !== expected)) return null;
    return { url: url.origin, key, projectRef: url.hostname.split('.')[0] };
  } catch { return null; }
}
export function reportingPublicConfig(config) {
  if (!config) return { configured: false };
  const url = (process.env.ADMIN_SUPABASE_URL || process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const key = (process.env.ADMIN_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '').trim();
  // A Preview login must use the very same project as the private report.
  if (url !== config.url || !key || looksLikeSecretKey(key)) return { configured: false };
  return { configured: true, supabaseUrl: config.url, supabaseAnonKey: key, projectRef: config.projectRef };
}
export function isAdmin(user) {
  const meta = user?.app_metadata;
  return Boolean(user?.id && (meta?.role === 'admin' || (Array.isArray(meta?.roles) && meta.roles.includes('admin'))));
}
const count = n => Number.isSafeInteger(n) && n >= 0;
const timestamp = n => typeof n === 'string' && Number.isFinite(Date.parse(n));
export function validateReport(report, kind) {
  if (!report || report.kind !== kind || !timestamp(report.asOf)) throw Error('Invalid report');
  if (kind === 'summary') {
    if (!['pickups', 'tastings', 'emails', 'marketingContacts', 'repeatTasters'].every(k => count(report[k]))
      || report.marketingContacts > report.emails || report.repeatTasters > report.emails
      || !Array.isArray(report.byRestaurantDate) || report.byRestaurantDate.length !== 20) throw Error('Invalid summary');
    const seen = new Set(); let total = 0;
    for (const row of report.byRestaurantDate) {
      const key = row.event_date + ':' + row.restaurant;
      if (!TASTING_DATES.includes(row.event_date) || !Object.hasOwn(RESTAURANTS, row.restaurant)
        || !count(row.tastings) || seen.has(key)) throw Error('Invalid summary grid');
      seen.add(key); total += row.tastings;
    }
    if (total !== report.tastings) throw Error('Invalid summary total');
  } else {
    if (!count(report.total) || !Array.isArray(report.rows) || report.total !== report.rows.length) throw Error('Incomplete export');
    for (const row of report.rows) {
      if (typeof row.email !== 'string' || !row.email) throw Error('Invalid email');
      if (kind === 'participation') {
        if (!['pickup', 'tasting'].includes(row.record_type) || !/^\d{4}-\d{2}-\d{2}$/.test(row.event_date)
          || !['browser', 'paper'].includes(row.origin) || !timestamp(row.recorded_at) || typeof row.record_id !== 'string'
          || (row.record_type === 'pickup' ? row.restaurant !== null
            : !Object.hasOwn(RESTAURANTS, row.restaurant) || !TASTING_DATES.includes(row.event_date))) throw Error('Invalid participation');
      } else if (row.marketing_opt_in !== true || !['initial_default', 'explicit_change'].includes(row.choice_basis)
        || typeof row.wording !== 'string' || !row.wording || typeof row.wording_version !== 'string' || !row.wording_version
        || !timestamp(row.choice_occurred_at) || !timestamp(row.choice_recorded_at)) throw Error('Missing choice evidence');
    }
  }
  return report;
}
export function csvCell(value) {
  let text = value == null ? '' : String(value);
  // Quoting alone does not prevent spreadsheet formula execution.
  if (/^[\s\uFEFF]*[=+\-@]/u.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
export function reportCsv(report) {
  const columns = CSV_COLUMNS[report.kind];
  if (!columns) throw Error('Invalid CSV type');
  const rows = report.rows.map(row => columns.map(key => csvCell(key === 'restaurant' && row.restaurant
    ? RESTAURANTS[row.restaurant] : row[key])).join(','));
  return '\uFEFF' + [columns.map(csvCell).join(','), ...rows].join('\r\n') + '\r\n';
}
