(() => {
  const $ = id => document.getElementById(id);
  const form = $('tasting-form');
  const restaurant = document.body.dataset.restaurant;
  const name = $('restaurant-name').textContent;
  const unavailable = 'Tasting check-in is unavailable right now. Please try again or ask restaurant staff for the paper option.';
  const displayDate = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const displayDay = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long' });
  const pacificDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' });
  let state, receipt, pending, refreshTimer, expiryTimer;
  let changed = false, submitting = false, sequence = 0;
  const dateLabel = value => displayDate.format(new Date(value + 'T12:00:00Z'));
  function hideReceipt() { $('confirmation').hidden = true; $('form-panel').hidden = false; }
  function clearReceipt() { receipt = null; pending = null; clearTimeout(expiryTimer); hideReceipt(); }
  function showValidReceipt() {
    if (!receipt) return false;
    // The server supplies the duration. Relative wall time also catches device
    // sleep on browsers whose monotonic clock pauses; neither clock can extend it.
    if (performance.now() >= receipt.deadline || Date.now() >= receipt.wallDeadline) {
      clearReceipt(); return false;
    }
    $('form-panel').hidden = true; $('confirmation').hidden = false;
    return true;
  }
  function expireReceipt() {
    clearReceipt();
    $('load-status').textContent = 'This confirmation has expired. Check in again on an eligible tasting date.';
    $('submit').disabled = true;
    availability();
  }
  function validRestaurant(value) { return value?.slug === restaurant && value.name === name; }
  async function request(options) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    const start = performance.now();
    try {
      const response = await fetch('/api/glass-tasting?restaurant=' + encodeURIComponent(restaurant), {
        ...options, signal: controller.signal, cache: 'no-store', credentials: 'omit',
      });
      const data = await response.json();
      if (!response.ok) {
        const error = new Error(typeof data.message === 'string' ? data.message : unavailable);
        error.status = response.status; throw error;
      }
      return { data, elapsed: performance.now() - start };
    } finally { clearTimeout(timer); }
  }
  async function availability() {
    clearTimeout(refreshTimer);
    if (submitting) { refreshTimer = setTimeout(availability, 1000); return; }
    const current = ++sequence;
    showValidReceipt();
    $('submit').disabled = true;
    try {
      const { data } = await request({ method: 'GET' });
      if (current !== sequence || submitting) return;
      if (!validRestaurant(data.restaurant) || typeof data.available !== 'boolean' || typeof data.enabled !== 'boolean'
        || !Array.isArray(data.schedule?.dates) || !/^\d{4}-\d{2}-\d{2}$/.test(data.schedule.today)
        || !Number.isFinite(Date.parse(data.serverNow))) throw new Error('availability');
      state = data;
      if (receipt && (receipt.date !== state.schedule.today || !state.available)) clearReceipt();
      form.hidden = state.enabled && !state.available;
      $('submit').disabled = !state.available;
      $('submit').textContent = state.available ? 'Confirm tasting check-in' : 'Check-in unavailable';
      $('reload').hidden = state.enabled;
      const next = state.schedule.dates[0];
      $('load-status').textContent = !state.enabled ? unavailable : state.schedule.ended
        ? 'These tastings have ended. Glass pickup is still available while supplies last.'
        : state.available ? 'Tasting today · ' + dateLabel(state.schedule.today)
        : next ? 'See you ' + displayDay.format(new Date(next + 'T12:00:00Z')) + '. The next tasting is ' + dateLabel(next) + ', during normal dining hours.' : 'No tasting is scheduled today.';
      $('tasting-intro').hidden = state.enabled && !state.available;
      $('tasting-rule').hidden = state.schedule.ended;
      $('paper-option').hidden = state.schedule.ended;
      $('same-visit').hidden = state.schedule.ended;
      $('pickup-link').hidden = !state.schedule.ended;
      $('schedule-note').textContent = state.schedule.ended ? 'These tasting dates have ended. Thank you for joining us.'
        : 'Bring your DPC glass and dine here on a tasting date during normal dining hours.';
      showValidReceipt();
    } catch {
      if (current !== sequence || submitting) return;
      state = null; form.hidden = false; if (!showValidReceipt()) hideReceipt();
      $('submit').disabled = true; $('submit').textContent = 'Check-in unavailable';
      $('load-status').textContent = unavailable; $('reload').hidden = false;
    } finally {
      if (current === sequence) refreshTimer = setTimeout(availability, 60000);
    }
  }
  form.hidden = false;
  $('load-status').textContent = "Checking today's tasting availability…";
  $('marketing').addEventListener('change', () => { changed = true; });
  $('reload').addEventListener('click', availability);
  window.addEventListener('pageshow', availability);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) availability(); });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (submitting || !state?.available || !form.reportValidity()) return;
    const intent = { restaurant, email: $('email').value.trim().toLowerCase(), marketingOptIn: $('marketing').checked, marketingChanged: changed || !$('marketing').checked };
    const fingerprint = JSON.stringify({ ...intent, date: state.schedule.today });
    if (!pending || pending.fingerprint !== fingerprint) pending = { fingerprint, requestId: crypto.randomUUID() };
    submitting = true; ++sequence; clearTimeout(refreshTimer);
    $('form-error').hidden = true; $('submit').disabled = true; $('submit').textContent = 'Recording your tasting…';
    try {
      const { data, elapsed } = await request({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...intent, requestId: pending.requestId }) });
      const now = Date.parse(data.serverNow), until = Date.parse(data.validUntil);
      const remaining = until - now - elapsed;
      if (data.success !== true || !validRestaurant(data.restaurant) || !/^\d{4}-\d{2}-\d{2}$/.test(data.date)
        || !Number.isFinite(now) || !Number.isFinite(until) || remaining <= 0 || remaining > 86400000
        || pacificDate.format(new Date(now)) !== data.date) throw new Error(unavailable);
      receipt = { date: data.date, deadline: performance.now() + remaining, wallDeadline: Date.now() + remaining };
      $('confirmation-date').dateTime = data.date; $('confirmation-date').textContent = dateLabel(data.date);
      $('form-panel').hidden = true; $('confirmation').hidden = document.hidden;
      if (!document.hidden) $('confirmation-title').focus();
      clearTimeout(expiryTimer); expiryTimer = setTimeout(expireReceipt, remaining);
      form.reset(); pending = null; changed = false;
    } catch (error) {
      if (error.status === 409) { pending = null; state = null; }
      $('form-error').textContent = error.name === 'AbortError'
        ? 'Your connection took too long. Try again; a repeat submission will not add another tasting.'
        : [400, 403, 404, 409, 413, 415, 429].includes(error.status) ? error.message : unavailable;
      $('form-error').hidden = false;
    } finally {
      submitting = false; $('submit').disabled = !state?.available; $('submit').textContent = 'Confirm tasting check-in';
      refreshTimer = setTimeout(availability, state ? 60000 : 0);
    }
  });
  $('another').addEventListener('click', () => {
    receipt = null; pending = null; changed = false; clearTimeout(expiryTimer);
    form.reset(); hideReceipt(); $('email').focus(); availability();
  });
})();
