'use strict';
/* Spotify sends the browser here after login. */
(async function () {
  const main = $('#main');
  try {
    const ret = await Auth.handleCallback();
    await loadMe();
    let path = '';
    try { const u = new URL(ret, location.origin); if (u.origin === location.origin) path = u.pathname + u.search; } catch {}
    const bad = !path || path === '/' || path.startsWith('/callback');
    location.replace(bad ? SITE_DIR + 'play' : location.origin + path);
  } catch (e) {
    main.innerHTML = `<div class="panel" style="max-width:620px;margin:40px auto"><h1 style="font-size:34px">Login didn’t finish</h1><p>${esc(e.message)}</p>
      <p class="mute">If Spotify said “redirect_uri: Not matching configuration”, add <code>${esc(REDIRECT_URI)}</code> to your app’s Redirect URIs and click Save.</p>
      <a class="btn primary" href="/">Try again</a></div>`;
  }
})();
