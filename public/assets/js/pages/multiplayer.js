'use strict';
/* Multiplayer page: host or join, lobby, game and final scores all live here so the connection stays open.
   The host's browser runs the game; the server only relays messages between players (server/rooms.js). */
const UI = { show(name) { $$('.screen').forEach(s => s.classList.toggle('active', s.id === 'scr-' + name)); window.scrollTo(0, 0); } };

/* ---------------- connection to the relay ---------------- */
const Net = {
  ws: null, on: null, onClose: null,
  open() {
    return new Promise((res, rej) => {
      const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
      let opened = false;
      const fail = () => { clearTimeout(tm); if (!opened) rej(new Error('Couldn’t reach the multiplayer server. Try again in a moment.')); };
      const tm = setTimeout(() => { try { ws.close(); } catch {} fail(); }, 10000);
      ws.onopen = () => { opened = true; clearTimeout(tm); res(); };
      ws.onerror = fail;
      ws.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch { return; } if (m && typeof m === 'object') this.on?.(m); };
      ws.onclose = () => { if (this.ws !== ws) return; this.ws = null; if (opened) this.onClose?.(); else fail(); };
      this.ws = ws;
    });
  },
  send(m) { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(m)); },
  close() { const ws = this.ws; this.ws = null; try { ws?.close(); } catch {} }
};
const mpKey = () => { let k = session.get('mpKey', ''); if (!k) { k = randStr(16); session.set('mpKey', k); } return k; };

/* songs from a guest: keep only well-formed fields, since anyone with the code can send anything */
function cleanTracks(list, owner) {
  if (!Array.isArray(list)) return [];
  const str = (v, n = 300) => typeof v === 'string' ? v.slice(0, n) : '';
  const url = v => typeof v === 'string' && /^https:\/\/[^\s"'<>]+$/.test(v) ? v.slice(0, 500) : '';
  const int = v => Number.isInteger(v) && v > 0 ? v : null;
  const strs = v => Array.isArray(v) ? v.filter(x => typeof x === 'string').slice(0, 3).map(x => x.slice(0, 200)) : [];
  return list.slice(0, 1500).map(t => {
    if (!t || typeof t !== 'object' || !t.album || typeof t.album !== 'object' || !Array.isArray(t.artists)) return null;
    const al = t.album, artists = t.artists.slice(0, 6).map(a => ({ id: str(a?.id, 80), name: str(a?.name) })).filter(a => a.name);
    if (!str(t.id, 80) || !str(t.name) || !artists.length) return null;
    return {
      id: str(t.id, 80), uri: /^spotify:track:[A-Za-z0-9]{10,30}$/.test(t.uri || '') ? t.uri : null, name: str(t.name), artists,
      album: { id: str(al.id, 80), name: str(al.name), image: url(al.image), thumb: url(al.thumb), date: str(al.date, 10), year: int(al.year), type: str(al.type, 20) },
      dur: int(t.dur) || 0, isrc: /^[A-Za-z0-9]{12}$/.test(t.isrc || '') ? t.isrc : '', explicit: t.explicit === true, link: url(t.link),
      dz: t.dz && int(t.dz.id) ? { id: t.dz.id, artist: int(t.dz.artist), album: int(t.dz.album) } : undefined,
      broad: Array.isArray(t.broad) ? t.broad.filter(b => typeof b === 'string').slice(0, 4).map(b => b.slice(0, 40)) : undefined,
      alt: t.alt && typeof t.alt === 'object' ? { names: strs(t.alt.names), artists: strs(t.alt.artists) } : undefined,
      src: ['mp'], owners: [owner]
    };
  }).filter(Boolean);
}

/* ---------------- the game ---------------- */
const MP = {
  active: false, host: false, code: null, conns: new Set(), players: {}, libs: {}, myId: null,
  mode: 'classic', from: {}, shown: {}, state: 'idle', round: 0,
  coop: false, coopRetry: false, team: null, teamScore: null,   // co-op: one shared answer and score for everyone
  exact: false,                                                 // song shares hit exactly instead of at random
  ready: new Set(), started: false, readyTimer: null,           // each round starts only when everyone has the song loaded total: 0, answers: {}, curQ: null, curLimit: 0, roundTimer: null, names: {}, lobby: null, myName: '', myHist: [],
  open(joinCode) {
    UI.show('mp');
    const name = this.myName || Me?.display_name || store.get('mpName', '') || '';
    const mine = Lib.all(); const canShare = mine.length > 0;
    $('#scr-mp').innerHTML = `
      <div class="home-head"><div><h1>Play with friends</h1><p class="mute" style="margin:0">Everyone plays on their own device. The host’s songs, plus any friend’s songs, get mixed into one quiz.</p></div></div>
      <div class="mp-grid">
        <div class="panel"><h2>Host a game</h2>
          <p class="mute">You pick the settings and get a code to share. ${mine.length ? `Your ${fmtN(mine.length)} songs go into the mix.` : 'Add some songs on the <a href="/play">Play page</a> first.'}</p>
          <label class="mute" for="mpName1">Your name</label><input class="field" id="mpName1" maxlength="20" value="${esc(name)}" style="margin:6px 0 14px">
          <button class="btn primary" data-act="mpHost" ${mine.length < 4 ? 'disabled' : ''}>Create game</button></div>
        <div class="panel"><h2>Join a game</h2>
          <label class="mute" for="mpCode">Game code</label><input class="field" id="mpCode" maxlength="5" autocomplete="off" value="${esc(joinCode || '')}" style="margin:6px 0 12px;text-transform:uppercase;letter-spacing:.2em;font-weight:700" placeholder="ABCDE">
          <label class="mute" for="mpName2">Your name</label><input class="field" id="mpName2" maxlength="20" value="${esc(name)}" style="margin:6px 0 10px">
          <label class="chk"><input type="checkbox" id="mpShare" ${canShare ? 'checked' : 'disabled'}> Add my songs to the mix</label>
          ${canShare ? '' : `<p class="mute"><small>You can join without any songs — you’ll play with the host’s.</small></p>`}
          <button class="btn primary" data-act="mpJoin">Join</button></div>
      </div>`;
    if (joinCode) $('#mpName2')?.focus();
  },
  pub() {
    const shares = this.shares();
    return Object.values(this.players).map(p => ({ id: p.id, name: p.name, ci: p.ci, score: p.score, count: p.count, share: p.share, pct: shares[p.id] || 0, connected: p.connected,
      answered: !!this.answers[p.id], ready: this.ready.has(p.id), streak: p.streak, correct: p.correct, from: this.from[p.name] || 0 }));
  },
  /* each player's percentage of the songs, from the host's share sliders (players without songs, or who left, get 0) */
  shares() {
    const on = Object.values(this.players).filter(p => p.connected && p.count > 0 && p.share > 0), tot = on.reduce((a, p) => a + p.share, 0), out = {};
    for (const p of on) out[p.id] = Math.round(p.share / tot * 1000) / 10;
    return out;
  },
  nextColor() { const used = new Set(Object.values(this.players).map(p => p.ci)); let i = 0; while (used.has(i) && i < PLAYER_COLORS.length) i++; return i % PLAYER_COLORS.length; },
  learnColors(players) { for (const p of players || []) if (Number.isInteger(p.ci)) PlayerColors.set(p.name, PLAYER_COLORS[p.ci % PLAYER_COLORS.length]); },
  send(id, m) { Net.send({ t: 'to', to: id, d: m }); },
  broadcast(m) { Net.send({ t: 'to', to: '*', d: m }); },
  up(m) { Net.send({ t: 'up', d: m }); },

  /* host side */
  async hostGame() {
    const name = ($('#mpName1')?.value || '').trim().slice(0, 20) || 'Host';
    this.myName = name; store.set('mpName', name);
    this.reset();
    $('#scr-mp').innerHTML = '<div class="loading">Creating a game…</div>';
    try { await Net.open(); } catch (e) { toast(e.message); return this.open(); }
    this.active = true; this.host = true; this.myId = 'host'; this.state = 'lobby';
    const mine = Lib.all();
    this.players = { host: { id: 'host', name, ci: 0, score: 0, streak: 0, correct: 0, share: 50, count: mine.length, connected: true } };
    this.libs = { host: mine.map(t => ({ ...slimTrack(t), owners: [name] })) };
    Net.on = m => this.hostNet(m);
    Net.onClose = () => { if (this.active) { toast('Lost the connection to the server, so the game ended.'); this.leave(true); } };
    Net.send({ t: 'host' });
  },
  hostNet(m) {
    if (m.t === 'hosted') { this.code = m.code; this.renderLobby(); }
    else if (m.t === 'error') { toast(m.msg || 'Multiplayer problem.'); this.leave(true); }
    else if (m.t === 'peer' && m.ev === 'open') this.conns.add(m.id);
    else if (m.t === 'peer' && m.ev === 'close') this.guestLeft(m.id);
    else if (m.t === 'msg') this.hostRecv(m.from, m.d);
  },
  guestLeft(id) {
    this.conns.delete(id);
    const p = this.players[id];
    if (p) { p.connected = false; toast(p.name + ' left'); this.lobbyChanged(); if (this.state === 'question') { if (this.started) this.checkAll(); else this.checkReady(); } }
  },
  hostRecv(id, d) {
    if (!d || typeof d !== 'object' || !this.conns.has(id)) return;
    if (d.t === 'hello') {
      if (this.players[id]) return;
      const key = typeof d.key === 'string' ? d.key.slice(0, 40) : '';
      const old = key ? Object.values(this.players).find(p => p.key === key && !p.connected) : null;   // same browser tab coming back
      if (old) { delete this.players[old.id]; delete this.libs[old.id]; }
      // songs are credited by name, so names must be unique
      let name = String(d.name || '').replace(/\s+/g, ' ').trim().slice(0, 20) || 'Guest';
      const taken = n => Object.values(this.players).some(p => p.name.toLowerCase() === n.toLowerCase());
      for (let i = 2, base = name.slice(0, 17); taken(name); i++) name = `${base} ${i}`;
      const tracks = cleanTracks(d.tracks, name);
      this.players[id] = old ? { ...old, id, name, count: tracks.length, connected: true }
        : { id, key, name, ci: this.nextColor(), score: 0, streak: 0, correct: 0, share: 50, count: tracks.length, connected: true };
      this.libs[id] = tracks;
      this.players[id].sdk = d.sdk === true;   // can this player hear full songs through Spotify?
      this.send(id, { t: 'welcome', id });
      toast(name + (old ? ' is back' : ' joined'));
      if (this.state !== 'lobby') {
        this.send(id, { t: 'start', names: this.names, total: this.total, info: this.info, coop: this.coop, coopRetry: this.coopRetry, teamScore: this.teamScore });
        if (this.state === 'question' && this.curQ) {
          this.send(id, { t: 'q', round: this.round, total: this.total, q: this.curQ, limit: this.curLimit });
          if (this.started) this.send(id, { t: 'go', round: this.round, pause: 0 });
        }
      }
      this.lobbyChanged();
    } else if (d.t === 'ready') {
      if (d.round === this.round && d.qid === this.curQ?.id) this.onReady(id, d.sdk === true);
    } else if (d.t === 'answer') {
      if (d.round === this.round && d.qid === this.curQ?.id && d.res && typeof d.res === 'object') this.receive(id, d.res);
    }
  },
  lobbyChanged() {
    const m = { t: 'lobby', code: this.code, players: this.pub(), hostName: this.players.host?.name, summary: this.summary(), state: this.state, coop: this.coop, coopRetry: this.coopRetry };
    this.broadcast(m);
    if (this.state === 'lobby') this.renderLobby(); else this.renderBoard(this.pub());
  },
  renderLobby() {
    const isHost = this.host;
    const players = isHost ? this.pub() : (this.lobby?.players || []);
    this.learnColors(players);
    const code = isHost ? this.code : this.lobby?.code;
    const link = SITE_DIR + 'join/' + code;
    const mixCount = isHost ? this.mixPool().length : null;
    const withSongs = players.filter(p => p.count > 0 && p.connected);
    UI.show('mp');
    const box = $('#scr-mp'), hadList = !!$('.plist', box);
    const html = `
      <div class="mp-grid">
        <div class="panel">
          <p class="mute" style="margin:0 0 6px">Game code</p>
          <div class="mp-code">${esc(code || '…')}</div>
          ${isHost ? `<p class="mute" style="margin-top:14px">Friends open this site and enter the code, or use this link:</p><div class="row"><code>${esc(link)}</code><button class="btn sm" data-act="mpCopy">Copy link</button></div>` : `<p class="mute" style="margin-top:14px">Waiting for <b style="color:var(--ink)">${esc(this.lobby?.hostName || 'the host')}</b> to start the game.</p>`}
          <hr><h3>Play style</h3>
          ${isHost ? `<div class="seg" role="group"><button type="button" class="${this.coop ? '' : 'on'}" data-act="mpStyle" data-v="comp">🏆 Competitive</button><button type="button" class="${this.coop ? 'on' : ''}" data-act="mpStyle" data-v="coop">🤝 Co-op</button></div>
            ${this.coop ? `<label class="chk"><input type="checkbox" data-act="mpRetry" ${this.coopRetry ? 'checked' : ''}> Wrong answers don’t end the round — the others can still try</label>` : ''}` : ''}
          <p class="mute" style="margin:8px 0 0"><small>${(isHost ? this.coop : this.lobby?.coop)
            ? `Co-op: everyone answers together. The first answer counts for the whole team${(isHost ? this.coopRetry : this.lobby?.coopRetry) ? ' (a wrong one just rules that answer out)' : ''}, and there’s one shared score — so it’s fine if a song is only someone else’s.`
            : 'Competitive: everyone answers for themselves and gets their own score.'}</small></p>
          <hr><h3>Game mode</h3><p class="mute">${esc(isHost ? this.summary() : (this.lobby?.summary || ''))}</p>
          ${isHost ? `<div class="chips" style="margin-bottom:10px">${MP_MODES.map(k => `<button class="chip ${this.mode === k ? 'on' : ''}" data-act="mpPreset" data-k="${k}">${PRESETS[k].icon} ${esc(PRESETS[k].name)}</button>`).join('')}</div><button class="btn sm" data-act="mpSettings">${esc(PRESETS[this.mode].name)} settings</button>` : ''}
        </div>
        <div class="panel"><h2>Players <small class="mute">${players.filter(p => p.connected).length}</small></h2>
          <div class="plist">${players.map(p => `<div class="player ${p.connected ? '' : 'gone'}" data-key="${esc(p.id)}">${avatar(p.name)}
            <span class="n"><b>${esc(p.name)}</b>${p.id === 'host' ? ' <span class="tag">host</span>' : ''}${p.id === this.myId ? ' <span class="mute">(you)</span>' : ''}${p.connected ? '' : ' <span class="mute">(left)</span>'}
              <br><small class="mute">${p.count ? fmtN(p.count) + ' songs' : 'no songs shared'}</small></span>
            ${p.count && p.connected ? `<span class="share">${isHost ? `<input type="range" class="share-in" min="0" max="100" step="1" value="${p.share}" data-id="${esc(p.id)}" aria-label="Share of songs from ${esc(p.name)}">` : ''}<b class="pct num" data-id="${esc(p.id)}">${p.pct}%</b></span>` : ''}</div>`).join('')}</div>
          ${withSongs.length ? `<div class="mix-box"><h3>Whose songs get played</h3>
            <div class="mix-bar">${withSongs.map(p => `<i data-id="${esc(p.id)}" style="--pc:${playerColor(p.name)};width:${p.pct}%" title="${esc(p.name)} ${p.pct}%"></i>`).join('')}</div>
            <div class="mix-legend">${withSongs.map(p => `<span><i style="background:${playerColor(p.name)}"></i>${esc(p.name)} <b class="num" data-pct="${esc(p.id)}">${p.pct}%</b></span>`).join('')}</div>
            ${isHost && withSongs.length > 1 ? `<label class="chk"><input type="checkbox" data-act="mpExact" ${this.exact ? 'checked' : ''}> Exact split — e.g. 50/50 means every other song, not a coin flip each time</label>
              <div class="row" style="margin-top:8px"><button class="btn sm ghost" data-act="mpShareEven">Same for everyone</button><button class="btn sm ghost" data-act="mpShareSize">By number of songs</button></div>
              <p class="mute" style="margin:6px 0 0"><small>Drag someone’s slider to 0 to leave their songs out.</small></p>` : ''}</div>` : ''}
          ${isHost ? `<p class="mute" style="margin-top:12px">${fmtN(mixCount)} songs in the mix before filters.</p><div class="row"><button class="btn primary big" data-act="mpStart">Start game</button><button class="btn ghost" data-act="mpLeave">Close game</button></div>` : `<div class="row" style="margin-top:12px"><button class="btn ghost" data-act="mpLeave">Leave</button></div>`}
        </div>
      </div>`;
    if (hadList) flip(box, () => { box.innerHTML = html; }); else box.innerHTML = html;   // players who join slide in
  },
  /* update the percentages while a share slider is dragged, without redrawing the lobby */
  updateMix() {
    const sh = this.shares();
    for (const el of $$('.pct[data-id], [data-pct]')) el.textContent = (sh[el.dataset.id || el.dataset.pct] || 0) + '%';
    for (const el of $$('.mix-bar i[data-id]')) el.style.width = (sh[el.dataset.id] || 0) + '%';
  },
  mixPool() { return dedupe(Object.entries(this.libs).filter(([id]) => this.players[id]?.share > 0 && this.players[id]?.connected).flatMap(([, l]) => l)); },
  summary() { return `${this.coop ? 'Co-op · ' : ''}${PRESETS[this.mode].name}: ${settingsSummary({ ...modeSettings(this.mode), rule: 'classic' })}`; },
  startGame() {
    applyMode(this.mode); S.rule = 'classic';   // multiplayer is always a set number of songs
    const pool = Lib.filtered(this.mixPool());
    if (pool.length < 4) return toast('Fewer than 4 songs in the mix after filters.');
    // each player's songs come up according to their share; only songs everyone can hear are used (most guests get 30-second previews)
    const weights = {}; for (const p of Object.values(this.players)) if (p.connected && p.share > 0) weights[p.name] = p.share;
    const types = Engine.setup(pool, { groupBy: t => t.owners || [], weights, exact: this.exact, needPreview: true });
    if (!types.length) return toast('None of the selected question types work with these songs.');
    if (Engine.skipped.length) toast('Skipped ' + Engine.skipped.map(k => TYPES[k].name).join(', ') + ' — not enough song data.');
    for (const p of Object.values(this.players)) { p.score = 0; p.streak = 0; p.correct = 0; }
    this.from = {}; this.shown = {};
    this.names = Engine.names; this.total = S.rounds; this.round = 0; this.state = 'playing'; this.myHist = [];
    this.info = { ...buildInfo(this.mode, this.pub()), coop: this.coop, coopRetry: this.coopRetry };
    this.team = this.teamScore = { score: 0, streak: 0, correct: 0, best: 0 };
    this.broadcast({ t: 'start', names: this.names, total: this.total, info: this.info, coop: this.coop, coopRetry: this.coopRetry, teamScore: this.teamScore });
    this.enterGame(); this.hostNext();
  },
  enterGame() {
    Player.unlock(); UI.show('game'); Reveal.clear();
    $('#gameWrap').classList.add('mp'); $('#mpBoard').classList.remove('hidden');
    $('#hudExtra').textContent = ''; $('#hudStreak').textContent = '';
    this.renderBoard(this.host ? this.pub() : (this.lobby?.players || []));
  },
  /* reroll: same round, different song (the last one wouldn't play) */
  async hostNext(reroll = false) {
    clearTimeout(this.roundTimer);
    if (!reroll && this.round >= this.total) return this.hostEnd();
    this.state = 'loading'; Player.fadeOut(300);
    $('#qArea').innerHTML = '<div class="loading">Cueing up the next song…</div>'; Reveal.clear();
    let q = null;
    try { q = await Engine.nextPrepared(); } catch (e) { toast(e.message); }
    if (!this.active || !this.host) return;
    if (!q) { toast('Ran out of playable songs.'); return this.hostEnd(); }
    if (!reroll) this.round++;
    this.answers = {}; this.curQ = q; this.state = 'question'; this.started = false; this.ready = new Set();
    // everyone hears the same thing: full songs only when every player has Spotify Premium working, otherwise the 30 s preview
    q.previewOnly = !Object.values(this.players).filter(p => p.connected).every(p => p.id === 'host' ? Player.mode() === 'sdk' : p.sdk);
    const limit = this.curLimit = limitFor(q, true);
    this.broadcast({ t: 'q', round: this.round, total: this.total, q, limit });
    this.renderBoard(this.pub());
    // the round waits for everyone, so all start together; after a while the host may start without a stuck player
    clearTimeout(this.readyTimer); this.readyTimer = setTimeout(() => this.showWaiting(), 10000);
    this.prep(q, this.round);
  },
  /* load the song, then tell the host this player is ready */
  async prep(q, round) {
    this.hud(round); Reveal.clear();
    $('#qArea').innerHTML = '<div class="loading">Loading the song for everyone…</div>';
    if (q.audio && q.track) await Player.preload(q.track, { preview: !!q.previewOnly }).catch(() => false);
    if (round !== this.round || q !== this.curQ || this.started) return;
    if (this.host) this.onReady('host', Player.mode() === 'sdk');
    else this.up({ t: 'ready', round, qid: q.id, sdk: Player.mode() === 'sdk' });
  },
  onReady(pid, sdk) {
    if (this.state !== 'question' || this.started || !this.players[pid]) return;
    this.ready.add(pid); this.players[pid].sdk = sdk;
    const pub = this.pub(); this.broadcast({ t: 'answered', players: pub }); this.renderBoard(pub);
    this.checkReady();
  },
  checkReady() {
    const need = Object.values(this.players).filter(p => p.connected);
    if (need.every(p => this.ready.has(p.id))) this.go(); else if ($('#waitBox')) this.showWaiting();
  },
  /* host only: who the round is still waiting for, with a way to go on without them */
  showWaiting() {
    if (!this.host || this.state !== 'question' || this.started) return;
    const late = Object.values(this.players).filter(p => p.connected && !this.ready.has(p.id));
    if (!late.length) return this.go();
    $('#qArea').innerHTML = `<div class="loading" id="waitBox"><p>Waiting for ${late.map(p => `<b style="color:var(--ink)">${esc(p.name)}</b>`).join(', ')} to load the song…</p>
      <p><small>Everyone starts together, so nobody hears it first.</small></p><button class="btn" data-act="mpStartAnyway">Start without ${late.length > 1 ? 'them' : esc(late[0].name)}</button></div>`;
  },
  /* start the round for everyone at the same moment, with the host's break length */
  go() {
    if (this.state !== 'question' || this.started) return;
    this.started = true; clearTimeout(this.readyTimer);
    const pause = S.readyPause;
    this.broadcast({ t: 'go', round: this.round, pause });
    clearTimeout(this.roundTimer); this.roundTimer = setTimeout(() => this.hostReveal(), (this.curLimit + pause + 4) * 1000);
    this.renderBoard(this.pub());
    this.playLocal(this.curQ, this.curLimit, this.round, pause);
  },
  async playLocal(q, limit, round, pause = S.readyPause) {
    this.hud(round);
    Reveal.clear();
    const res = await QUI.run(q, { limit, names: this.names, roundLabel: round, pause, reroll: this.host && (this.rerolls || 0) < 3, onShown: this.host ? x => Engine.shown(x) : null });
    if (!this.active || round !== this.round || q !== this.curQ) return;
    if (res.unplayable && this.host) { this.rerolls = (this.rerolls || 0) + 1; Engine.markBad(q.track); toast('That song wouldn’t play — picking another.', 2500); return this.hostNext(true); }
    this.rerolls = 0;
    if (res.aborted) return;
    const slim = { correct: !!res.correct, factor: +res.factor || 0, points: Math.round(+res.points || 0), given: String(res.given ?? '').slice(0, 80), elapsed: +res.elapsed || 0, extra: res.extra || {} };
    const said = slim.given && slim.given !== '—';
    const wait = !this.coop ? ['Answer locked in', 'Waiting for the others…']
      : said && !slim.correct && this.coopRetry ? ['Not that one', 'Your teammates can still try…']
      : said ? ['Answer sent', 'That’s the team’s answer.'] : ['No answer', 'Waiting for your teammates…'];
    $('#revealBox').innerHTML = `<div class="reveal"><div class="rv-verdict"><span>${res.timeout ? 'Time’s up' : esc(wait[0])}</span></div><p class="mute" style="margin:0">${esc(wait[1])}</p></div>`;
    if (this.host) this.receive('host', slim); else this.up({ t: 'answer', round, qid: q.id, res: slim });
  },
  receive(pid, r) {
    if (this.state !== 'question' || this.answers[pid] || !this.players[pid]) return;
    const num = (v, max) => Number.isFinite(+v) ? clamp(+v, 0, max) : 0;
    const e = r.extra && typeof r.extra === 'object' ? r.extra : {};
    this.answers[pid] = { correct: r.correct === true, factor: num(r.factor, 1), points: num(r.points, S.maxPts * 1.5), given: String(r.given ?? '').slice(0, 80), elapsed: num(r.elapsed, 600),
      extra: { diff: Number.isInteger(e.diff) ? e.diff : undefined, stage: Number.isInteger(e.stage) ? e.stage : undefined, reveal: Number.isInteger(e.reveal) ? e.reveal : undefined } };
    if (this.coop) {
      const a = this.answers[pid], said = a.given && a.given !== '—';
      // the first real answer is the team's — unless wrong answers only rule themselves out
      if (said && (a.correct || a.factor > 0 || !this.coopRetry)) return this.hostReveal(pid);
      if (said) { const d = { t: 'tried', id: pid, name: this.players[pid].name, given: a.given }; this.broadcast(d); this.onTried(d); }
    }
    const pub = this.pub(); this.broadcast({ t: 'answered', players: pub }); this.renderBoard(pub);
    this.checkAll();
  },
  checkAll() { const need = Object.values(this.players).filter(p => p.connected); if (need.length && need.every(p => this.answers[p.id])) this.hostReveal(); },
  /* co-op: a teammate's wrong guess, shown to everyone; with multiple choice that option is ruled out */
  onTried(d) {
    const q = this.curQ; if (!q || !d || typeof d.given !== 'string') return;
    if (q.format === 'choice') { const b = $(`#qArea [data-i="${q.choices.indexOf(d.given)}"]`); if (b) { b.classList.add('wrong'); b.disabled = true; choiceMark(b, false); } }
    let log = $('#teamTries');
    if (!log) { $('#qArea')?.insertAdjacentHTML('beforeend', '<div class="team-tries" id="teamTries"></div>'); log = $('#teamTries'); }
    log?.insertAdjacentHTML('beforeend', `<div>${avatar(d.name)}<span><b>${esc(d.name)}</b> tried “${esc(d.given)}”</span><span class="x-mark">✗</span></div>`);
  },
  hostReveal(by = null) {
    if (this.state !== 'question') return;
    this.state = 'reveal'; clearTimeout(this.roundTimer);
    if (this.coop) return this.coopReveal(by);
    const results = {};
    for (const p of Object.values(this.players)) {
      const r = this.answers[p.id]; let pts = 0;
      if (r) {
        pts = clamp(Math.round(r.points || 0), 0, S.maxPts);
        if (r.correct) { p.streak++; p.correct++; if (S.streakBonus) pts = Math.round(pts * Score.streak(p.streak)); }
        else if (!(r.factor > 0)) { p.streak = 0; pts = -S.wrongPenalty; } else p.streak = 0;
      } else p.streak = 0;
      const before = p.score; p.score = Math.max(0, p.score + pts);
      results[p.id] = { ...(r || { given: null, timeout: true }), pts: p.score - before };
    }
    for (const o of this.curQ?.track?.owners || []) this.from[o] = (this.from[o] || 0) + 1;   // whose songs came up
    const msg = { t: 'reveal', round: this.round, results, players: this.pub(), last: this.round >= this.total };
    this.broadcast(msg); this.onReveal(msg);
  },
  /* co-op: one result for everyone — the answer of whoever answered (by), or nobody */
  coopReveal(by) {
    const a = by ? this.answers[by] : null, team = this.team;
    let pts = 0;
    if (a?.correct) {
      pts = clamp(Math.round(a.points || 0), 0, S.maxPts); team.streak++; team.correct++; team.best = Math.max(team.best, team.streak);
      if (S.streakBonus) pts = Math.round(pts * Score.streak(team.streak));
      if (this.players[by]) this.players[by].correct++;
    } else if (a && a.factor > 0) { pts = clamp(Math.round(a.points || 0), 0, S.maxPts); team.streak = 0; }
    else { team.streak = 0; if (a) pts = -S.wrongPenalty; }
    const before = team.score; team.score = Math.max(0, team.score + pts);
    const tries = Object.entries(this.answers).filter(([id, r]) => id !== by && r.given && r.given !== '—').map(([id, r]) => ({ name: this.players[id]?.name || '?', given: r.given }));
    for (const o of this.curQ?.track?.owners || []) this.from[o] = (this.from[o] || 0) + 1;
    const res = a ? { ...a, pts: team.score - before, by, byName: this.players[by]?.name } : { timeout: true, given: null, correct: false, factor: 0, pts: team.score - before };
    const msg = { t: 'reveal', coop: true, round: this.round, team: res, teamScore: { ...team }, tries, players: this.pub(), last: this.round >= this.total };
    this.broadcast(msg); this.onReveal(msg);
  },
  hostEnd() {
    clearTimeout(this.roundTimer); clearTimeout(this.readyTimer);
    this.state = 'ended'; const players = this.pub();
    const msg = { t: 'end', players, coop: this.coop, teamScore: this.teamScore, total: this.total };
    this.broadcast(msg); this.showPodium(players, msg);
  },
  backToLobby() {
    this.state = 'lobby'; this.answers = {}; this.round = 0;
    for (const [id, p] of Object.entries(this.players)) if (!p.connected && id !== 'host') { delete this.players[id]; delete this.libs[id]; }
    this.lobbyChanged();
  },

  /* guest side */
  async joinGame() {
    const code = ($('#mpCode')?.value || '').trim().toUpperCase();
    const name = ($('#mpName2')?.value || '').trim().slice(0, 20) || 'Guest';
    if (!/^[A-Z]{5}$/.test(code)) return toast('Enter the 5-letter game code.');
    this.myName = name; store.set('mpName', name);
    const share = !!$('#mpShare')?.checked;
    Player.unlock();
    this.reset();
    $('#scr-mp').innerHTML = '<div class="loading">Connecting…</div>';
    try { await Net.open(); } catch (e) { toast(e.message); return this.open(code); }
    this.active = true; this.host = false; this.state = 'joining';
    Net.on = m => this.guestNet(m, name, share);
    Net.onClose = () => { if (!this.active) return; if (this.state === 'ended') { this.active = false; return; } toast('Lost the connection to the game.'); this.leave(true); };
    Net.send({ t: 'join', code });
  },
  guestNet(m, name, share) {
    if (m.t === 'joined') {
      this.myId = m.id; this.state = 'lobby';
      const tracks = share ? shuffle(Lib.all()).slice(0, 1500).map(slimTrack) : [];
      this.up({ t: 'hello', name, key: mpKey(), tracks, sdk: Player.mode() === 'sdk' });
    } else if (m.t === 'error') { toast(m.msg || 'Couldn’t join.'); this.leave(true); }
    else if (m.t === 'closed') {
      if (this.state === 'ended') { this.active = false; Net.close(); return; }
      toast('The host closed the game.'); this.leave(true);
    } else if (m.t === 'msg') this.guestRecv(m.d);
  },
  guestRecv(d) {
    if (!d || typeof d !== 'object') return;
    switch (d.t) {
      case 'welcome': this.myId = d.id; break;
      case 'lobby':
        this.lobby = d;
        this.coop = !!d.coop; this.coopRetry = !!d.coopRetry;
        if (d.state === 'lobby') { if (this.state !== 'lobby') { QUI.abort(); Player.fadeOut(300); } this.state = 'lobby'; this.renderLobby(); }
        else this.renderBoard(d.players);
        break;
      case 'start':
        this.names = d.names || {}; this.total = d.total; this.info = d.info && typeof d.info === 'object' ? d.info : null;
        this.coop = !!d.coop; this.coopRetry = !!d.coopRetry; this.teamScore = d.teamScore && typeof d.teamScore === 'object' ? d.teamScore : { score: 0, streak: 0, correct: 0, best: 0 };
        this.state = 'playing'; this.myHist = []; this.enterGame(); $('#qArea').innerHTML = '<div class="loading">Get ready…</div>'; break;
      case 'tried': this.onTried(d); break;
      case 'q':
        if (!d.q || typeof d.q !== 'object') return;
        if (!$('#scr-game').classList.contains('active')) this.enterGame();
        Player.fadeOut(200); this.round = d.round; this.total = d.total; this.curQ = d.q; this.curLimit = d.limit; this.state = 'question'; this.started = false;
        this.prep(d.q, d.round); break;
      case 'go':
        if (d.round !== this.round || this.started || !this.curQ) return;
        this.started = true; this.playLocal(this.curQ, this.curLimit, this.round, clamp(+d.pause || 0, 0, 3)); break;
      case 'answered': this.renderBoard(d.players); break;
      case 'reveal': if (d.round === this.round) { this.state = 'reveal'; this.onReveal(d); } break;
      case 'end': this.state = 'ended'; QUI.abort(); Player.fadeOut(300); this.showPodium(d.players || [], d); break;
    }
  },

  /* shared */
  onReveal(msg) {
    if (msg.coop) return this.onCoopReveal(msg);
    QUI.abort();
    const q = this.curQ, mine = msg.results?.[this.myId];
    if (!q) return;
    if (!this.myHist.some(h => h.round === msg.round)) this.myHist.push({ round: msg.round, q, res: mine || { timeout: true, correct: false, factor: 0 }, pts: mine?.pts || 0 });
    QUI.markReveal(mine);
    if (mine?.correct) SFX.ok(); else if (mine?.factor > 0) SFX.part(); else SFX.bad();
    if (mine?.pts) floatPts(mine.pts);
    if (q.track && (q.audio || q.type === 'cover')) Player.afterAnswer(q.track, QUI.ctx?.startSec, !!q.previewOnly); else Player.fadeOut(300);
    this.learnColors(msg.players);
    const me = msg.players.find(p => p.id === this.myId);
    if (me) $('#hudStreak').textContent = streakTxt(me.streak);
    const R = id => msg.results?.[id] || {};
    const fastest = msg.players.filter(p => R(p.id).correct).sort((a, b) => (R(a.id).elapsed || 99) - (R(b.id).elapsed || 99))[0]?.id;
    const rows = [...msg.players].filter(p => p.connected || R(p.id).given).sort((a, b) => (R(b.id).pts || 0) - (R(a.id).pts || 0) || b.score - a.score);
    const table = `<div class="rv-players">${rows.map((p, i) => {
      const r = R(p.id), cls = r.correct ? 'ok' : r.factor > 0 ? 'part' : 'no';
      return `<div class="rvp ${cls}" style="animation-delay:${i * 70}ms">${avatar(p.name)}<span class="n"><b>${esc(p.name)}</b>${p.id === this.myId ? ' <small class="mute">(you)</small>' : ''}
        <br><small class="mute">${r.given && r.given !== '—' ? '“' + esc(r.given) + '”' : r.timeout ? 'ran out of time' : 'no answer'}${r.correct && r.elapsed ? ` · ${(+r.elapsed).toFixed(1)}s` : ''}</small></span>
        ${p.id === fastest && rows.length > 1 ? '<span class="tag fast" title="Fastest right answer">⚡ fastest</span>' : ''}
        <span class="mark" aria-hidden="true">${cls === 'ok' ? '✓' : cls === 'part' ? '≈' : '✗'}</span><b class="gain num">${r.pts > 0 ? '+' : ''}${esc(r.pts ?? 0)}</b></div>`;
    }).join('')}</div>`;    this.renderBoard(msg.players);
    const next = this.host ? () => this.hostNext() : null;
    Reveal.show({ q, res: mine || { timeout: true }, pts: mine?.pts || 0, last: msg.last, onNext: next, extraHTML: table, waiting: msg.last ? 'Final scores coming up…' : 'The host moves on to the next song.', nextLabel: msg.last ? 'Final scores' : 'Next song' });
  },
  onCoopReveal(msg) {
    QUI.abort();
    const q = this.curQ, res = msg.team && typeof msg.team === 'object' ? msg.team : { timeout: true };
    if (!q) return;
    if (msg.teamScore && typeof msg.teamScore === 'object') this.teamScore = msg.teamScore;
    if (!this.myHist.some(h => h.round === msg.round)) this.myHist.push({ round: msg.round, q, res, pts: res.pts || 0 });
    // everyone sees the team's pick
    if (q.format === 'choice' && res.given) $(`#qArea [data-i="${q.choices.indexOf(res.given)}"]`)?.classList.add('picked');
    QUI.markReveal(res);
    if (res.correct) SFX.ok(); else if (res.factor > 0) SFX.part(); else SFX.bad();
    if (res.pts) floatPts(res.pts);
    if (q.track && (q.audio || q.type === 'cover')) Player.afterAnswer(q.track, QUI.ctx?.startSec, !!q.previewOnly); else Player.fadeOut(300);
    this.learnColors(msg.players);
    $('#hudStreak').textContent = streakTxt(this.teamScore?.streak || 0);
    const cls = res.correct ? 'ok' : res.factor > 0 ? 'part' : 'no';
    const table = `<div class="rv-players">
      ${res.byName ? `<div class="rvp ${cls}">${avatar(res.byName)}<span class="n"><b>${esc(res.byName)}</b>${res.by === this.myId ? ' <small class="mute">(you)</small>' : ''} answered for the team
        <br><small class="mute">“${esc(res.given)}”${res.elapsed ? ` · ${(+res.elapsed).toFixed(1)}s` : ''}</small></span><span class="mark" aria-hidden="true">${cls === 'ok' ? '✓' : cls === 'part' ? '≈' : '✗'}</span><b class="gain num">${res.pts > 0 ? '+' : ''}${esc(res.pts ?? 0)}</b></div>`
        : `<div class="rvp no"><span class="n"><b>Nobody got it in time</b></span><b class="gain num">${res.pts ? esc(res.pts) : 0}</b></div>`}
      ${(msg.tries || []).map((t, i) => `<div class="rvp no" style="animation-delay:${(i + 1) * 70}ms">${avatar(t.name)}<span class="n"><b>${esc(t.name)}</b> tried<br><small class="mute">“${esc(t.given)}”</small></span><span class="mark" aria-hidden="true">✗</span></div>`).join('')}</div>`;
    this.renderBoard(msg.players);
    const next = this.host ? () => this.hostNext() : null;
    Reveal.show({ q, res, pts: res.pts || 0, last: msg.last, onNext: next, extraHTML: table, waiting: msg.last ? 'Final score coming up…' : 'The host moves on to the next song.', nextLabel: msg.last ? 'Final score' : 'Next song' });
  },
  hud(round) { $('#hudRound').innerHTML = `Song <b class="num">${esc(round)}</b> of ${esc(this.total)}`; },
  renderBoard(players) {
    const b = $('#mpBoard'); if (!b || !Array.isArray(players)) return;
    this.learnColors(players);
    if (this.coop) return this.renderTeamBoard(b, players);
    const sorted = [...players].filter(p => p.connected || p.score).sort((a, b) => b.score - a.score);
    const asking = this.state === 'question' || this.state === 'loading';
    flip(b, () => {
      b.innerHTML = `<h3>Scores <small class="mute">${this.round ? `song ${esc(this.round)} of ${esc(this.total)}` : ''}</small></h3>${sorted.map((p, i) => `<div class="board-row ${p.id === this.myId ? 'me' : ''}" data-key="${esc(p.id)}">
        <span class="pos">${i + 1}</span>${avatar(p.name)}
        <span class="n">${esc(p.name)}${p.connected ? '' : ' <small class="mute">(left)</small>'}${p.streak >= 3 ? ` <small class="streak">🔥${p.streak}</small>` : ''}</span>
        ${asking && p.connected ? this.statusIcon(p) : ''}
        <b class="num sc" data-v="${this.shown[p.id] ?? p.score}">${fmtN(this.shown[p.id] ?? p.score)}</b></div>`).join('')}
        ${this.info ? `<details class="gi-more"><summary>About this game</summary>${infoHTML(this.info)}</details>` : ''}`;
      const more = $('.gi-more', b); if (more && this.infoOpen) more.open = true;
      more?.addEventListener('toggle', () => { this.infoOpen = more.open; });
    });
    for (const p of sorted) { countUp($(`.board-row[data-key="${CSS.escape(p.id)}"] .sc`, b), p.score); this.shown[p.id] = p.score; }
    const me = players.find(p => p.id === this.myId); if (me) countUp($('#hudScore'), me.score);
  },
  /* ⏳ still loading the song · … thinking · ✓ answered */
  statusIcon(p) {
    if (p.answered) return '<span class="st done" title="Answered">✓</span>';
    if (!this.started && !p.ready) return '<span class="st load" title="Loading the song">⏳</span>';
    return '<span class="st" title="Thinking">…</span>';
  },
  /* co-op scoreboard: the team's score, and who has answered what */
  renderTeamBoard(b, players) {
    const ts = this.teamScore || { score: 0, streak: 0, correct: 0 }, asking = this.state === 'question' || this.state === 'loading';
    const list = players.filter(p => p.connected || p.correct);
    const shownScore = this.shown.team ?? ts.score;
    flip(b, () => {
      b.innerHTML = `<h3>🤝 Team <small class="mute">${this.round ? `song ${esc(this.round)} of ${esc(this.total)}` : ''}</small></h3>
        <div class="team-score"><b class="num sc" data-v="${shownScore}">${fmtN(shownScore)}</b><span class="mute">${fmtN(ts.correct)} right${ts.streak >= 3 ? ` · <span class="streak">🔥${ts.streak}</span>` : ''}</span></div>
        ${list.map(p => `<div class="board-row ${p.id === this.myId ? 'me' : ''}" data-key="${esc(p.id)}">${avatar(p.name)}
          <span class="n">${esc(p.name)}${p.connected ? '' : ' <small class="mute">(left)</small>'}</span>
          ${asking && p.connected ? this.statusIcon(p) : ''}
          <small class="mute num" title="Right answers for the team">${fmtN(p.correct)} ✓</small></div>`).join('')}
        ${this.info ? `<details class="gi-more"><summary>About this game</summary>${infoHTML(this.info)}</details>` : ''}`;
      const more = $('.gi-more', b); if (more && this.infoOpen) more.open = true;
      more?.addEventListener('toggle', () => { this.infoOpen = more.open; });
    });
    countUp($('.team-score .sc', b), ts.score); countUp($('#hudScore'), ts.score); this.shown.team = ts.score;
  },
  showPodium(players, end = {}) {
    Reveal.clear(); Player.fadeOut(300);
    if (end.coop) return this.showTeamResult(players, end);
    const sorted = [...players].sort((a, b) => b.score - a.score), hist = this.myHist || [];
    if (hist.length) { const me = sorted.find(p => p.id === this.myId); let best = 0, run = 0; for (const h of hist) { run = h.res.correct ? run + 1 : 0; best = Math.max(best, run); } Stats.record({ key: 'multiplayer', name: 'Multiplayer', score: me?.score || 0, bestStreak: best, mp: true, place: sorted.indexOf(me) + 1, players: sorted.length }, hist); this.myHist = []; }
    this.learnColors(sorted);
    const medal = ['🥇', '🥈', '🥉'], top = [sorted[1], sorted[0], sorted[2]], place = [2, 1, 3];
    $('#scr-results').innerHTML = `<div class="res-head"><p class="mute">Final scores</p><div class="res-score" style="font-size:clamp(40px,8vw,80px)">${esc(sorted[0]?.name || '')} wins</div></div>
      <div class="podium-stage">${top.map((p, i) => p ? `<div class="pod p${place[i]}" style="--pc:${playerColor(p.name)}">${avatar(p.name, 'big')}<b>${esc(p.name)}</b><span class="num">${fmtN(p.score)}</span><div class="block"><span>${medal[place[i] - 1]}</span></div></div>` : '<div class="pod empty"></div>').join('')}</div>
      <div class="podium panel">${sorted.map((p, i) => `<div class="board-row" style="font-size:17px;animation-delay:${300 + i * 80}ms"><span class="pos">${medal[i] || i + 1}</span>${avatar(p.name)}<span class="n"><b>${esc(p.name)}</b>${p.id === this.myId ? ' <small class="mute">(you)</small>' : ''}
        <br><small class="mute">${fmtN(p.correct)} right${p.from ? ` · ${fmtN(p.from)} of the songs were theirs` : ''}</small></span><b class="num">${fmtN(p.score)}</b></div>`).join('')}
      <div class="row" style="margin-top:16px">${this.host ? '<button class="btn primary" data-act="mpLobby">Back to lobby</button><button class="btn ghost" data-act="mpLeave">Close game</button>' : '<span class="mute">Waiting for the host…</span><button class="btn ghost" data-act="mpLeave">Leave</button>'}</div></div>
      ${hist.length ? `<h2 class="res-songs-h">All the songs <small class="mute">your answers</small></h2>${songListHTML(hist)}` : ''}`;
    UI.show('results');
  },
  showTeamResult(players, end) {
    const ts = end.teamScore && typeof end.teamScore === 'object' ? end.teamScore : this.teamScore || { score: 0, correct: 0, best: 0 };
    const sorted = [...players].filter(p => p.connected || p.correct || p.from).sort((a, b) => b.correct - a.correct || b.from - a.from);
    const n = this.myHist?.length || end.total || 0;
    const hist = this.myHist || [];
    if (hist.length) { Stats.record({ key: 'coop', name: 'Co-op', score: ts.score, bestStreak: ts.best || 0, mp: true, players: sorted.length }, hist); this.myHist = []; }
    this.learnColors(sorted);
    $('#scr-results').innerHTML = `<div class="res-head"><p class="mute">🤝 Team score</p><div class="res-score num">${fmtN(ts.score)}</div>
        <div class="res-stats"><div class="stat"><b class="num">${fmtN(ts.correct)}/${fmtN(n)}</b><span>right</span></div><div class="stat"><b class="num">${fmtN(ts.best || 0)}</b><span>best streak</span></div><div class="stat"><b class="num">${fmtN(sorted.length)}</b><span>players</span></div></div></div>
      <div class="podium panel"><h3>Who helped</h3>${sorted.map((p, i) => `<div class="board-row" style="font-size:17px;animation-delay:${200 + i * 80}ms">${avatar(p.name)}<span class="n"><b>${esc(p.name)}</b>${p.id === this.myId ? ' <small class="mute">(you)</small>' : ''}
        <br><small class="mute">${p.from ? `${fmtN(p.from)} of the songs were theirs` : 'no songs of theirs came up'}</small></span><b class="num">${fmtN(p.correct)} ✓</b></div>`).join('')}
      <div class="row" style="margin-top:16px">${this.host ? '<button class="btn primary" data-act="mpLobby">Back to lobby</button><button class="btn ghost" data-act="mpLeave">Close game</button>' : '<span class="mute">Waiting for the host…</span><button class="btn ghost" data-act="mpLeave">Leave</button>'}</div></div>
      ${hist.length ? `<h2 class="res-songs-h">All the songs</h2>${songListHTML(hist)}` : ''}`;
    UI.show('results');
  },
  reset() {
    clearTimeout(this.roundTimer); clearTimeout(this.readyTimer);
    Net.on = null; Net.onClose = null; Net.close();
    Object.assign(this, { conns: new Set(), players: {}, libs: {}, answers: {}, curQ: null, round: 0, total: 0, state: 'idle', lobby: null, code: null, myId: null, from: {}, shown: {} });
    PlayerColors.clear();
  },
  leave(silent = false) {
    QUI.abort(); Reveal.clear(); Player.fadeOut(300);
    if (this.host && !silent) this.broadcast({ t: 'end', players: this.pub() });
    this.reset(); this.active = false;
    this.open();
  }
};

Object.assign(Act, {
  mpHost() { MP.hostGame(); },
  mpJoin() { MP.joinGame(); },
  mpStart() { MP.startGame(); },
  mpLeave() { if (MP.active && MP.state !== 'ended' && !confirm(MP.host ? 'Close the game for everyone?' : 'Leave the game?')) return; MP.leave(); },
  mpLobby() { MP.backToLobby(); },
  mpCopy() { const link = SITE_DIR + 'join/' + MP.code; navigator.clipboard?.writeText(link).then(() => toast('Invite link copied.'), () => toast(link, 8000)); },
  mpShareEven() { for (const p of Object.values(MP.players)) p.share = 50; MP.lobbyChanged(); },
  mpShareSize() { const max = Math.max(1, ...Object.values(MP.players).map(p => p.count)); for (const p of Object.values(MP.players)) p.share = p.count ? Math.max(1, Math.round(p.count / max * 100)) : 0; MP.lobbyChanged(); },
  mpPreset(el) { if (!PRESETS[el.dataset.k]) return; MP.mode = el.dataset.k; MP.lobbyChanged(); },
  mpStyle(el) { MP.coop = el.dataset.v === 'coop'; MP.lobbyChanged(); },
  mpRetry(el) { MP.coopRetry = el.checked; MP.lobbyChanged(); },
  mpExact(el) { MP.exact = el.checked; MP.lobbyChanged(); },
  mpStartAnyway() { MP.go(); },
  mpSettings() { SettingsUI.open('modal', MP.mode, { mp: true, onClose: () => { if (MP.host && MP.state === 'lobby') MP.lobbyChanged(); } }); },
  quit() { Act.mpLeave(); }
});
document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('#mpCode, #mpName2')) Act.mpJoin(); });
/* share sliders: live percentages while dragging, everyone is told when it's let go */
document.addEventListener('input', e => { if (!e.target.matches('.share-in') || !MP.host) return; const p = MP.players[e.target.dataset.id]; if (p) { p.share = +e.target.value; MP.updateMix(); } });
document.addEventListener('change', e => { if (e.target.matches('.share-in') && MP.host) MP.lobbyChanged(); });
window.addEventListener('beforeunload', e => { if (MP.active && !['idle', 'ended'].includes(MP.state)) { e.preventDefault(); e.returnValue = ''; } });
Header.render('mp'); Player.initSDK(); Player.badge();
Lib.init().then(() => MP.open((new URLSearchParams(location.search).get('join') || '').toUpperCase().slice(0, 5)));
