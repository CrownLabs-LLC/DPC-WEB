(function () {
  'use strict';

  var hero = document.getElementById('hero');
  var joinBar = document.getElementById('mobile-join');
  var cookie = document.getElementById('cookie-banner');
  var footer = document.querySelector('footer');
  var mobile = window.matchMedia('(max-width: 760px)');
  if (!hero || !joinBar || !('IntersectionObserver' in window)) return;

  var afterHero = false;
  var atFooter = false;
  function update() {
    // Keep the consent notice and footer links unobstructed. Without the
    // observer the normal hero, pricing and closing links remain available.
    var visible = mobile.matches && afterHero && !atFooter && (!cookie || cookie.hidden);
    joinBar.hidden = !visible;
    document.body.classList.toggle('mobile-join-visible', visible);
  }
  new IntersectionObserver(function (entries) {
    afterHero = entries[0].boundingClientRect.bottom <= 0;
    update();
  }).observe(hero);
  if (footer) new IntersectionObserver(function (entries) {
    atFooter = entries[0].isIntersecting;
    update();
  }).observe(footer);
  if (cookie) new MutationObserver(update).observe(cookie, { attributes: true, attributeFilter: ['hidden'] });
  mobile.addEventListener('change', update);
  window.addEventListener('pageshow', update);
  update();
}());
