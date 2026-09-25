export const slugs = ['demitris-taverna','swirl-on-the-square','calamari-bistro-bar','l-campo'];
export const dates = ['2026-09-29','2026-09-30','2026-10-06','2026-10-13','2026-10-14'];
export function summary() {
  return { kind: 'summary', asOf: '2026-09-30T21:45:00Z', pickups: 12, tastings: 3, emails: 14, marketingContacts: 9, repeatTasters: 1,
    byRestaurantDate: dates.flatMap(date => slugs.map(restaurant => ({ event_date: date, restaurant,
      tastings: restaurant === 'demitris-taverna' && ['2026-09-29','2026-09-30'].includes(date) ? 1
        : restaurant === 'l-campo' && date === '2026-09-29' ? 1 : 0 }))) };
}
export function emptySummary() {
  const value = summary(); for (const k of ['pickups','tastings','emails','marketingContacts','repeatTasters']) value[k] = 0;
  value.byRestaurantDate.forEach(row => row.tastings = 0); return value;
}
export function participation(email = 'guest@example.com') {
  return { record_id: '11111111-1111-4111-8111-111111111111', record_type: 'pickup', event_date: '2026-09-29',
    email, restaurant: null, origin: 'browser', recorded_at: '2026-09-29T19:00:00Z' };
}
export function marketing(email = 'guest@example.com') {
  return { email, marketing_opt_in: true, choice_basis: 'explicit_change', wording: 'Email me DPC news and upcoming events.',
    wording_version: 'glass-2026-09-24-v1', choice_occurred_at: '2026-09-29T19:00:00Z', choice_recorded_at: '2026-09-29T19:00:00Z' };
}
