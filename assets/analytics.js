(function (window, document) {
  'use strict';

  var GA_ID = 'G-C7CCW2YLPH';
  var CONSENT_KEY = 'dpc_cookie_consent';
  var LEGACY_CONSENT_KEY = 'dpc_partner_cookie_consent';
  var DEPOSIT_TRACKED_KEY = 'dpc_deposit_tracked';
  var DEPOSIT_BEACON_KEY = 'dpc_deposit_beacon';
  var TRACK_ENDPOINT = '/api/track';
  var gaLoaded = false;
  var pageInitDone = false;
  var currentPageConfig = null;

  // First-party ops beacon (feeds the /dashboard funnel). Anonymous — event
  // name, page label, path, referrer, sanitized join failure code/status, and
  // a random one-attempt flow ID only — so it is not consent-gated the way GA4 is. Fire-and-forget: never
  // throws, never blocks navigation.
  function sendEvent(event, params) {
    params = params || {};
    var status = Number(params.http_status);
    try {
      var payload = JSON.stringify({
        event: event,
        page: (currentPageConfig && currentPageConfig.page) || '',
        path: window.location.pathname,
        referrer: document.referrer || '',
        error_code: typeof params.error_code === 'string' ? params.error_code.slice(0, 100) : null,
        http_status: Number.isInteger(status) && status >= 100 && status <= 599 ? status : null,
        flow_id: typeof params.flow_id === 'string' ? params.flow_id.slice(0, 36) : null
      });
      if (navigator.sendBeacon) {
        navigator.sendBeacon(TRACK_ENDPOINT, new Blob([payload], { type: 'application/json' }));
      } else if (window.fetch) {
        fetch(TRACK_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
          keepalive: true
        }).catch(function () {});
      }
    } catch (e) {}
  }

  function hasConsent() {
    try {
      if (localStorage.getItem(CONSENT_KEY) === '1') return true;
      if (localStorage.getItem(LEGACY_CONSENT_KEY) === '1') {
        localStorage.setItem(CONSENT_KEY, '1');
        return true;
      }
    } catch (e) {}
    return false;
  }

  function grantConsent() {
    try { localStorage.setItem(CONSENT_KEY, '1'); } catch (e) {}
    var banner = document.getElementById('cookie-banner');
    if (banner) banner.hidden = true;
    bootAnalytics();
  }

  function loadGA4(cb) {
    if (gaLoaded || !GA_ID || GA_ID.indexOf('XXXXXXXXXX') !== -1) {
      if (cb) cb();
      return;
    }
    gaLoaded = true;
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;
    s.onload = function () {
      window.dataLayer = window.dataLayer || [];
      function gtag() { window.dataLayer.push(arguments); }
      window.gtag = gtag;
      gtag('js', new Date());
      gtag('config', GA_ID);
      if (cb) cb();
    };
    document.head.appendChild(s);
  }

  function track(event, params) {
    if (event === 'form_submit') sendEvent('form_submit');
    if (event === 'join_submit') sendEvent('join_submit', params);
    if (event === 'join_checkout_redirect') sendEvent('join_checkout_redirect', params);
    if (event === 'join_checkout_ready') sendEvent('join_checkout_ready', params);
    if (event === 'join_checkout_departed') sendEvent('join_checkout_departed', params);
    if (event === 'join_checkout_fallback_clicked') sendEvent('join_checkout_fallback_clicked', params);
    if (event === 'join_checkout_stalled') sendEvent('join_checkout_stalled', params);
    if (event === 'join_error') sendEvent('join_error', params);
    if (window.gtag) window.gtag('event', event, params || {});
  }

  function bootAnalytics() {
    if (!hasConsent() || !currentPageConfig) return;
    loadGA4(function () {
      if (pageInitDone) return;
      pageInitDone = true;
      var page = currentPageConfig.page;
      if (page === 'member') initMemberTracking();
      else if (page === 'partners') initPartnersTracking();
      else if (page === 'confirmation') initConfirmationTracking();
      else if (page === 'join') initJoinTracking();
      else if (page === 'subscription-success') initSubscriptionSuccessTracking();
      else if (page === 'subscription-cancelled') initSubscriptionCancelledTracking();
      else if (page === 'partner-subscription-success') initPartnerSubscriptionSuccessTracking();
      else if (page === 'partner-subscription-cancelled') initPartnerSubscriptionCancelledTracking();
    });
  }

  function initScrollDepth() {
    var marks = [50, 75, 100];
    var fired = {};
    function check() {
      var max = document.documentElement.scrollHeight - window.innerHeight;
      if (max <= 0) return;
      var pct = Math.round((window.scrollY / max) * 100);
      marks.forEach(function (m) {
        if (pct >= m && !fired[m]) {
          fired[m] = true;
          track('scroll_depth', { percent_scrolled: m });
        }
      });
      if (fired[100]) window.removeEventListener('scroll', check);
    }
    window.addEventListener('scroll', check, { passive: true });
    check();
  }

  function initSectionView(selectors) {
    if (!('IntersectionObserver' in window)) return;
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var label = entry.target.getAttribute('data-screen-label') || '';
        if (!label) return;
        track('section_view', { section: label });
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.1 });
    selectors.forEach(function (sel) {
      document.querySelectorAll(sel).forEach(function (el) { observer.observe(el); });
    });
  }

  function bindOnce(el, key, handler) {
    if (!el || el.dataset[key]) return;
    el.dataset[key] = '1';
    el.addEventListener('click', handler);
  }

  function initStripeCTAs() {
    document.querySelectorAll('[data-stripe-cta]').forEach(function (el) {
      bindOnce(el, 'dpcStripeBound', function (e) {
        var url = el.getAttribute('data-stripe-url') || '';
        if (!url || url.indexOf('REPLACE_ME') !== -1) {
          e.preventDefault();
          return;
        }
        e.preventDefault();
        var navigated = false;
        function go() {
          if (navigated) return;
          navigated = true;
          window.location.href = url;
        }
        sendEvent('deposit_click');
        track('deposit_button_click', { event_callback: go });
        track('outbound_click', {
          link_url: url,
          link_domain: 'stripe.com',
          outbound: true
        });
        setTimeout(go, 400);
      });
    });
  }

  function initMemberTracking() {
    initScrollDepth();
    initSectionView([
      '[data-screen-label="02 Why This Exists"]',
      '[data-screen-label="07 Founding Offer"]',
      '[data-screen-label="08 Pick Your Circle"]',
      '[data-screen-label="09 Founding Partners"]'
    ]);
  }

  function initPartnersTracking() {
    initScrollDepth();
    document.querySelectorAll('.hero .btn').forEach(function (el) {
      bindOnce(el, 'dpcBtnBound', function () {
        track('button_click', { button_name: 'hero_cta', page: 'partners' });
      });
    });
  }

  function initConfirmationTracking() {
    try {
      if (sessionStorage.getItem(DEPOSIT_TRACKED_KEY) === '1') return;
      sessionStorage.setItem(DEPOSIT_TRACKED_KEY, '1');
    } catch (e) {}
    track('founding_deposit_complete');
  }

  function initJoinTracking() {
    initScrollDepth();
  }

  var MEMBERSHIP_SUCCESS_KEY = 'dpc_membership_success_tracked';
  var MEMBERSHIP_CANCEL_KEY = 'dpc_membership_cancel_tracked';
  var PARTNER_SUBSCRIPTION_SUCCESS_KEY = 'dpc_partner_subscription_success_tracked';
  var PARTNER_SUBSCRIPTION_CANCEL_KEY = 'dpc_partner_subscription_cancel_tracked';

  function initSubscriptionSuccessTracking() {
    try {
      if (sessionStorage.getItem(MEMBERSHIP_SUCCESS_KEY) === '1') return;
      sessionStorage.setItem(MEMBERSHIP_SUCCESS_KEY, '1');
    } catch (e) {}
    track('membership_checkout_complete');
  }

  function initSubscriptionCancelledTracking() {
    try {
      if (sessionStorage.getItem(MEMBERSHIP_CANCEL_KEY) === '1') return;
      sessionStorage.setItem(MEMBERSHIP_CANCEL_KEY, '1');
    } catch (e) {}
    track('membership_checkout_cancelled');
  }

  function initPartnerSubscriptionSuccessTracking() {
    try {
      if (sessionStorage.getItem(PARTNER_SUBSCRIPTION_SUCCESS_KEY) === '1') return;
      sessionStorage.setItem(PARTNER_SUBSCRIPTION_SUCCESS_KEY, '1');
    } catch (e) {}
    track('partner_subscription_checkout_submitted');
  }

  function initPartnerSubscriptionCancelledTracking() {
    try {
      if (sessionStorage.getItem(PARTNER_SUBSCRIPTION_CANCEL_KEY) === '1') return;
      sessionStorage.setItem(PARTNER_SUBSCRIPTION_CANCEL_KEY, '1');
    } catch (e) {}
    track('partner_subscription_checkout_cancelled');
  }

  function initCookieBanner() {
    var banner = document.getElementById('cookie-banner');
    var accept = document.getElementById('cookie-accept');
    if (hasConsent()) {
      if (banner) banner.hidden = true;
      bootAnalytics();
      return;
    }
    if (banner) banner.hidden = false;
    if (accept) accept.addEventListener('click', grantConsent);
  }

  function init(config) {
    currentPageConfig = config || {};
    sendEvent('page_view');
    if (config.page === 'member') initStripeCTAs();
    if (config.page === 'confirmation') {
      // Once per browser session, so refreshes of the confirmation page do
      // not inflate the funnel. Falls back to sending if storage is blocked.
      var send = true;
      try {
        if (sessionStorage.getItem(DEPOSIT_BEACON_KEY) === '1') send = false;
        else sessionStorage.setItem(DEPOSIT_BEACON_KEY, '1');
      } catch (e) {}
      if (send) sendEvent('deposit_confirmed');
    }
    if (config.page === 'subscription-success') {
      var sendSuccess = true;
      try {
        if (sessionStorage.getItem('dpc_membership_success_beacon') === '1') sendSuccess = false;
        else sessionStorage.setItem('dpc_membership_success_beacon', '1');
      } catch (e) {}
      if (sendSuccess) sendEvent('membership_checkout_complete');
    }
    if (config.page === 'subscription-cancelled') {
      var sendCancel = true;
      try {
        if (sessionStorage.getItem('dpc_membership_cancel_beacon') === '1') sendCancel = false;
        else sessionStorage.setItem('dpc_membership_cancel_beacon', '1');
      } catch (e) {}
      if (sendCancel) sendEvent('membership_checkout_cancelled');
    }
    if (config.page === 'partner-subscription-success') {
      var sendPartnerSuccess = true;
      try {
        if (sessionStorage.getItem('dpc_partner_subscription_success_beacon') === '1') sendPartnerSuccess = false;
        else sessionStorage.setItem('dpc_partner_subscription_success_beacon', '1');
      } catch (e) {}
      if (sendPartnerSuccess) sendEvent('partner_subscription_checkout_submitted');
    }
    if (config.page === 'partner-subscription-cancelled') {
      var sendPartnerCancel = true;
      try {
        if (sessionStorage.getItem('dpc_partner_subscription_cancel_beacon') === '1') sendPartnerCancel = false;
        else sessionStorage.setItem('dpc_partner_subscription_cancel_beacon', '1');
      } catch (e) {}
      if (sendPartnerCancel) sendEvent('partner_subscription_checkout_cancelled');
    }
    initCookieBanner();
  }

  window.DPCAnalytics = {
    init: init,
    track: track,
    hasConsent: hasConsent,
    grantConsent: grantConsent
  };
})(window, document);
