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
      src: ['mp'], owners: [owner]
    };
  }).filter(Boolean);
}

/* ---------------- the game ---------------- */
const MP = {
  active: false, host: false, code: null, conns: new Set(), players: {}, libs: {}, myId: null,
  mode: 'classic', from: {}, shown: {}, state: 'idle', round: 0, total: 0, answers: {}, curQ: null, curLimit: 0, roundTimer: null, names: {}, lobby: null, myName: '', myHist: [],
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
      answered: !!this.answers[p.id], streak: p.streak, correct: p.correct, from: this.from[p.name] || 0 }));
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
    if (p) { p.connected = false; toast(p.name + ' left'); this.lobbyChanged(); if (this.state === 'question') this.checkAll(); }
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
      this.send(id, { t: 'welcome', id });
      toast(name + (old ? ' is back' : ' joined'));
      if (this.state !== 'lobby') {
        this.send(id, { t: 'start', names: this.names, total: this.total });
        if (this.state === 'question' && this.curQ) this.send(id, { t: 'q', round: this.round, total: this.total, q: this.curQ, limit: this.curLimit });
      }
      this.lobbyChanged();
    } else if (d.t === 'answer') {
      if (d.round === this.round && d.qid === this.curQ?.id && d.res && typeof d.res === 'object') this.receive(id, d.res);
    }
  },
  lobbyChanged() {
    const m = { t: 'lobby', code: this.code, players: this.pub(), hostName: this.players.host?.name, summary: this.summary(), state: this.state };
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
            ${isHost && withSongs.length > 1 ? `<div class="row" style="margin-top:8px"><button class="btn sm ghost" data-act="mpShareEven">Same for everyone</button><button class="btn sm ghost" data-act="mpShareSize">By number of songs</button></div>
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
  summary() { return `${PRESETS[this.mode].name}: ${settingsSummary({ ...modeSettings(this.mode), rule: 'classic' })}`; },
  startGame() {
    applyMode(this.mode); S.rule = 'classic';   // multiplayer is always a set number of songs
    const pool = Lib.filtered(this.mixPool());
    if (pool.length < 4) return toast('Fewer than 4 songs in the mix after filters.');
    // each player's songs come up according to their share; only songs everyone can hear are used (most guests get 30-second previews)
    const weights = {}; for (const p of Object.values(this.players)) if (p.connected && p.share > 0) weights[p.name] = p.share;
    const types = Engine.setup(pool, { groupBy: t => t.owners || [], weights, needPreview: true });
    if (!types.length) return toast('None of the selected question types work with these songs.');
    if (Engine.skipped.length) toast('Skipped ' + Engine.skipped.map(k => TYPES[k].name).join(', ') + ' — not enough song data.');
    for (const p of Object.values(this.players)) { p.score = 0; p.streak = 0; p.correct = 0; }
    this.from = {}; this.shown = {};
    this.names = Engine.names; this.total = S.rounds; this.round = 0; this.state = 'playing'; this.myHist = [];
    this.broadcast({ t: 'start', names: this.names, total: this.total });
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
    this.answers = {}; this.curQ = q; this.state = 'question';
    const limit = this.curLimit = limitFor(q, true);
    this.broadcast({ t: 'q', round: this.round, total: this.total, q, limit });
    this.roundTimer = setTimeout(() => this.hostReveal(), (limit + 4) * 1000);
    this.renderBoard(this.pub());
    this.playLocal(q, limit, this.round);
  },
  async playLocal(q, limit, round) {
    this.hud(round);
    Reveal.clear();
    const res = await QUI.run(q, { limit, names: this.names, roundLabel: round, pause: S.readyPause, reroll: this.host && (this.rerolls || 0) < 3, onShown: this.host ? x => Engine.shown(x) : null });
    if (!this.active || round !== this.round || q !== this.curQ) return;
    if (res.unplayable && this.host) { this.rerolls = (this.rerolls || 0) + 1; Engine.markBad(q.track); toast('That song wouldn’t play — picking another.', 2500); return this.hostNext(true); }
    this.rerolls = 0;
    if (res.aborted) return;
    const slim = { correct: !!res.correct, factor: +res.factor || 0, points: Math.round(+res.points || 0), given: String(res.given ?? '').slice(0, 80), elapsed: +res.elapsed || 0, extra: res.extra || {} };
    $('#revealBox').innerHTML = `<div class="reveal"><div class="rv-verdict"><span>${res.timeout ? 'Time’s up' : 'Answer locked in'}</span></div><p class="mute" style="margin:0">Waiting for the others…</p></div>`;
    if (this.host) this.receive('host', slim); else this.up({ t: 'answer', round, qid: q.id, res: slim });
  },
  receive(pid, r) {
    if (this.state !== 'question' || this.answers[pid] || !this.players[pid]) return;
    const num = (v, max) => Number.isFinite(+v) ? clamp(+v, 0, max) : 0;
    const e = r.extra && typeof r.extra === 'object' ? r.extra : {};
    this.answers[pid] = { correct: r.correct === true, factor: num(r.factor, 1), points: num(r.points, S.maxPts * 1.5), given: String(r.given ?? '').slice(0, 80), elapsed: num(r.elapsed, 600),
      extra: { diff: Number.isInteger(e.diff) ? e.diff : undefined, stage: Number.isInteger(e.stage) ? e.stage : undefined, reveal: Number.isInteger(e.reveal) ? e.reveal : undefined } };
    const pub = this.pub(); this.broadcast({ t: 'answered', players: pub }); this.renderBoard(pub);
    this.checkAll();
  },
  checkAll() { const need = Object.values(this.players).filter(p => p.connected); if (need.length && need.every(p => this.answers[p.id])) this.hostReveal(); },
  hostReveal() {
    if (this.state !== 'question') return;
    this.state = 'reveal'; clearTimeout(this.roundTimer);
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
  hostEnd() {
    clearTimeout(this.roundTimer);
    this.state = 'ended'; const players = this.pub();
    this.broadcast({ t: 'end', players }); this.showPodium(players);
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
      this.up({ t: 'hello', name, key: mpKey(), tracks });
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
        if (d.state === 'lobby') { if (this.state !== 'lobby') { QUI.abort(); Player.fadeOut(300); } this.state = 'lobby'; this.renderLobby(); }
        else this.renderBoard(d.players);
        break;
      case 'start': this.names = d.names || {}; this.total = d.total; this.state = 'playing'; this.myHist = []; this.enterGame(); $('#qArea').innerHTML = '<div class="loading">Get ready…</div>'; break;
      case 'q':
        if (!d.q || typeof d.q !== 'object') return;
        if (!$('#scr-game').classList.contains('active')) this.enterGame();
        Player.fadeOut(200); this.round = d.round; this.total = d.total; this.curQ = d.q; this.state = 'question';
        this.playLocal(d.q, d.limit, d.round); break;
      case 'answered': this.renderBoard(d.players); break;
      case 'reveal': if (d.round === this.round) { this.state = 'reveal'; this.onReveal(d); } break;
      case 'end': this.state = 'ended'; QUI.abort(); Player.fadeOut(300); this.showPodium(d.players || []); break;
    }
  },

  /* shared */
  onReveal(msg) {
    QUI.abort();
    const q = this.curQ, mine = msg.results?.[this.myId];
    if (!q) return;
    if (!this.myHist.some(h => h.round === msg.round)) this.myHist.push({ round: msg.round, q, res: mine || { timeout: true, correct: false, factor: 0 }, pts: mine?.pts || 0 });
    QUI.markReveal(mine);
    if (mine?.correct) SFX.ok(); else if (mine?.factor > 0) SFX.part(); else SFX.bad();
    if (mine?.pts) floatPts(mine.pts);
    if (q.track && (q.audio || q.type === 'cover')) Player.afterAnswer(q.track, QUI.ctx?.startSec); else Player.fadeOut(300);
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
  hud(round) { $('#hudRound').innerHTML = `Song <b class="num">${esc(round)}</b> of ${esc(this.total)}`; },
  renderBoard(players) {
    const b = $('#mpBoard'); if (!b || !Array.isArray(players)) return;
    this.learnColors(players);
    const sorted = [...players].filter(p => p.connected || p.score).sort((a, b) => b.score - a.score);
    const asking = this.state === 'question' || this.state === 'loading';
    flip(b, () => {
      b.innerHTML = `<h3>Scores <small class="mute">${this.round ? `song ${esc(this.round)} of ${esc(this.total)}` : ''}</small></h3>${sorted.map((p, i) => `<div class="board-row ${p.id === this.myId ? 'me' : ''}" data-key="${esc(p.id)}">
        <span class="pos">${i + 1}</span>${avatar(p.name)}
        <span class="n">${esc(p.name)}${p.connected ? '' : ' <small class="mute">(left)</small>'}${p.streak >= 3 ? ` <small class="streak">🔥${p.streak}</small>` : ''}</span>
        ${asking && p.connected ? `<span class="st ${p.answered ? 'done' : ''}" title="${p.answered ? 'Locked in' : 'Thinking'}">${p.answered ? '✓' : '…'}</span>` : ''}
        <b class="num sc" data-v="${this.shown[p.id] ?? p.score}">${fmtN(this.shown[p.id] ?? p.score)}</b></div>`).join('')}`;
    });
    for (const p of sorted) { countUp($(`.board-row[data-key="${CSS.escape(p.id)}"] .sc`, b), p.score); this.shown[p.id] = p.score; }
    const me = players.find(p => p.id === this.myId); if (me) countUp($('#hudScore'), me.score);
  },
  showPodium(players) {
    Reveal.clear(); Player.fadeOut(300);
    const sorted = [...players].sort((a, b) => b.score - a.score);
    if (this.myHist?.length) { const me = sorted.find(p => p.id === this.myId); let best = 0, run = 0; for (const h of this.myHist) { run = h.res.correct ? run + 1 : 0; best = Math.max(best, run); } Stats.record({ key: 'multiplayer', name: 'Multiplayer', score: me?.score || 0, bestStreak: best, mp: true, place: sorted.indexOf(me) + 1, players: sorted.length }, this.myHist); this.myHist = []; }
    this.learnColors(sorted);
    const medal = ['🥇', '🥈', '🥉'], top = [sorted[1], sorted[0], sorted[2]], place = [2, 1, 3];
    $('#scr-results').innerHTML = `<div class="res-head"><p class="mute">Final scores</p><div class="res-score" style="font-size:clamp(40px,8vw,80px)">${esc(sorted[0]?.name || '')} wins</div></div>
      <div class="podium-stage">${top.map((p, i) => p ? `<div class="pod p${place[i]}" style="--pc:${playerColor(p.name)}">${avatar(p.name, 'big')}<b>${esc(p.name)}</b><span class="num">${fmtN(p.score)}</span><div class="block"><span>${medal[place[i] - 1]}</span></div></div>` : '<div class="pod empty"></div>').join('')}</div>
      <div class="podium panel">${sorted.map((p, i) => `<div class="board-row" style="font-size:17px;animation-delay:${300 + i * 80}ms"><span class="pos">${medal[i] || i + 1}</span>${avatar(p.name)}<span class="n"><b>${esc(p.name)}</b>${p.id === this.myId ? ' <small class="mute">(you)</small>' : ''}
        <br><small class="mute">${fmtN(p.correct)} right${p.from ? ` · ${fmtN(p.from)} of the songs were theirs` : ''}</small></span><b class="num">${fmtN(p.score)}</b></div>`).join('')}
      <div class="row" style="margin-top:16px">${this.host ? '<button class="btn primary" data-act="mpLobby">Back to lobby</button><button class="btn ghost" data-act="mpLeave">Close game</button>' : '<span class="mute">Waiting for the host…</span><button class="btn ghost" data-act="mpLeave">Leave</button>'}</div></div>`;
    UI.show('results');
  },
  reset() {
    clearTimeout(this.roundTimer);
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
