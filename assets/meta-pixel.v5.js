(function (window, document) {
  'use strict';

  var PIXEL_ID = '28569583012647858';
  var SDK_URL = 'https://connect.facebook.net/en_US/fbevents.js';
  var ALLOWED_PATHS = Object.freeze(['/', '/join', '/subscription-success', '/welcome']);
  var ALLOWED_EVENTS = Object.freeze(['PageView', 'ViewContent', 'JoinCheckoutClick', 'InitiateCheckout', 'Purchase']);
  var sdkRequested = false;
  var sdkLoaded = false;
  var revoked = false;
  var tracked = Object.create(null);
  var pending = Object.create(null);

  // Preserve ad attribution without forwarding arbitrary query values. Campaign
  // fields use platform IDs, never free-text names or customer information.
  var ATTRIBUTION_PARAMS = {
    fbclid: /^[A-Za-z0-9_-]{20,500}$/,
    utm_source: /^(meta|facebook|instagram|fb|ig)$/,
    utm_medium: /^(paid_social|cpc)$/,
    utm_id: /^[0-9]{1,32}$/,
    utm_campaign: /^[0-9]{1,32}$/,
    utm_content: /^[0-9]{1,32}$/,
    utm_term: /^[0-9]{1,32}$/
  };

  function safeSearch(search) {
    var input = new URLSearchParams(search);
    var output = new URLSearchParams();
    Object.keys(ATTRIBUTION_PARAMS).forEach(function (key) {
      var values = input.getAll(key);
      if (values.length === 1 && ATTRIBUTION_PARAMS[key].test(values[0])) {
        output.set(key, values[0]);
      }
    });
    var query = output.toString();
    return query ? '?' + query : '';
  }

  function normalizedPath() {
    var path = window.location.pathname || '/';
    if (path.length > 1 && path.charAt(path.length - 1) === '/') path = path.slice(0, -1);
    return path;
  }

  function pathAllowed(path) {
    return ALLOWED_PATHS.indexOf(path) !== -1;
  }

  function productionHostAllowed() {
    return window.location.protocol === 'https:' &&
      (window.location.hostname === 'www.downtownpourcollective.com' ||
        window.location.hostname === 'downtownpourcollective.com');
  }

  function privacyAllowsAdvertising() {
    try {
      return !!window.DPCPrivacy && window.DPCPrivacy.canLoadAdvertising() === true;
    } catch (e) {
      return false;
    }
  }

  function referrerIsSafe() {
    if (!document.referrer) return true;
    try {
      var referrer = new URL(document.referrer);
      if (referrer.username || referrer.password || referrer.hash) return false;
      if (decodeURIComponent(referrer.pathname).indexOf('@') !== -1) return false;
      if (referrer.origin === window.location.origin) {
        if (!pathAllowed(referrer.pathname || '/')) return false;
        // Compare decoded entries so harmless parameter ordering is accepted;
        // duplicate, unknown and invalid values still fail closed.
        var original = new URLSearchParams(referrer.search);
        var allowed = new URLSearchParams(safeSearch(referrer.search));
        original.sort();
        allowed.sort();
        return original.toString() === allowed.toString();
      }
      if (referrer.search) return false;
      // Cross-site referrers are accepted only at their origin root. Anything
      // more specific fails closed rather than risking an identifier in a path.
      return referrer.pathname === '/' || referrer.pathname === '';
    } catch (e) {
      return false;
    }
  }

  function canTrack(eventName) {
    return ALLOWED_EVENTS.indexOf(eventName) !== -1 &&
      !revoked &&
      (eventName === 'PageView' || (eventName === 'Purchase' ? normalizedPath() === '/welcome' : normalizedPath() === '/join')) &&
      productionHostAllowed() &&
      pathAllowed(normalizedPath()) &&
      referrerIsSafe() &&
      privacyAllowsAdvertising();
  }

  function scrubCurrentUrl() {
    try {
      var search = safeSearch(window.location.search);
      if (window.location.search === search && !window.location.hash) return true;
      window.history.replaceState(window.history.state, document.title, normalizedPath() + search);
      return window.location.search === search && !window.location.hash;
    } catch (e) {
      return false;
    }
  }

  function installQueue() {
    if (window.fbq) return window.fbq;
    var fbq = function () {
      if (fbq.callMethod) fbq.callMethod.apply(fbq, arguments);
      else fbq.queue.push(arguments);
    };
    if (!window._fbq) window._fbq = fbq;
    fbq.push = fbq;
    fbq.loaded = true;
    fbq.version = '2.0';
    fbq.queue = [];
    window.fbq = fbq;
    return fbq;
  }

  // Only catalog choices enter event parameters. Amounts are derived here;
  // arbitrary values, URLs, customer fields and consent evidence never pass through.
  var CIRCLES = ['tap', 'cellar', 'reserve'];
  var BILLING = ['monthly', 'annual'];
  var PRICES = {
    tap: { monthly: 59, annual: 590 },
    cellar: { monthly: 69, annual: 690 },
    reserve: { monthly: 79, annual: 790 }
  };

  function eventSelection(eventName, input) {
    input = input || {};
    var circle = CIRCLES.indexOf(input.circle) !== -1 ? input.circle : '';
    if (eventName === 'Purchase') {
      if (!circle || BILLING.indexOf(input.billingInterval) === -1 || input.livemode !== true
        || input.status !== 'paid' || input.currency !== 'usd'
        || typeof input.sessionId !== 'string' || !/^cs_live_[A-Za-z0-9]{20,240}$/.test(input.sessionId)
        || !Number.isSafeInteger(input.amountPaid) || input.amountPaid < 0 || input.amountPaid > 99999999) return null;
      return { circle: circle, billingInterval: input.billingInterval, amountPaid: input.amountPaid,
        currency: 'usd', status: 'paid', livemode: true, sessionId: input.sessionId };
    }
    if (eventName === 'ViewContent') return circle ? { circle: circle } : {};
    if (eventName === 'InitiateCheckout') {
      if (!circle || BILLING.indexOf(input.billingInterval) === -1) return null;
      return { circle: circle, billingInterval: input.billingInterval };
    }
    return {};
  }

  function eventParameters(eventName, selection) {
    if (eventName === 'ViewContent') {
      var params = { content_name: 'membership' };
      if (selection.circle) params.content_category = selection.circle;
      return params;
    }
    if (eventName === 'InitiateCheckout') return {
      content_name: selection.circle + '_' + selection.billingInterval,
      value: PRICES[selection.circle][selection.billingInterval],
      currency: 'USD'
    };
    if (eventName === 'Purchase') return {
      content_name: selection.circle + '_' + selection.billingInterval,
      value: selection.amountPaid / 100, currency: 'USD'
    };
    return null;
  }

  function trackOnce(eventName, input) {
    if (!sdkRequested || typeof window.fbq !== 'function' || !canTrack(eventName)) return false;
    var selection = eventSelection(eventName, input);
    if (!selection) return false;
    var key = eventName + ':' + normalizedPath();
    if (tracked[key] || pending[eventName]) return false;
    if (!scrubCurrentUrl()) return false;
    // Hold one sanitized catalog selection per event while the SDK loads.
    // Putting events in fbq's queue could flush them before a later revoke.
    if (!sdkLoaded) {
      pending[eventName] = selection;
      return true;
    }
    if (eventName === 'Purchase') {
      // Fail closed if the once-per-session guard cannot be read and persisted.
      // Mark only at actual SDK dispatch, never while queued or opted out.
      try {
        var purchaseKey = 'dpc_purchase:' + selection.sessionId;
        if (window.sessionStorage.getItem(purchaseKey)) return false;
        window.sessionStorage.setItem(purchaseKey, '1');
        if (window.sessionStorage.getItem(purchaseKey) !== '1') return false;
      } catch (e) { return false; }
    }
    tracked[key] = true;
    var params = eventParameters(eventName, selection);
    if (eventName === 'Purchase') window.fbq('track', eventName, params, { eventID: selection.sessionId });
    else if (params) window.fbq('track', eventName, params);
    else window.fbq(eventName === 'JoinCheckoutClick' ? 'trackCustom' : 'track', eventName);
    return true;
  }

  function requestSdk() {
    if (sdkRequested || !canTrack('PageView') || !scrubCurrentUrl()) return false;
    sdkRequested = true;
    var fbq = installQueue();
    fbq.disablePushState = true;
    // No advanced matching data. Disable Meta's automatic page/button/form
    // configuration. Only our explicit allowlist can emit events.
    fbq('set', 'autoConfig', false, PIXEL_ID);
    fbq('init', PIXEL_ID);

    var script = document.createElement('script');
    script.async = true;
    script.src = SDK_URL;
    script.referrerPolicy = 'no-referrer';
    script.onload = function () {
      sdkLoaded = true;
      var waiting = pending;
      pending = Object.create(null);
      trackOnce('PageView');
      ['ViewContent', 'JoinCheckoutClick', 'InitiateCheckout', 'Purchase'].forEach(function (eventName) {
        if (waiting[eventName]) trackOnce(eventName, waiting[eventName]);
      });
    };
    script.onerror = function () {
      sdkRequested = false;
      pending = Object.create(null);
    };
    var firstScript = document.getElementsByTagName('script')[0];
    if (!firstScript || !firstScript.parentNode) {
      sdkRequested = false;
      return false;
    }
    firstScript.parentNode.insertBefore(script, firstScript);
    return true;
  }

  function init() {
    if (!requestSdk() || normalizedPath() !== '/join') return;
    // Join applies link defaults before DOMContentLoaded. Read the displayed
    // catalog choice, not arbitrary query text, and snapshot it before interaction.
    var circle = document.querySelector('#join-form input[name="circle"]:checked');
    trackOnce('ViewContent', { circle: circle ? circle.value : '' });
  }

  window.DPCMetaPixel = Object.freeze({
    getState: function () {
      return {
        enabled: privacyAllowsAdvertising(),
        eligiblePath: pathAllowed(normalizedPath()),
        sdkRequested: sdkRequested,
        pixelId: PIXEL_ID,
        allowedEvents: ALLOWED_EVENTS.slice()
      };
    },
    track: trackOnce
  });

  // Revoke SDK consent as well as closing our gate, including while it loads.
  // Never grant again within this document or load after an initially blocked visit.
  window.addEventListener('dpc:privacy-change', function () {
    if (sdkRequested && window.fbq && !privacyAllowsAdvertising()) {
      revoked = true;
      pending = Object.create(null);
      window.fbq('consent', 'revoke');
    }
  });
  // The SDK also emits on bfcache restores independently of disablePushState.
  // This listener runs before the SDK's and keeps restored documents silent.
  window.addEventListener('pageshow', function (event) {
    if (event.persisted && sdkRequested && window.fbq) {
      revoked = true;
      pending = Object.create(null);
      window.fbq('consent', 'revoke');
    }
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window, document);
