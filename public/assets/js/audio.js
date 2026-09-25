'use strict';
/* Plays full songs through the Spotify Web Playback SDK (Premium) or 30-second previews (Deezer / iTunes). */
const SILENT = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
const Player = {
  el: new Audio(), sdk: null, deviceId: null, sdkReady: false, sdkFailed: false, transferred: false,
  cache: new Map(), pending: new Map(), token: 0, stopTimer: null, fadeTimer: null, current: null, usingSDK: false, playing: false,
  onChange: null,
  sdkErrors: 0,
  wantSDK() { return S.audioSource !== 'preview' && !!Auth.tok && !this.sdkFailed && !this.sdkBrokenRecently(); },
  /* if full songs kept failing on an earlier page, use previews for a while instead of starting silent again */
  sdkBrokenRecently() { return Date.now() - (session.get('sdkBroken', 0) || 0) < 10 * 60_000; },
  /* Spotify said it would play but nothing started: after two of those, switch this browser tab to previews */
  sdkFailedOnce(e) {
    console.warn('Spotify playback failed, using a preview instead', e);
    if (++this.sdkErrors < 2 || this.sdkFailed) return;
    this.sdkFailed = true; session.set('sdkBroken', Date.now()); this.badge();
    toast('Full songs through Spotify aren’t starting, so Earworm switched to 30-second previews for the next 10 minutes.', 9000);
    try { this.sdk?.disconnect(); } catch {}
  },
  useSDK(t) { return this.wantSDK() && this.sdkReady && t && t.uri; },
  initSDK() {
    if (this._init || !this.wantSDK()) return; this._init = true;
    window.onSpotifyWebPlaybackSDKReady = () => {
      const p = new Spotify.Player({ name: 'Earworm quiz', getOAuthToken: cb => Auth.token().then(cb).catch(() => {}), volume: S.volume });
      p.addListener('ready', ({ device_id }) => { this.deviceId = device_id; this.sdkReady = true; this.badge(); });
      p.addListener('not_ready', () => { this.sdkReady = false; this.badge(); });
      p.addListener('account_error', () => { this.sdkFailed = true; this.badge(); });
      p.addListener('initialization_error', () => { this.sdkFailed = true; this.badge(); });
      p.addListener('authentication_error', () => { this.sdkFailed = true; this.badge(); });
      p.connect(); this.sdk = p;
      // leaving the page: remove this player from Spotify, so the next page's player isn't fighting a dead one
      addEventListener('pagehide', () => { try { p.pause().catch(() => {}); p.disconnect(); } catch {} });
    };
    const s = document.createElement('script'); s.src = 'https://sdk.scdn.co/spotify-player.js';
    s.onerror = () => { this.sdkFailed = true; this.badge(); };
    document.head.appendChild(s);
    setTimeout(() => { if (!this.sdkReady && !this.sdkFailed) { this.sdkFailed = true; this.badge(); } }, 12000);
  },
  mode() { if (!this.wantSDK()) return 'preview'; if (this.sdkReady) return 'sdk'; return 'connecting'; },
  badge() {
    const b = $('#audioBadge'); if (!b) return;
    const m = this.mode(); b.classList.remove('hidden'); b.className = 'badge' + (m === 'sdk' ? ' good' : '');
    b.textContent = m === 'sdk' ? 'Full songs' : m === 'connecting' ? 'Connecting player…' : '30s previews';
    b.title = m === 'sdk' ? 'Playing full songs through Spotify Premium' : 'Full songs need Spotify Premium; previews are used instead';
  },
  unlock() {
    try { this.sdk?.activateElement?.(); } catch {}
    try { const el = this.el; if (!el.src || el.src === SILENT) { el.src = SILENT; el.play()?.then?.(() => el.pause()).catch(() => {}); } } catch {}
    try { SFX.ensure(); } catch {}
  },
  setVolume(v) { this.el.volume = v; try { this.sdk?.setVolume(v); } catch {} },
  /* Deezer preview links expire (…exp=1727000000…); treat one as stale a little before that */
  fresh(url) { const m = /exp=(\d{9,11})/.exec(url || ''); return !!url && (!m || +m[1] * 1000 > Date.now() + 90_000); },
  /* The server finds a 30-second preview and checks the file really plays before returning it.
     Resolves the URL, or null when the song has no preview. Throws only when the server can't be reached. */
  async resolvePreview(t) {
    const c = this.cache.get(t.id);
    if (c && (c.url ? this.fresh(c.url) : Date.now() - c.at < 10 * 60_000)) return c.url;
    if (this.pending.has(t.id)) return this.pending.get(t.id);
    const p = (async () => {
      let url = null;
      try { url = (await api('/api/preview', { dz: t.dz?.id, isrc: t.isrc, t: t.name, a: t.artists[0]?.name || '' }, { timeout: 20000 })).url || null; }
      catch (e) { if (e.status !== 404) throw e; }
      this.cache.set(t.id, { url, at: Date.now() });
      return url;
    })().finally(() => this.pending.delete(t.id));
    this.pending.set(t.id, p);
    return p;
  },
  markBroken(t) { this.cache.set(t.id, { url: null, at: Date.now() }); },
  /* can this song be played? needPreview: every player needs a preview (multiplayer guests rarely have Premium) */
  async prepare(t, { needPreview = false } = {}) {
    if (!needPreview && this.useSDK(t)) return true;
    return !!(await this.resolvePreview(t));
  },
  computeStart(frac, need, dur) {
    if (frac === 0) return 0;
    if (this.usingSDK) { if (frac === -1) return dur * 0.4; const lo = dur * 0.1, hi = Math.max(lo, Math.min(dur * 0.72, dur - need - 2)); return lo + frac * (hi - lo); }
    const hi = Math.max(0, dur - need - 1); return frac === -1 ? Math.min(8, hi) : frac * hi;
  },
  changed() { try { this.onChange?.(this.current, this.playing); } catch {} },
  /* load a song ahead of time, so it starts at once (multiplayer waits for everyone's). preview: skip Spotify's player */
  async preload(t, { preview = false } = {}) {
    if (!preview && this.useSDK(t)) return true;
    this.hardStop();
    let url; try { url = await this.resolvePreview(t); } catch { return false; }
    if (!url) return false;
    const el = this.el;
    if (el.src !== url) { el.preload = 'auto'; el.src = url; try { el.load(); } catch {} }
    if (el.readyState >= 3) return true;
    return new Promise(res => {
      const done = v => { clearTimeout(tm); el.removeEventListener('canplay', ok); el.removeEventListener('error', bad); res(v); };
      const ok = () => done(true), bad = () => done(false), tm = setTimeout(() => done(true), 5000);   // phones may not load until played
      el.addEventListener('canplay', ok); el.addEventListener('error', bad);
    });
  },
  /* opts: {frac, start, len, need, preview}. Resolves {ok, start} or {ok: false, superseded | blocked | unplayable} */
  async play(t, opts = {}) {
    this.hardStop();
    const my = ++this.token; this.current = t.id; this.playing = true; this.changed();
    const fail = r => { if (my === this.token) { this.playing = false; this.changed(); } return { ok: false, ...r, superseded: my !== this.token }; };
    if (!opts.preview && this.useSDK(t)) {
      try {
        this.usingSDK = true;
        const dur = (t.dur || 180000) / 1000;
        const start = opts.start ?? this.computeStart(opts.frac ?? 0, opts.need || 15, dur);
        this.sdk.setVolume(S.volume).catch(() => {});
        // Spotify's requests can stall (or wait out rate limits); never let that hold a question up for long
        await Promise.race([this.sdkPlay(t.uri, start * 1000, my), sleep(7000).then(() => { throw new Error('Spotify took too long to start the song'); })]);
        if (my !== this.token) return { ok: false, superseded: true };
        this.sdkErrors = 0;
        this.schedStop(opts.len, my); return { ok: true, start };
      } catch (e) {
        if (my !== this.token) return { ok: false, superseded: true };
        this.sdk?.pause().catch(() => {});
        this.sdkFailedOnce(e);
      }
    }
    this.usingSDK = false;
    let url = null, offline = false;
    try { url = await this.resolvePreview(t); } catch { offline = true; }
    if (my !== this.token) return { ok: false, superseded: true };
    if (!url) return fail({ unplayable: !offline, offline });
    const el = this.el;
    if (el.src !== url) {
      el.src = url;
      const loaded = await new Promise(res => {
        const done = v => { clearTimeout(tm); el.removeEventListener('loadedmetadata', ok); el.removeEventListener('error', bad); res(v); };
        const ok = () => done(true), bad = () => done(false), tm = setTimeout(() => done(null), 4000);
        el.addEventListener('loadedmetadata', ok); el.addEventListener('error', bad);
      });
      if (loaded === false) { this.markBroken(t); return fail({ unplayable: true }); }
    }
    if (my !== this.token) return { ok: false, superseded: true };
    const dur = isFinite(el.duration) && el.duration > 0 ? el.duration : 30;
    const start = opts.start ?? this.computeStart(opts.frac ?? 0, opts.need || 15, dur);
    try { el.currentTime = clamp(start, 0, Math.max(0, dur - 0.5)); } catch {}
    el.volume = S.volume;
    try { await Promise.race([el.play(), sleep(6000).then(() => { throw new Error('Audio took too long to start'); })]); }
    catch (e) {
      // only a real media error means the file is broken; a slow start (bad network, background tab) is not
      const blocked = e.name === 'NotAllowedError', broken = !blocked && (e.name === 'NotSupportedError' || !!el.error);
      if (broken) this.markBroken(t);
      return fail({ blocked, unplayable: broken });
    }
    if (my !== this.token) return { ok: false, superseded: true };
    el.onended = () => { if (my === this.token) { this.playing = false; this.changed(); } };
    this.schedStop(opts.len, my); return { ok: true, start };
  },
  async sdkPlay(uri, posMs, my) {
    const body = JSON.stringify({ uris: [uri], position_ms: Math.max(0, Math.floor(posMs)) });
    const transfer = () => sp('/me/player', { method: 'PUT', body: JSON.stringify({ device_ids: [this.deviceId], play: false }) });
    if (!this.transferred) { await transfer().catch(() => {}); this.transferred = true; await sleep(350); }
    try { await sp('/me/player/play?device_id=' + this.deviceId, { method: 'PUT', body }); }
    catch (e) { if (e.status === 404 || e.status === 502) { await transfer(); await sleep(700); await sp('/me/player/play?device_id=' + this.deviceId, { method: 'PUT', body }); } else throw e; }
    // only count it as playing once the in-browser player really is (Spotify can accept the request and stay silent)
    const t0 = performance.now();
    while (performance.now() - t0 < 5000) {
      if (my !== this.token) return;
      const st = await this.sdk.getCurrentState().catch(() => null);
      if (st && !st.paused && !st.loading) return;
      await sleep(120);
    }
    throw new Error('Spotify accepted the song but the player in this page never started');
  },
  schedStop(len, my) { clearTimeout(this.stopTimer); if (len > 0) this.stopTimer = setTimeout(() => { if (my === this.token) this.pauseNow(); }, len * 1000); },
  pauseNow() {
    clearTimeout(this.stopTimer); clearInterval(this.fadeTimer);
    try { this.el.pause(); this.el.volume = S.volume; } catch {}
    if (this.usingSDK) { this.sdk?.pause().catch(() => {}); this.sdk?.setVolume(S.volume).catch(() => {}); }
    this.playing = false; this.changed();
  },
  hardStop() { this.token++; this.pauseNow(); this.current = null; },
  /* fade to silence over ms, after an optional delay; a newer play() cancels it */
  fadeOut(ms = 1500, delay = 0) {
    const my = this.token; clearTimeout(this.stopTimer); clearInterval(this.fadeTimer);
    if (!this.playing) return;
    const run = () => {
      if (my !== this.token) return;
      const steps = Math.max(1, Math.round(ms / 60)); let i = 0;
      this.fadeTimer = setInterval(() => {
        if (my !== this.token) { clearInterval(this.fadeTimer); return; }
        i++; const v = S.volume * Math.max(0, 1 - i / steps);
        if (this.usingSDK) this.sdk?.setVolume(Math.max(0.0001, v)).catch(() => {}); else this.el.volume = v;
        if (i >= steps) { clearInterval(this.fadeTimer); this.pauseNow(); }
      }, 60);
    };
    if (delay > 0) this.stopTimer = setTimeout(run, delay); else run();
  },
  stop(fast = true) { if (fast) this.fadeOut(350); else this.hardStop(); },
  /* after an answer: keep the song going (resume if the clip ended), then fade per settings */
  async afterAnswer(t, startSec, preview = false) {
    clearTimeout(this.stopTimer);
    if (S.afterAnswer === 'stop' || !t) return this.fadeOut(300);
    if (this.current === t.id) {
      if (!this.playing) { if (this.usingSDK) this.sdk?.resume().catch(() => {}); else this.el.play().catch(() => {}); this.playing = true; this.changed(); }
    } else {
      await this.play(t, { start: startSec ?? undefined, frac: -1, len: 0, need: 20, preview });
    }
    if (S.afterAnswer === 'fade') this.fadeOut(1600, 2000);
  },
  /* preview buttons: toggle a track */
  async toggle(t) {
    if (this.current === t.id && this.playing) { this.fadeOut(250); return false; }
    const r = await this.play(t, { frac: -1, len: 0, need: 30 });
    if (!r.ok && !r.superseded) toast(r.offline ? 'Can’t reach the Earworm server.' : r.blocked ? 'Your browser blocked audio. Tap play again.' : 'No preview available for this song.');
    return r.ok;
  }
};
