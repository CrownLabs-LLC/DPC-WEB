// No analytics, network requests, storage, or token-bearing outbound web links.
(() => {
  const invitation = document.getElementById('invitation');
  const invalid = document.getElementById('invalid');
  const open = document.getElementById('open-app');
  function update() {
    // Accept only our exact credential shape, never an arbitrary destination.
    const match = /^#token=([a-f0-9]{64})$/.exec(window.location.hash);
    const valid = Boolean(match) && !window.location.search;
    invitation.hidden = !valid;
    invalid.hidden = valid;
    if (valid) open.href = `dpc://pour-partner#token=${match[1]}`;
    else open.removeAttribute('href');
  }
  window.addEventListener('hashchange', update);
  update();
})();
