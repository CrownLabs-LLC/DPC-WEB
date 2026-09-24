(() => {
  function updateEndedState() {
    const dates = Array.from(document.querySelectorAll('.gc-calendar time'), node => node.dateTime).sort();
    const endDate = dates.at(-1);
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());
    if (!endDate || today <= endDate) return;

    document.getElementById('event-description').textContent = 'These tastings have ended. Thank you for joining us in downtown Livermore.';
    document.querySelectorAll('#event-readiness, #tasting-instructions, #same-visit').forEach(node => { node.hidden = true; });
    document.getElementById('restaurants-title').textContent = 'Our participating restaurants.';
    document.querySelector('.gc-restaurants .gc-section-heading p').textContent = 'Thank you to the downtown restaurants that welcomed guests for The Glass Comes Back.';
    document.querySelector('a[href="#restaurants"].gc-action').textContent = 'See the restaurants';
  }

  updateEndedState();
  window.addEventListener('pageshow', updateEndedState);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) updateEndedState();
  });
})();
