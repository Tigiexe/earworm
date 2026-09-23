'use strict';
/* Landing page: login (or Spotify app setup when the server has no Client ID). Logged-in visitors go straight to Play. */
(function () {
  const q = new URLSearchParams(location.search);
  if (q.get('join')) return go('multiplayer?join=' + encodeURIComponent(q.get('join')));
  if (Auth.tok) return go('play');
  Header.render('');
  const main = $('#main');
  const guestRow = `<div class="row"><a class="btn" href="/play">Play the charts</a><a class="btn ghost" href="/multiplayer">Join a friend’s game</a></div>`;
  const setup = () => {
    const insecure = location.protocol === 'http:' && !['127.0.0.1', '[::1]'].includes(location.hostname);
    main.innerHTML = `<div class="setup" style="max-width:780px;margin:24px 0">
      <h1 style="font-size:clamp(32px,5vw,52px)">Connect a Spotify app</h1>
      <p class="mute">Earworm talks to Spotify from your browser, so it needs a Spotify developer app. The app owner needs Spotify Premium; everyone else can use a free account.
        Running this site? Put the Client ID in the server’s <code>.env</code> file (<code>SPOTIFY_CLIENT_ID=…</code>) so visitors skip this step.</p>
      ${insecure ? `<div class="warn">This page is open over <b>http</b>${location.hostname === 'localhost' ? ' at “localhost”' : ''}. Spotify only accepts HTTPS addresses, or <b>http://127.0.0.1</b> for testing on your own computer.</div>` : ''}
      <ol>
        <li>Open <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noopener">developer.spotify.com/dashboard</a> and create an app. Tick <b>Web API</b> and <b>Web Playback SDK</b>.</li>
        <li>Add this exact Redirect URI, then click <b>Save</b> at the bottom:<div class="row" style="margin-top:6px"><code>${esc(REDIRECT_URI)}</code><button class="btn sm" data-act="copyRedirect">Copy</button></div></li>
        <li>Under <b>User Management</b>, add the Spotify email of everyone who will log in.</li>
        <li>Paste the app’s <b>Client ID</b> here:
          <div class="row" style="margin-top:8px"><input class="field" id="cidInput" placeholder="32-character Client ID" style="max-width:380px" value="${esc(store.get('clientId', ''))}"><button class="btn primary" data-act="saveCid">Save</button></div></li>
      </ol>
      <hr><p class="mute">No Spotify access? You can still play the charts or join a friend’s game.</p>${guestRow}</div>`;
  };
  const login = () => {
    const can = !!clientId();
    main.innerHTML = `<div class="hero">
      <div><h1>How well do you know your own music?</h1>
        <p>Log in with Spotify and get quizzed on your liked songs and playlists — or play the charts without an account. Titles, artists, albums, release years and cover art. Answer fast for more points.</p>
        <div class="row">${can ? '<button class="btn primary big" data-act="login">Log in with Spotify</button>' : ''}<a class="btn big ${can ? '' : 'primary'}" href="/play">Play the charts${can ? ' instead' : ''}</a></div>
        <p class="mute" style="margin-top:18px"><small>Got a game code? <a href="/multiplayer">Join a friend’s game</a>.${!CFG.CLIENT_ID && CFG.ALLOW_CLIENT_ID_SETUP ? ' Setting this up? <a href="#" data-act="changeCid">Change the Client ID</a>.' : ''}</small></p></div>
      <div class="hero-disc"><div class="vinyl-wrap" style="width:100%"><div class="vinyl spin"><div class="label"><span>♪</span></div></div></div></div></div>`;
  };
  Object.assign(Act, {
    saveCid() { const v = $('#cidInput').value.trim(); if (!/^[0-9a-f]{32}$/i.test(v)) return toast('A Client ID is 32 letters and numbers. Copy it from your app’s settings page.'); store.set('clientId', v); login(); },
    copyRedirect() { navigator.clipboard?.writeText(REDIRECT_URI).then(() => toast('Redirect URI copied.'), () => toast(REDIRECT_URI, 8000)); },
    changeCid() { store.del('clientId'); setup(); }
  });
  clientId() || !CFG.ALLOW_CLIENT_ID_SETUP ? login() : setup();
})();
