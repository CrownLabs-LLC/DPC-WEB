(() => {
  const menu = document.querySelector('.site-nav__more');
  if (!menu) return;

  const toggle = menu.querySelector('summary');
  const compactHeader = window.matchMedia('(max-width: 860px)');
  const close = () => { menu.open = false; };

  menu.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !menu.open) return;
    event.preventDefault();
    close();
    toggle.focus();
  });
  menu.addEventListener('click', event => {
    if (!event.target.closest('a')) return;
    close();
    toggle.focus();
  });
  document.addEventListener('focusin', event => {
    if (!menu.contains(event.target)) close();
  });
  document.addEventListener('click', event => {
    if (!menu.contains(event.target)) close();
  });
  compactHeader.addEventListener('change', () => {
    if (!compactHeader.matches && menu.contains(document.activeElement)) {
      menu.closest('nav').querySelector('.btn--explore').focus();
    }
    close();
  });
  window.addEventListener('pageshow', close);
})();
