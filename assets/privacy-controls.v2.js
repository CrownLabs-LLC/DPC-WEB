(function (window, document) {
  'use strict';

  // Advertising stays off unless an eligible page explicitly opts in through
  // the reviewed HTML launch switch. Missing, unreadable and unknown values
  // fail closed.
  var KEY = 'dpc_advertising_opt_out';
  var optedOutThisPage = false;

  function advertisingEnabled() {
    try {
      var config = document.querySelector('meta[name="dpc-advertising-enabled"]');
      return !!config && config.getAttribute('content') === 'true';
    } catch (e) {
      return false;
    }
  }

  function gpcEnabled() {
    try { return window.navigator.globalPrivacyControl === true; }
    catch (e) { return true; } // An unreadable privacy signal never permits advertising.
  }

  function savedPreference() {
    var cookie = false;
    var local = false;
    var cookieReadable = false;
    var localReadable = false;
    try {
      cookie = document.cookie.split(';').some(function (part) {
        return part.trim() === KEY + '=1';
      });
      cookieReadable = true;
    } catch (e) {}
    try {
      local = window.localStorage.getItem(KEY) === '1';
      localReadable = true;
    } catch (e) {}
    return { cookie: cookie, local: local, readable: cookieReadable || localReadable };
  }

  function persistOptOut() {
    optedOutThisPage = true;
    try { window.localStorage.setItem(KEY, '1'); } catch (e) {}
    try {
      // Share the preference across the production www and apex hostnames only.
      var host = window.location.hostname;
      var domain = host === 'downtownpourcollective.com' || host === 'www.downtownpourcollective.com'
        ? '; Domain=downtownpourcollective.com' : '';
      document.cookie = KEY + '=1; Path=/; Max-Age=31536000; SameSite=Lax' + domain +
        (window.location.protocol === 'https:' ? '; Secure' : '');
    } catch (e) {}
  }

  function getState() {
    var saved = savedPreference();
    var gpc = gpcEnabled();
    return {
      gpc: gpc,
      optedOut: gpc || optedOutThisPage || saved.cookie || saved.local,
      saved: saved.cookie || saved.local,
      storageReadable: saved.readable,
      advertisingEnabled: advertisingEnabled()
    };
  }

  function canLoadAdvertising() {
    // Call this at every advertising load/event boundary, not just page init.
    var state = getState();
    return state.advertisingEnabled && state.storageReadable && !state.optedOut;
  }

  function render() {
    var status = document.getElementById('privacy-choice-status');
    var button = document.getElementById('privacy-opt-out');
    if (!status || !button) return;
    var state = getState();
    var message = state.advertisingEnabled
      ? 'No advertising opt-out is saved in this browser. Advertising sharing may occur on eligible website pages.'
      : 'No advertising opt-out is saved in this browser yet. Advertising tracking is currently off for everyone.';
    if (state.gpc) {
      message = 'Global Privacy Control is on. We are treating your browser’s signal as an opt-out of advertising sharing.';
      message += state.saved ? ' Your opt-out is also saved in this browser.' : ' Your browser did not let us save it for future visits; keep Global Privacy Control on.';
    } else if (state.optedOut) {
      message = state.saved
        ? 'Your advertising opt-out is saved in this browser.'
        : 'Your opt-out applies on this page, but your browser did not let us save it for future visits. Allow site storage and try again, or keep Global Privacy Control on.';
    }
    status.textContent = message;
    button.hidden = false;
    // Keep the button focusable after activation, with a clear saved state.
    button.setAttribute('aria-disabled', state.saved || state.gpc ? 'true' : 'false');
    button.textContent = state.saved || state.gpc ? 'Advertising sharing opted out' : 'Opt out of advertising sharing';

    var note = document.getElementById('advertising-status-note');
    if (note) {
      note.textContent = state.advertisingEnabled
        ? 'Meta/Facebook advertising tracking is enabled only on eligible website pages when this browser has not opted out and Global Privacy Control is off.'
        : 'Meta/Facebook advertising tracking is not currently enabled on this website. You can still save your opt-out now.';
    }
  }

  function notify() {
    render();
    window.dispatchEvent(new window.CustomEvent('dpc:privacy-change', { detail: getState() }));
  }

  function optOut() {
    persistOptOut();
    notify();
    return getState();
  }

  function refresh() {
    // GPC is authoritative and sticky: disabling the signal later does not opt back in.
    if (gpcEnabled()) persistOptOut();
    notify();
  }

  window.DPCPrivacy = Object.freeze({
    getState: getState,
    optOut: optOut,
    canLoadAdvertising: canLoadAdvertising
  });
  if (gpcEnabled()) persistOptOut();
  window.addEventListener('storage', function (event) {
    if (event.key === KEY || event.key === null) refresh();
  });
  window.addEventListener('pageshow', refresh);
  window.addEventListener('focus', refresh);

  function reserveCookieNoticeSpace() {
    var banner = document.getElementById('cookie-banner');
    if (!banner) return;
    function measure() {
      var rect = banner.getBoundingClientRect();
      var clearance = banner.hidden ? 0 : Math.ceil(rect.height + Math.max(0, window.innerHeight - rect.bottom));
      document.documentElement.style.setProperty('--dpc-cookie-clearance', clearance + 'px');
    }
    // Keep the privacy link reachable without requiring analytics acceptance,
    // including when the fixed notice wraps after a resize or font load.
    measure();
    if (window.ResizeObserver) new window.ResizeObserver(measure).observe(banner);
    if (window.MutationObserver) new window.MutationObserver(measure).observe(banner, { attributes: true, attributeFilter: ['hidden'] });
    window.addEventListener('resize', measure);
  }

  function init() {
    var button = document.getElementById('privacy-opt-out');
    if (button) button.addEventListener('click', function () {
      if (button.getAttribute('aria-disabled') !== 'true') optOut();
    });
    render();
    reserveCookieNoticeSpace();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window, document);
