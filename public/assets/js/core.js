'use strict';
/* Earworm core — shared by every page. */
/* window.EARWORM_CONFIG comes from /config.js, which the server builds from its .env file */
const CFG = Object.assign({ CLIENT_ID: '', ALLOW_CLIENT_ID_SETUP: false, DEFAULT_CHART: 'Worldwide' }, window.EARWORM_CONFIG || {});
const SCOPES = ['user-library-read', 'user-library-modify', 'playlist-read-private', 'playlist-read-collaborative', 'user-top-read',
  'streaming', 'user-read-email', 'user-read-private', 'user-modify-playback-state', 'user-read-playback-state'];
const SITE_DIR = location.origin + '/';
const REDIRECT_URI = SITE_DIR + 'callback';
const CURRENT_YEAR = new Date().getFullYear();

/* ---------------- utilities ---------------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rand = n => Math.floor(Math.random() * n);
const pick = a => a[rand(a.length)];
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = rand(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const uid = () => Math.random().toString(36).slice(2, 10);
const fmtN = n => Number(n || 0).toLocaleString('en-US');
const go = page => { location.href = SITE_DIR + page; };   // go('play'), go('game?mode=classic')
function randStr(n) { const c = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'; return [...crypto.getRandomValues(new Uint8Array(n))].map(x => c[x % c.length]).join(''); }
async function pkceChallenge(v) { const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v)); return btoa(String.fromCharCode(...new Uint8Array(d))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
const store = {
  get(k, d) { try { const v = localStorage.getItem('ew_' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('ew_' + k, JSON.stringify(v)); return true; } catch (e) { console.warn('storage', k, e); return false; } },
  del(k) { try { localStorage.removeItem('ew_' + k); } catch {} }
};
const session = {
  get(k, d) { try { const v = sessionStorage.getItem('ew_' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { sessionStorage.setItem('ew_' + k, JSON.stringify(v)); } catch {} },
  del(k) { try { sessionStorage.removeItem('ew_' + k); } catch {} }
};
function toast(msg, ms = 4200) {
  let box = $('#toasts'); if (!box) { box = document.createElement('div'); box.id = 'toasts'; box.setAttribute('aria-live', 'polite'); document.body.appendChild(box); }
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; box.appendChild(t); setTimeout(() => t.remove(), ms);
}
/* our own server: Deezer / iTunes lookups, charts and previews */
async function api(path, params, { timeout = 12000, retries = 2 } = {}) {
  const url = path + (params ? '?' + new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '')) : '');
  for (let attempt = 0; ; attempt++) {
    let res;
    try { res = await fetch(url, { signal: AbortSignal.timeout(timeout), headers: { Accept: 'application/json' } }); }
    catch (e) { if (attempt < retries) { await sleep(600 * (attempt + 1)); continue; } throw new Error('Can’t reach the Earworm server. Check your connection.'); }
    if ((res.status === 429 || res.status === 503) && attempt < retries) { await sleep(1500 * (attempt + 1)); continue; }
    let j = null; try { j = await res.json(); } catch {}
    if (!res.ok) { const e = new Error(j?.error || 'HTTP ' + res.status); e.status = res.status; throw e; }
    return j;
  }
}
/* IndexedDB key/value store for song lists (too big for localStorage). Falls back to memory. */
const DB = {
  mem: new Map(), p: null,
  open() {
    if (!this.p) this.p = new Promise((res, rej) => {
      const r = indexedDB.open('earworm', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); r.onblocked = () => rej(new Error('blocked'));
    }).catch(e => { console.warn('IndexedDB unavailable, songs won’t be kept', e); return null; });
    return this.p;
  },
  async run(mode, fn) {
    const db = await this.open(); if (!db) return undefined;
    return new Promise((res, rej) => { const tx = db.transaction('kv', mode), r = fn(tx.objectStore('kv')); tx.oncomplete = () => res(r.result); tx.onerror = tx.onabort = () => rej(tx.error); });
  },
  async get(k) { try { const v = await this.run('readonly', s => s.get(k)); return v === undefined ? this.mem.get(k) : v; } catch { return this.mem.get(k); } },
  async set(k, v) { this.mem.set(k, v); try { await this.run('readwrite', s => s.put(v, k)); } catch (e) { console.warn('save', k, e); } },
  async del(k) { this.mem.delete(k); try { await this.run('readwrite', s => s.delete(k)); } catch {} }
};
async function pool(items, n, fn) {
  let i = 0, err = null;
  const worker = async () => { while (i < items.length && !err) { const it = items[i++]; try { await fn(it); } catch (e) { err = e; } } };
  await Promise.all(Array.from({ length: n }, worker));
  if (err) throw err;
}

/* ---------------- text matching ---------------- */
const stripAcc = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đð]/g, 'd').replace(/[ĐÐ]/g, 'D').replace(/ß/g, 'ss').replace(/ø/g, 'o').replace(/æ/g, 'ae');
function cleanTitle(s) { s = String(s || ''); const c = s.replace(/\s*[\(\[][^\)\]]*[\)\]]/g, '').replace(/\s+-\s+.*$/, '').trim(); return c || s; }
function normAns(s) {
  return stripAcc(cleanTitle(s)).toLowerCase().replace(/\s(feat|ft|featuring)\.?\s.*$/, '').replace(/&/g, ' and ')
    .replace(/[^a-z0-9\u0400-\u04ff\u3040-\u30ff\u4e00-\u9fff\uac00-\ud7af]+/g, ' ').replace(/^the /, '').trim();
}
const normArtist = s => stripAcc(String(s || '')).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9\u0400-\u04ff\u3040-\u30ff\u4e00-\u9fff\uac00-\ud7af]+/g, ' ').replace(/^the /, '').trim();
function lev(a, b) {
  if (a === b) return 0; const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) { const cur = [i]; for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; }
  return prev[n];
}
function sim(a, b) { a = normAns(a); b = normAns(b); if (!a || !b) return 0; if (a === b) return 1; return 1 - lev(a, b) / Math.max(a.length, b.length); }
function nearEq(a, b) { if (!a || !b) return false; if (a === b) return true; if (b.length <= 3) return false; return lev(a, b) <= Math.max(1, Math.floor(b.length * 0.2)); }
function isMatch(input, accepts) { const a = normAns(input); return !!a && accepts.some(x => nearEq(a, normAns(x))); }
function artistMatch(input, artists) { const a = normArtist(input); return !!a && artists.some(x => nearEq(a, normArtist(x))); }
const SEP_RE = /\s+[-–—]\s+|\s*[–—]\s*/;
/* Song answers can be "Artist – Title" (either order). Returns {ok, needArtist} */
function matchSong(input, title, artists, requireArtist) {
  const s = String(input || '').trim(); if (!s) return { ok: false };
  const m = s.split(SEP_RE);
  if (m.length >= 2) {
    const a = m[0], b = m.slice(1).join(' - ');
    if (artistMatch(a, artists) && isMatch(b, [title])) return { ok: true };
    if (artistMatch(b, artists) && isMatch(a, [title])) return { ok: true };
    if (isMatch(s, [title])) return { ok: !requireArtist, needArtist: requireArtist };   // title itself contains a dash
    return { ok: false };
  }
  if (isMatch(s, [title])) return requireArtist ? { ok: false, needArtist: true } : { ok: true };
  return { ok: false };
}
function maskAnswer(s) { return cleanTitle(s).split(/(\s+)/).map(w => /\s/.test(w) ? '  ' : [...w].map((ch, i) => i === 0 || !/[\p{L}\p{N}]/u.test(ch) ? ch : '_').join('')).join(''); }
const songLabel = t => `${t.artists?.[0]?.name || ''} – ${t.name}`;

/* ---------------- settings ---------------- */
const DEFAULTS = {
  rule: 'classic', rounds: 10, lives: 3, blitzTime: 60, timeLimit: 15,
  types: { title: true, artist: true, album: false, year: false, cover: false, heardle: false, genre: false, truefalse: false, first: false, oddone: false },
  answerFormat: 'choice', numChoices: 4, difficulty: 'normal', autocomplete: true, requireArtist: true, hints: true, autoAdvance: 5,
  speedBonus: true, maxPts: 100, minPts: 50, fullWindow: 2, decayEnd: 10, streakBonus: true, wrongPenalty: 0,
  audioSource: 'auto', clipStart: 'random', clipLength: 0, volume: 0.7, afterAnswer: 'fade', sfx: true, oddPreview: false,
  coverStyle: 'pixelate', coverAnswer: 'album', coverAudio: false,
  yearFormat: 'slider', yearShowInfo: true,
  mixMode: 'even',                  // 'even': every song source gets the same share of questions; 'size': bigger sources come up more
  avoidRecent: true, recentGames: 3, // keep songs from your last N games out until nothing else is left
  filters: { yearMin: null, yearMax: null, genres: [], artist: '', noExplicit: false },
  accent: '#ffb547', maxLiked: 1000, topRange: 'medium_term'
};
function deepMerge(a, b) {
  for (const k in b) {
    if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a[k] && typeof a[k] === 'object') deepMerge(a[k], b[k]);
    else if (b[k] !== undefined) a[k] = b[k];
  }
  return a;
}
let S = deepMerge(JSON.parse(JSON.stringify(DEFAULTS)), store.get('settings', {}));
if (S.keepPlaying === false && S.afterAnswer === 'fade') S.afterAnswer = 'stop';
delete S.keepPlaying; delete S.blendShare; delete S.filters.sources;   // older versions
function saveS() { store.set('settings', S); applyAccent(); }
function setPath(path, v) { const ks = path.split('.'); let o = S; while (ks.length > 1) o = o[ks.shift()]; o[ks[0]] = v; }
function getPath(path) { return path.split('.').reduce((o, k) => o?.[k], S); }
function applyAccent() {
  const c = /^#[0-9a-f]{6}$/i.test(S.accent) ? S.accent : '#ffb547';
  const r = parseInt(c.slice(1, 3), 16), g = parseInt(c.slice(3, 5), 16), b = parseInt(c.slice(5, 7), 16);
  document.documentElement.style.setProperty('--acc', c);
  document.documentElement.style.setProperty('--acc-ink', (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.55 ? '#1c1030' : '#fff8ee');
}
applyAccent();

/* ---------------- Spotify auth (PKCE) ---------------- */
const clientId = () => CFG.CLIENT_ID || (CFG.ALLOW_CLIENT_ID_SETUP ? store.get('clientId', '') : '');
let Me = store.get('me', null);
const Auth = {
  tok: store.get('token', null),
  hasScope(s) { return !!this.tok?.scope && this.tok.scope.split(' ').includes(s); },
  async login(returnTo) {
    const verifier = randStr(64), state = randStr(16);
    localStorage.setItem('ew_pkce', JSON.stringify({ verifier, state, returnTo: returnTo || location.href }));
    const p = new URLSearchParams({ response_type: 'code', client_id: clientId(), scope: SCOPES.join(' '), redirect_uri: REDIRECT_URI, code_challenge_method: 'S256', code_challenge: await pkceChallenge(verifier), state });
    location.href = 'https://accounts.spotify.com/authorize?' + p;
  },
  async handleCallback() {
    const q = new URLSearchParams(location.search);
    let pk = {}; try { pk = JSON.parse(localStorage.getItem('ew_pkce') || '{}'); } catch {}
    localStorage.removeItem('ew_pkce');
    if (q.get('error')) throw new Error('Spotify login was cancelled (' + q.get('error') + ').');
    const code = q.get('code'); if (!code) throw new Error('Spotify didn’t send a login code.');
    if (!pk.verifier || pk.state !== q.get('state')) throw new Error('Login check failed. Start the login again from the same browser tab.');
    const res = await fetch('https://accounts.spotify.com/api/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI, client_id: clientId(), code_verifier: pk.verifier }) });
    const j = await res.json();
    if (!res.ok) throw new Error(j.error_description || j.error || 'token exchange failed');
    this.save(j);
    return pk.returnTo;
  },
  save(j) { this.tok = { access: j.access_token, refresh: j.refresh_token || this.tok?.refresh, exp: Date.now() + (j.expires_in - 60) * 1000, scope: j.scope || this.tok?.scope || '' }; store.set('token', this.tok); },
  async token() {
    if (!this.tok) throw new Error('Not logged in');
    if (Date.now() < this.tok.exp) return this.tok.access;
    if (!this._ref) this._ref = this.refresh().finally(() => { this._ref = null; });
    await this._ref; return this.tok.access;
  },
  async refresh() {
    const res = await fetch('https://accounts.spotify.com/api/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: this.tok.refresh, client_id: clientId() }) });
    const j = await res.json();
    if (!res.ok) { this.tok = null; store.del('token'); toast('Your Spotify session expired. Log in again.'); throw new Error('session expired'); }
    this.save(j);
  },
  /* forget the account and everything read from it, so the next person on this browser sees none of it */
  logout() {
    this.tok = null; Me = null; store.del('token'); store.del('me'); store.del('playlists'); store.del('genres'); store.del('likedNow');
    const sets = store.get('sets', []), personal = m => ['liked', 'top', 'pl', 'blend'].includes(m.kind);
    for (const m of sets.filter(personal)) DB.del('set:' + m.key);
    store.set('sets', sets.filter(m => !personal(m)));
  }
};
async function sp(path, opts = {}) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const t = await Auth.token();
    const res = await fetch(path.startsWith('http') ? path : 'https://api.spotify.com/v1' + path, { ...opts, headers: { Authorization: 'Bearer ' + t, ...(opts.body ? { 'Content-Type': 'application/json' } : {}), ...(opts.headers || {}) } });
    if (res.status === 401 && attempt === 0) { Auth.tok.exp = 0; continue; }
    if (res.status === 429) {
      let body = {}; try { body = await res.clone().json(); } catch {}
      if (body?.error?.reason === 'QUOTA_EXCEEDED') throw new Error('This Spotify app has used up its API quota for now. Try again later.');
      await sleep(Math.min(+res.headers.get('Retry-After') || 2, 10) * 1000); continue;
    }
    if (res.status === 204 || res.status === 202) return null;
    const txt = await res.text(); let j = null; try { j = txt ? JSON.parse(txt) : null; } catch {}
    if (!res.ok) { const e = new Error(j?.error?.message || txt || ('HTTP ' + res.status)); e.status = res.status; throw e; }
    return j;
  }
  throw new Error('Spotify is rate limiting requests. Wait a moment and try again.');
}
async function loadMe() {
  if (!Auth.tok) return null;
  try { Me = await sp('/me'); store.set('me', Me); return Me; }
  catch (e) {
    if (e.status === 403) toast('Spotify refused this account. The app owner needs to add your Spotify email under User Management in the developer dashboard.', 9000);
    if (e.status === 403 || e.status === 400) Auth.logout();
    return null;
  }
}

/* ---------------- sound effects ---------------- */
const SFX = {
  ctx: null,
  ensure() { if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)(); if (this.ctx.state === 'suspended') this.ctx.resume(); },
  tone(f, d, type = 'sine', v = 0.07, delay = 0) {
    if (!S.sfx) return;
    try { this.ensure(); const c = this.ctx, o = c.createOscillator(), g = c.createGain(), t = c.currentTime + delay; o.type = type; o.frequency.value = f; g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d); o.connect(g).connect(c.destination); o.start(t); o.stop(t + d + 0.02); } catch {}
  },
  ok() { this.tone(660, 0.12, 'triangle'); this.tone(990, 0.2, 'triangle', 0.07, 0.1); },
  part() { this.tone(520, 0.16, 'triangle'); },
  bad() { this.tone(170, 0.28, 'sawtooth', 0.045); },
  tick() { this.tone(1300, 0.04, 'square', 0.025); }
};

/* ---------------- modal ---------------- */
const Modal = {
  onClose: null,
  el() {
    let m = $('#modal');
    if (!m) { m = document.createElement('div'); m.id = 'modal'; m.className = 'modal hidden'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true'); m.innerHTML = '<div class="sheet" id="sheet"></div>'; document.body.appendChild(m); m.addEventListener('click', e => { if (e.target === m) Modal.close(); }); }
    return m;
  },
  open(html, cls = '', onClose = null) { const m = this.el(); $('#sheet').className = 'sheet ' + cls; $('#sheet').innerHTML = html; m.classList.remove('hidden'); this.onClose = onClose; },
  close() { const m = $('#modal'); if (!m) return; m.classList.add('hidden'); $('#sheet').innerHTML = ''; const f = this.onClose; this.onClose = null; f && f(); },
  isOpen() { const m = $('#modal'); return !!m && !m.classList.contains('hidden'); }
};

/* ---------------- header / navigation ---------------- */
const Header = {
  render(active) {
    const h = $('#hdr'); if (!h) return;
    const links = [['play', 'Play', 'play'], ['multiplayer', 'Friends', 'mp'], ['settings', 'Settings', 'settings']];
    const av = Me?.images?.length ? `<img src="${esc(Me.images[Me.images.length - 1].url)}" alt="">` : `<span class="av">${esc(((Me?.display_name) || 'G')[0].toUpperCase())}</span>`;
    h.innerHTML = `<a class="brand" href="${SITE_DIR}play"><span class="brand-disc"></span>Earworm</a>
      <nav class="nav">${links.map(([href, label, key]) => `<a href="${SITE_DIR}${href}" class="${active === key ? 'on' : ''}">${label}</a>`).join('')}</nav>
      <div class="top-r"><span id="audioBadge" class="badge hidden"></span>
        <div class="menu"><button class="user" data-act="menu" aria-haspopup="true">${av}<span class="uname">${esc(Me?.display_name || 'Guest')}</span></button>
          <div class="menu-pop hidden" id="menuPop">
            <a href="${SITE_DIR}stats">Your stats</a>
            ${Auth.tok ? `<button data-act="logout">Log out</button>` : `<button data-act="login">Log in with Spotify</button>`}
          </div></div></div>`;
  }
};
document.addEventListener('click', e => {
  const pop = $('#menuPop');
  if (pop && !e.target.closest('.menu')) pop.classList.add('hidden');
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && Modal.isOpen()) Modal.close(); });

/* shared click actions; pages add their own to Act */
const Act = {
  menu() { $('#menuPop')?.classList.toggle('hidden'); },
  login() { if (!clientId()) return go(''); Auth.login().catch(e => toast(e.message)); },
  logout() { Auth.logout(); go(''); },
  closeModal() { Modal.close(); }
};
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]'); if (!el || el.disabled) return;
  const fn = Act[el.dataset.act]; if (!fn) return;
  if (el.tagName === 'A') e.preventDefault();
  fn(el, e);
});
