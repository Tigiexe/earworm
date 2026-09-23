'use strict';
/* Landing page: login, or choosing which Spotify app logins go through (/?app=choose). Logged-in visitors go straight to Play. */
(function () {
  const q = new URLSearchParams(location.search);
  if (q.get('join')) return go('multiplayer?join=' + encodeURIComponent(q.get('join')));
  const choosing = q.get('app') === 'choose' || (!clientId() && CFG.ALLOW_CLIENT_ID_SETUP);
  if (Auth.tok && !choosing) return go('play');
  Header.render('');
  const main = $('#main');
  const switched = session.get('appSwitched', 0); session.del('appSwitched');

  const appNote = () => usingOwnApp()
    ? `<p class="app-note">Logging in through a friend’s Spotify app (<b>${esc(shortId(clientId()))}</b>). Its owner has to add your Spotify email before you can log in. <a href="/?app=choose">Change</a></p>`
    : '';

  const login = () => {
    const can = !!clientId();
    main.innerHTML = `<div class="hero">
      <div><h1>How well do you know your own music?</h1>
        <p>Log in with Spotify and get quizzed on your liked songs and playlists — or play the charts without an account. Titles, artists, albums, release years and cover art. Answer fast for more points.</p>
        ${switched && usingOwnApp() ? '<div class="ok-box">Invite link applied. Log in below — this browser will use your friend’s Spotify app from now on.</div>' : ''}
        ${switched && !usingOwnApp() ? '<div class="ok-box">Back to this site’s own Spotify app.</div>' : ''}
        <div class="row">${can ? '<button class="btn primary big" data-act="login">Log in with Spotify</button>' : ''}<a class="btn big ${can ? '' : 'primary'}" href="/play">Play the charts${can ? ' instead' : ''}</a></div>
        ${appNote()}
        <p class="mute" style="margin-top:18px"><small>Got a game code? <a href="/multiplayer">Join a friend’s game</a>. Can’t log in? <a href="/?app=choose">Use a different Spotify app</a>.</small></p></div>
      <div class="hero-disc"><div class="vinyl-wrap" style="width:100%"><div class="vinyl spin"><div class="label"><span>♪</span></div></div></div></div></div>`;
  };

  const chooser = () => {
    const own = ownClientId(), current = clientId();
    const insecure = location.protocol === 'http:' && !['127.0.0.1', '[::1]'].includes(location.hostname);
    main.innerHTML = `<div class="setup" style="max-width:800px;margin:24px 0">
      <h1 style="font-size:clamp(32px,5vw,52px)">Which Spotify app to log in through</h1>
      <p class="mute">Every Spotify app only lets its owner and a few people they list log in. If this site’s app is full, a friend can make their own app and share an invite link — then their group logs in through it.</p>
      ${insecure ? `<div class="warn">This page is open over <b>http</b>. Spotify login needs the site’s https address.</div>` : ''}
      <div class="panel" style="margin:18px 0">
        <h3>This browser uses</h3>
        <p style="margin:0 0 12px">${usingOwnApp() ? `A friend’s app, <b>${esc(shortId(current))}</b>.` : current ? `This site’s own app${CFG.CLIENT_ID ? '' : ` (<b>${esc(shortId(current))}</b>)`}.` : 'No Spotify app yet — paste a Client ID below.'}</p>
        <div class="row"><input class="field" id="cidInput" placeholder="Paste a 32-character Client ID" style="max-width:380px" value="${esc(own)}" autocomplete="off" spellcheck="false"><button class="btn primary" data-act="saveCid">Use this app</button>
          ${usingOwnApp() && CFG.CLIENT_ID ? '<button class="btn ghost" data-act="defaultCid">Use this site’s app</button>' : ''}</div>
        ${current ? `<p class="mute" style="margin:14px 0 0">Invite link for people who log in through ${usingOwnApp() || !CFG.CLIENT_ID ? 'this app' : 'this site’s app'}:</p>
          <div class="row" style="margin-top:6px"><code>${esc(usingOwnApp() || !CFG.CLIENT_ID ? inviteLink(current) : SITE_DIR + '?app=default')}</code><button class="btn sm" data-act="copyInvite">Copy</button></div>` : ''}
      </div>
      <h2>Run your own app for a group of friends</h2>
      <p class="mute">You need Spotify Premium. Takes about five minutes.</p>
      <ol>
        <li>Open <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noopener">developer.spotify.com/dashboard</a> and click <b>Create app</b>. Any name works. Tick <b>Web API</b> and <b>Web Playback SDK</b>.</li>
        <li>Add this exact Redirect URI, then click <b>Save</b> at the bottom:<div class="row" style="margin-top:6px"><code>${esc(REDIRECT_URI)}</code><button class="btn sm" data-act="copyRedirect">Copy</button></div></li>
        <li>Under <b>User Management</b>, add the Spotify email of each friend (you don’t need to add yourself). Spotify allows only a few per app.</li>
        <li>Copy the app’s <b>Client ID</b>, paste it above and click <b>Use this app</b>.</li>
        <li>Send your friends the invite link that appears. They open it once, then log in normally.</li>
      </ol>
      <p class="mute"><small>An invite link doesn’t add anyone to your app — you still add their emails in step 3. It only tells Earworm which app their browser should log in through. Everyone can still play together in multiplayer, whichever app they use.</small></p>
      <hr><div class="row"><a class="btn" href="/">Back</a><a class="btn ghost" href="/play">Play the charts</a></div></div>`;
  };

  function useApp(id) {
    const before = clientId();
    if (id && id !== CFG.CLIENT_ID) store.set('clientId', id); else store.del('clientId');
    if (Auth.tok && clientId() !== before) Auth.forget();   // that login belonged to the other app
  }
  Object.assign(Act, {
    saveCid() {
      const v = $('#cidInput').value.trim().toLowerCase();
      if (!CID_RE.test(v)) return toast('A Client ID is 32 letters and numbers. Copy it from the app’s page on the Spotify dashboard.');
      useApp(v); toast(v === CFG.CLIENT_ID ? 'That’s this site’s own app.' : 'Saved. Log in through this app now.'); Header.render(''); chooser();
    },
    defaultCid() { useApp(''); toast('Back to this site’s own Spotify app.'); Header.render(''); chooser(); },
    copyRedirect() { navigator.clipboard?.writeText(REDIRECT_URI).then(() => toast('Redirect URI copied.'), () => toast(REDIRECT_URI, 8000)); },
    copyInvite() { const t = $('.setup .panel code')?.textContent || ''; navigator.clipboard?.writeText(t).then(() => toast('Invite link copied.'), () => toast(t, 9000)); }
  });
  choosing ? chooser() : login();
})();
