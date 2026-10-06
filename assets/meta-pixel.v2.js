(function (window, document) {
  'use strict';

  var PIXEL_ID = '28569583012647858';
  var SDK_URL = 'https://connect.facebook.net/en_US/fbevents.js';
  var ALLOWED_PATHS = Object.freeze(['/', '/join', '/subscription-success']);
  var ALLOWED_EVENTS = Object.freeze(['PageView']);
  var sdkRequested = false;
  var tracked = Object.create(null);

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

  function trackOnce(eventName) {
    if (!sdkRequested || typeof window.fbq !== 'function' || !canTrack(eventName)) return false;
    var key = eventName + ':' + normalizedPath();
    if (tracked[key]) return false;
    if (!scrubCurrentUrl()) return false;
    tracked[key] = true;
    window.fbq('track', eventName);
    return true;
  }

  function requestSdk() {
    if (sdkRequested || !canTrack('PageView') || !scrubCurrentUrl()) return false;
    sdkRequested = true;
    var fbq = installQueue();
    fbq.disablePushState = true;
    // No advanced matching data. Disable Meta's automatic page/button/form
    // configuration; this integration's event allowlist is PageView only.
    fbq('set', 'autoConfig', false, PIXEL_ID);
    fbq('init', PIXEL_ID);

    var script = document.createElement('script');
    script.async = true;
    script.src = SDK_URL;
    script.referrerPolicy = 'no-referrer';
    script.onload = function () { trackOnce('PageView'); };
    script.onerror = function () { sdkRequested = false; };
    var firstScript = document.getElementsByTagName('script')[0];
    if (!firstScript || !firstScript.parentNode) {
      sdkRequested = false;
      return false;
    }
    firstScript.parentNode.insertBefore(script, firstScript);
    return true;
  }

  function init() {
    requestSdk();
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
    if (sdkRequested && window.fbq && !privacyAllowsAdvertising()) window.fbq('consent', 'revoke');
  });
  // The SDK also emits on bfcache restores independently of disablePushState.
  // This listener runs before the SDK's and keeps restored documents silent.
  window.addEventListener('pageshow', function (event) {
    if (event.persisted && sdkRequested && window.fbq) window.fbq('consent', 'revoke');
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window, document);
