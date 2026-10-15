(function (window, document) {
  'use strict';
  var ID = /^cs_(live|test)_[A-Za-z0-9]{20,240}$/;
  var sessionId = '';
  var returnState = Object.assign({}, window.history.state || {});
  // Runs before advertising, fonts or other page resources. The header and meta
  // referrer policy also protect the initial request while this script loads.
  try {
    var params = new URLSearchParams(window.location.search);
    var ids = params.getAll('session_id');
    if (ids.length === 1 && ID.test(ids[0])) {
      sessionId = ids[0];
      returnState.dpcWelcomeSessionId = sessionId;
    } else if (!window.location.search && !window.location.hash) {
      // A fresh bare /welcome visit must not display a previous purchase. Only
      // reload/Back may restore the reference removed from this tab's URL.
      var navigation = window.performance.getEntriesByType('navigation')[0];
      if (navigation && ['reload', 'back_forward'].indexOf(navigation.type) !== -1) {
        if (ID.test(returnState.dpcWelcomeSessionId || '')) sessionId = returnState.dpcWelcomeSessionId;
      }
    }
    if (!sessionId) delete returnState.dpcWelcomeSessionId;
    window.history.replaceState(returnState, '', '/welcome');
  } catch (e) {}

  function init() {
    var title = document.getElementById('welcome-title');
    var message = document.getElementById('welcome-message');
    var next = document.getElementById('welcome-next');
    var kit = document.getElementById('welcome-kit');
    var retry = document.getElementById('welcome-retry');
    var panel = document.getElementById('welcome-status');
    var busy = false;

    function show(heading, copy, canRetry) {
      title.textContent = heading;
      message.textContent = copy;
      retry.hidden = !canRetry;
    }
    function validSummary(data) {
      return data && data.status === 'paid'
        && ['tap', 'cellar', 'reserve'].indexOf(data.circle) !== -1
        && ['monthly', 'annual'].indexOf(data.billingInterval) !== -1
        && data.currency === 'usd' && typeof data.livemode === 'boolean'
        && data.livemode === sessionId.startsWith('cs_live_')
        && typeof data.welcomeKit === 'boolean'
        && typeof data.eventId === 'string' && /^(?!cs_(?:live|test)_)[A-Za-z0-9_-]{43}$/.test(data.eventId)
        && Number.isSafeInteger(data.amountPaid) && data.amountPaid >= 0 && data.amountPaid <= 99999999;
    }
    async function verify() {
      if (busy || !sessionId) return;
      busy = true;
      retry.disabled = true;
      panel.setAttribute('aria-busy', 'true');
      show('Checking your payment.', 'This should only take a moment.', false);
      var controller = new AbortController();
      var timeout = window.setTimeout(function () { controller.abort(); }, 8000);
      try {
        var response = await window.fetch('/api/welcome-checkout', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: sessionId }), signal: controller.signal,
          cache: 'no-store', credentials: 'same-origin', referrerPolicy: 'no-referrer'
        });
        if (!response.ok) throw new Error('unavailable');
        var data = await response.json();
        if (data.status === 'pending') {
          show('Payment isn’t confirmed yet.', 'We haven’t confirmed payment yet. Check again in a moment or watch your inbox for confirmation.', true);
        } else if (validSummary(data)) {
          show('You are in.', 'Your setup email is on the way. If it isn’t there in five minutes, check spam, then email us.', false);
          next.hidden = false;
          kit.hidden = !data.welcomeKit;
          // The paid summary came from the same-origin verifier, never the URL.
          // The pixel independently validates fields, privacy and deduplication.
          if (window.DPCMetaPixel) window.DPCMetaPixel.track('Purchase', {
            status: data.status, circle: data.circle, billingInterval: data.billingInterval,
            amountPaid: data.amountPaid, currency: data.currency, livemode: data.livemode,
            eventId: data.eventId
          });
        } else throw new Error('unavailable');
      } catch (e) {
        show('We couldn’t confirm this checkout.', 'If you’ve already paid, check your confirmation email. You can try this check again or email us for help.', true);
      } finally {
        window.clearTimeout(timeout);
        busy = false;
        retry.disabled = false;
        panel.setAttribute('aria-busy', 'false');
      }
    }
    retry.addEventListener('click', verify);
    if (sessionId) verify();
    else show('Looking for your membership confirmation?', 'If you’ve completed checkout, check your email for your membership confirmation, app download links, and sign-in instructions. Check spam if you don’t see it, or email us for help.', false);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window, document);
