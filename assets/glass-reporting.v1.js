const $ = id => document.getElementById(id);
const sessionKey = 'dpc_admin_session';
const restaurants = ['demitris-taverna', 'swirl-on-the-square', 'calamari-bistro-bar', 'l-campo'];
const dates = ['2026-09-29', '2026-09-30', '2026-10-06', '2026-10-13', '2026-10-14'];
const number = new Intl.NumberFormat('en-US');
const day = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
const timestamp = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
let cfg, session, generation = 0, loadSequence = 0, refreshPromise;
const controllers = new Set(), downloads = new Set();
const problem = (code, message) => Object.assign(new Error(message), { code });
function show(view) {
  const changed = $(view).hidden;
  for (const id of ['boot', 'sign-in', 'denied', 'results']) $(id).hidden = id !== view;
  $('sign-out').hidden = !session; $('who').hidden = !session;
  $('who').textContent = session?.user?.email || '';
  if (changed) $(view).querySelector('h1')?.focus({ preventScroll: true });
}
function clearReport() {
  $('report').hidden = true;
  for (const name of ['pickups', 'tastings', 'emails', 'repeatTasters', 'marketingContacts']) $('count-' + name).textContent = '';
  $('tasting-rows').replaceChildren(); $('tasting-totals').replaceChildren();
  $('download-status').textContent = ''; $('download-error').hidden = true;
}
function invalidate() {
  generation++; loadSequence++; refreshPromise = null;
  for (const controller of controllers) controller.abort(); controllers.clear(); clearReport();
  // Refreshing counts must not revoke a CSV already handed to the browser.
  // Session invalidation still releases private downloads immediately.
  for (const url of downloads) URL.revokeObjectURL(url); downloads.clear();
}
function storedSession() {
  try {
    const value = JSON.parse(localStorage.getItem(sessionKey));
    return value?.access_token && value?.refresh_token && Number.isFinite(value.expires_at)
      && (!value.projectRef || value.projectRef === cfg.projectRef) ? value : null;
  } catch { return null; }
}
function saveSession(value, current) {
  if (current !== generation) throw problem('cancelled');
  session = { ...value, projectRef: cfg.projectRef };
  try { localStorage.setItem(sessionKey, JSON.stringify(session)); } catch { /* In-memory sign-in still works. */ }
}
function forgetSession() {
  session = null; try { localStorage.removeItem(sessionKey); } catch {}
}
function signedOut(message = '') {
  invalidate(); forgetSession(); show('sign-in');
  $('sign-in-message').textContent = message; $('sign-in-message').hidden = !message;
  $('password').value = '';
}
async function fetchTimed(url, options = {}, read = response => response.json()) {
  const controller = new AbortController(); controllers.add(controller);
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal, cache: 'no-store', credentials: 'omit' });
    return { response, data: await read(response) };
  }
  finally { clearTimeout(timer); controllers.delete(controller); }
}
async function grant(type, body, current) {
  const { response, data: result } = await fetchTimed(cfg.supabaseUrl + '/auth/v1/token?grant_type=' + type, {
    method: 'POST', headers: { apikey: cfg.supabaseAnonKey, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (current !== generation) throw problem('cancelled');
  if (!response.ok || !result.access_token || !result.refresh_token) {
    throw problem(type === 'refresh_token' ? 'expired' : 'login', type === 'refresh_token'
      ? 'Your session has expired. Sign in again.' : 'Could not sign in. Check your email and password, then try again.');
  }
  const next = { access_token: result.access_token, refresh_token: result.refresh_token,
    expires_at: result.expires_at || Math.floor(Date.now() / 1000) + result.expires_in,
    user: result.user || session?.user };
  if (!Number.isFinite(next.expires_at)) throw problem('expired', 'Sign in again to continue.');
  saveSession(next, current); return next.access_token;
}
async function accessToken() {
  if (!session) throw problem('expired', 'Sign in again to continue.');
  if (session.expires_at > Date.now() / 1000 + 60) return session.access_token;
  if (!refreshPromise) {
    const current = generation;
    refreshPromise = grant('refresh_token', { refresh_token: session.refresh_token }, current)
      .catch(error => { if (error.code === 'cancelled') throw error; throw problem('expired', 'Your session has expired. Sign in again.'); })
      .finally(() => { if (current === generation) refreshPromise = null; });
  }
  return refreshPromise;
}
async function privateRequest(kind) {
  const current = generation, token = await accessToken();
  if (current !== generation) throw problem('cancelled');
  const { response, data } = await fetchTimed('/api/glass-reporting?kind=' + kind,
    { headers: { Authorization: 'Bearer ' + token } },
    result => result.ok && kind !== 'summary' ? result.blob() : result.json());
  if (current !== generation) throw problem('cancelled');
  if (response.status === 401) throw problem('expired', 'Your session has expired. Sign in again.');
  if (response.status === 403) throw problem('forbidden');
  if (!response.ok) throw problem('unavailable', response.status === 413 ? 'This report is too large to download here. Contact DPC for a complete export.' : 'Campaign results are unavailable. Try again shortly.');
  if (kind !== 'summary' && !/^text\/csv\b/i.test(response.headers.get('content-type') || '')) throw problem('unavailable');
  return { data, asOf: response.headers.get('x-report-as-of'), rows: response.headers.get('x-report-rows') };
}
function authFailure(error) {
  if (error.code === 'cancelled') return true;
  if (error.code === 'expired') { signedOut(error.message); return true; }
  if (error.code === 'forbidden') { invalidate(); show('denied'); return true; }
  return false;
}
function render(report) {
  const countNames = ['pickups', 'tastings', 'emails', 'repeatTasters', 'marketingContacts'];
  if (report.kind !== 'summary' || !Number.isFinite(Date.parse(report.asOf))
    || !countNames.every(k => Number.isSafeInteger(report[k]) && report[k] >= 0)
    || !Array.isArray(report.byRestaurantDate) || report.byRestaurantDate.length !== 20) throw Error('Invalid results');
  const grid = new Map();
  for (const row of report.byRestaurantDate) {
    const key = row.event_date + ':' + row.restaurant;
    if (!dates.includes(row.event_date) || !restaurants.includes(row.restaurant) || grid.has(key)
      || !Number.isSafeInteger(row.tastings) || row.tastings < 0) throw Error('Invalid results');
    grid.set(key, row.tastings);
  }
  if ([...grid.values()].reduce((a,b) => a+b, 0) !== report.tastings) throw Error('Invalid totals');
  for (const name of countNames) $('count-' + name).textContent = number.format(report[name]);
  const totals = restaurants.map(() => 0);
  const rows = dates.map(date => {
    const row = document.createElement('tr'), heading = document.createElement('th');
    heading.scope = 'row'; heading.textContent = day.format(new Date(date + 'T12:00:00Z')); row.append(heading);
    let sum = 0;
    restaurants.forEach((restaurant, i) => {
      const value = grid.get(date + ':' + restaurant), cell = document.createElement('td');
      cell.textContent = number.format(value); row.append(cell); totals[i] += value; sum += value;
    });
    const cell = document.createElement('td'); cell.textContent = number.format(sum); row.append(cell); return row;
  });
  const totalRow = document.createElement('tr'), label = document.createElement('th'); label.scope = 'row'; label.textContent = 'All tasting dates'; totalRow.append(label);
  for (const n of [...totals, report.tastings]) { const cell = document.createElement('td'); cell.textContent = number.format(n); totalRow.append(cell); }
  $('tasting-rows').replaceChildren(...rows); $('tasting-totals').replaceChildren(totalRow);
  $('empty').hidden = report.pickups + report.tastings !== 0;
  $('load-status').textContent = 'Updated ' + timestamp.format(new Date(report.asOf)); $('report').hidden = false;
}
async function loadReport() {
  if (!session) return;
  const restoreRefreshFocus = document.activeElement === $('refresh');
  const sequence = ++loadSequence; show('results'); clearReport();
  $('load-error').hidden = true; $('load-status').textContent = 'Loading saved records…'; $('refresh').disabled = true;
  try {
    const { data } = await privateRequest('summary'); if (sequence !== loadSequence) return;
    render(data);
  } catch (error) {
    if (sequence !== loadSequence || authFailure(error)) return;
    clearReport(); $('load-status').textContent = '';
    $('load-error').textContent = 'Campaign results are unavailable. Select Refresh results to try again.'; $('load-error').hidden = false;
  } finally {
    if (sequence === loadSequence) {
      $('refresh').disabled = false;
      if (restoreRefreshFocus && document.activeElement === document.body && !$('results').hidden) $('refresh').focus({ preventScroll: true });
    }
  }
}
async function bootstrap() {
  invalidate(); show('boot'); $('boot-retry').hidden = true; $('boot-message').textContent = 'Loading your workspace…';
  const current = generation;
  try {
    const { response, data: config } = await fetchTimed('/api/glass-reporting?kind=config');
    if (current !== generation) return;
    if (!response.ok || !config.configured || !config.supabaseUrl || !config.supabaseAnonKey) throw Error('Config unavailable');
    cfg = config; session = storedSession();
    $('environment').textContent = cfg.projectRef === 'hohbsqkmrlhkstojfdgx' ? '· Staging data' : '';
    if (!session) { show('sign-in'); return; }
    await loadReport();
  } catch { if (current === generation) { $('boot-message').textContent = 'Campaign results are unavailable. Try again shortly.'; $('boot-retry').hidden = false; } }
}
$('login-form').addEventListener('submit', async event => {
  event.preventDefault(); if (!$('login-form').reportValidity()) return;
  invalidate(); const current = generation; $('login-submit').disabled = true; $('login-submit').textContent = 'Signing in…'; $('sign-in-message').hidden = true;
  try {
    await grant('password', { email: $('email').value.trim(), password: $('password').value }, current);
    $('password').value = ''; await loadReport();
  } catch (error) {
    if (current !== generation || authFailure(error)) return;
    $('sign-in-message').textContent = error.code === 'login' ? error.message : 'Could not connect. Try signing in again.'; $('sign-in-message').hidden = false;
  } finally { $('login-submit').disabled = false; $('login-submit').textContent = 'Sign in'; }
});
$('sign-out').addEventListener('click', () => {
  const token = session?.access_token; signedOut();
  if (token) fetch(cfg.supabaseUrl + '/auth/v1/logout', { method: 'POST', headers: { apikey: cfg.supabaseAnonKey, Authorization: 'Bearer ' + token }, credentials: 'omit' }).catch(() => {});
});
$('refresh').addEventListener('click', loadReport); $('boot-retry').addEventListener('click', bootstrap);
for (const button of document.querySelectorAll('[data-download]')) button.addEventListener('click', async () => {
  const current = generation, label = button.textContent;
  button.disabled = true; button.textContent = 'Preparing CSV…'; $('download-error').hidden = true; $('download-status').textContent = '';
  try {
    const { data, asOf, rows } = await privateRequest(button.dataset.download);
    if (current !== generation) return;
    const url = URL.createObjectURL(data); downloads.add(url);
    const link = document.createElement('a'); link.href = url; link.download = 'glass-' + button.dataset.download + '.csv'; document.body.append(link); link.click(); link.remove();
    setTimeout(() => { URL.revokeObjectURL(url); downloads.delete(url); }, 1000);
    $('download-status').textContent = 'Downloaded ' + (rows || '') + (rows === '1' ? ' row' : ' rows') + (Number.isFinite(Date.parse(asOf)) ? ' · ' + timestamp.format(new Date(asOf)) : '') + '.';
  } catch (error) {
    if (current !== generation || authFailure(error)) return;
    $('download-error').textContent = error.code === 'unavailable' && error.message
      ? error.message : 'Could not download the complete report. Try again.'; $('download-error').hidden = false;
  } finally { button.disabled = false; button.textContent = label; }
});
window.addEventListener('storage', event => { if (event.key === sessionKey) bootstrap(); });
window.addEventListener('pagehide', () => { invalidate(); $('results').hidden = true; });
window.addEventListener('pageshow', event => { if (event.persisted) bootstrap(); });
// Returning from a tab or save dialog preserves the current snapshot/download.
// The timestamp and Refresh results control let the admin request newer counts.
bootstrap();
