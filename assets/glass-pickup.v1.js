(() => {
  const $ = id => document.getElementById(id);
  const form = $('pickup-form');
  let changed = false;
  let pending = null;
  let submitting = false;
  let confirmed = false;
  let refreshTimer;
  const unavailable = 'Pickup check-in is unavailable right now. Please try again or ask the person handing out glasses for the paper option.';
  const day = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long' });
  const date = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric' });

  function renderSchedule(schedule) {
    if (!schedule || !Array.isArray(schedule.dates) || typeof schedule.ended !== 'boolean') throw new Error('schedule');
    $('dates').replaceChildren();
    for (const value of schedule.dates) {
      const d = new Date(value + 'T12:00:00Z');
      const li = document.createElement('li');
      const label = document.createElement('time'); label.dateTime = value; label.textContent = date.format(d);
      const weekday = document.createElement('span'); weekday.textContent = day.format(d);
      li.append(label, weekday); $('dates').append(li);
    }
    $('tasting-title').textContent = schedule.ended ? 'The tastings have ended.' : 'Bring it back for a taste.';
    $('tasting-description').textContent = schedule.ended
      ? 'The Glass Comes Back tastings ended on October 14, 2026. You can still pick up a complimentary DPC glass while supplies last.'
      : 'The Glass Comes Back: bring your DPC glass for a complimentary taste of wine while dining at a participating restaurant.';
    for (const id of ['tasting-instructions', 'dates-title', 'dates', 'exclusion']) $(id).hidden = schedule.ended;
    $('tastings').hidden = false;
  }
  async function request(options) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch('/api/glass-pickup', { ...options, signal: controller.signal, cache: 'no-store', credentials: 'omit' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || unavailable);
      return data;
    } finally { clearTimeout(timer); }
  }
  async function availability() {
    clearTimeout(refreshTimer);
    try {
      const data = await request({ method: 'GET' });
      renderSchedule(data.schedule);
      if (!submitting) {
        $('submit').disabled = !data.available;
        $('submit').textContent = data.available ? 'Confirm glass pickup' : 'Check-in unavailable';
      }
      $('load-status').textContent = data.available || confirmed ? '' : unavailable;
      $('reload').hidden = data.available || confirmed;
    } catch {
      // Do not leave expired invitations visible when server time cannot refresh.
      $('tastings').hidden = true;
      if (!confirmed) {
        $('load-status').textContent = unavailable;
        $('reload').hidden = false;
        $('submit').disabled = true;
        $('submit').textContent = 'Check-in unavailable';
      }
    }
    // Re-check date after a long-lived page crosses a Pacific day boundary.
    refreshTimer = setTimeout(availability, 60000);
  }
  form.hidden = false;
  $('marketing').addEventListener('change', () => { changed = true; });
  $('reload').addEventListener('click', availability);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) availability(); });
  window.addEventListener('pageshow', availability);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (submitting || !form.reportValidity()) return;
    const intent = { email: $('email').value.trim().toLowerCase(), marketingOptIn: $('marketing').checked, marketingChanged: changed || !$('marketing').checked };
    const fingerprint = JSON.stringify(intent);
    if (!pending || pending.fingerprint !== fingerprint) pending = { fingerprint, requestId: crypto.randomUUID() };
    submitting = true;
    $('form-error').hidden = true; $('submit').disabled = true; $('submit').textContent = 'Recording your pickup…';
    try {
      const result = await request({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...intent, requestId: pending.requestId }) });
      if (result.success !== true) throw new Error(unavailable);
      renderSchedule(result.schedule);
      confirmed = true;
      $('form-panel').hidden = true; $('confirmation').hidden = false;
      $('pickup-title').textContent = 'A glass for your next visit.';
      $('pickup-intro').textContent = 'Thanks for being part of downtown Livermore.';
      $('confirmation-title').focus();
      // Contact data remains only in this form's memory until completion.
      form.reset(); pending = null; changed = false;
    } catch (error) {
      $('form-error').textContent = error.name === 'AbortError' ? 'Your connection took too long. Try again; a repeat submission will not add another pickup.' : unavailable;
      $('form-error').hidden = false;
    } finally {
      submitting = false; $('submit').disabled = false; $('submit').textContent = 'Confirm glass pickup';
    }
  });
  $('another').addEventListener('click', () => {
    confirmed = false; $('confirmation').hidden = true; $('form-panel').hidden = false;
    $('pickup-title').textContent = 'Pick up your free glass.';
    $('pickup-intro').textContent = 'Enter your email, then show your confirmation to the person handing out glasses.';
    $('email').focus(); availability();
  });
})();
