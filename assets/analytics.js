(function (window, document) {
  'use strict';

  var GA_ID = 'G-C7CCW2YLPH';
  var CONSENT_KEY = 'dpc_cookie_consent';
  var LEGACY_CONSENT_KEY = 'dpc_partner_cookie_consent';
  var DEPOSIT_TRACKED_KEY = 'dpc_deposit_tracked';
  var gaLoaded = false;
  var pageInitDone = false;
  var currentPageConfig = null;

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
    if (config.page === 'member') initStripeCTAs();
    initCookieBanner();
  }

  window.DPCAnalytics = {
    init: init,
    track: track,
    hasConsent: hasConsent,
    grantConsent: grantConsent
  };
})(window, document);
