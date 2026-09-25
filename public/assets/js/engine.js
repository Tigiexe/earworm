'use strict';
/* ---------------- scoring ---------------- */
const Score = {
  speed(t, sc = S) { const M = sc.maxPts, m = Math.min(sc.minPts, sc.maxPts), a = sc.fullWindow, b = sc.decayEnd; if (!sc.speedBonus || t <= a) return M; if (t >= b || b <= a) return m; return Math.round(M - (M - m) * (t - a) / (b - a)); },
  cover(frac, sc = S) { if (!sc.speedBonus) return sc.maxPts; return Math.round(sc.maxPts - (sc.maxPts - Math.min(sc.minPts, sc.maxPts)) * frac); },
  /* Heardle: top score at the first step, falling to the lowest right-answer score at the last one */
  heardle(stage, sc = S, steps = 6) { const n = Math.max(1, steps - 1), f = Math.pow(Math.max(0, n - stage) / n, 1.25); const m = Math.min(sc.minPts, sc.maxPts); return Math.round(m + (sc.maxPts - m) * f); },
  yearFactor(d) { return [1, 0.8, 0.6, 0.4, 0.2, 0.2][d] ?? 0; },
  streak(n) { return n >= 10 ? 1.5 : n >= 5 ? 1.25 : n >= 3 ? 1.1 : 1; }
};
const scoringSnapshot = () => ({ maxPts: S.maxPts, minPts: S.minPts, fullWindow: S.fullWindow, decayEnd: S.decayEnd, speedBonus: S.speedBonus, hints: S.hints, requireArtist: S.requireArtist, oddPreview: S.oddPreview });

/* ---------------- question types ---------------- */
const TYPES = {
  title:     { name: 'Song title',        icon: '🎵', desc: 'Hear a clip, name the song', audio: true },
  artist:    { name: 'Artist',            icon: '🎤', desc: 'Who is singing?', audio: true },
  album:     { name: 'Album',             icon: '💿', desc: 'Which album is it from?', audio: true },
  year:      { name: 'Release year',      icon: '📅', desc: 'Guess when it came out', audio: true },
  cover:     { name: 'Cover reveal',      icon: '🖼️', desc: 'The artwork sharpens as time runs out', audio: false },
  heardle:   { name: 'Heardle',           icon: '⏱️', desc: '1 second, then 2, 4, 7… guess early', audio: true },
  genre:     { name: 'Genre',             icon: '🏷️', desc: 'Name the genre (scan genres first)', audio: true },
  truefalse: { name: 'True or false',     icon: '⚖️', desc: 'Is the statement about the clip right?', audio: true },
  first:     { name: 'Which came first?', icon: '⏳', desc: 'Pick the older of two songs', audio: false },
  oddone:    { name: 'Odd one out',       icon: '🧩', desc: 'Three songs share an artist, one doesn’t', audio: false }
};
/* the big instruction shown right above the answers: [lead, keyword] */
function taskText(q) {
  switch (q.type) {
    case 'title': return ['Name the', 'song'];
    case 'artist': return ['Name the', 'artist'];
    case 'album': return ['Name the', 'album'];
    case 'year': return ['Guess the', 'release year'];
    case 'cover': return q.suggest === 'artist' ? ['Whose cover? Name the', 'artist'] : q.suggest === 'title' ? ['Cover reveal: name the', 'song'] : ['Cover reveal: name the', 'album'];
    case 'heardle': return ['Name the', 'song, as early as you can'];
    case 'genre': return ['Pick the', 'genre'];
    case 'truefalse': return ['True or false?', ''];
    case 'first': return ['Which song came out', 'first?'];
    case 'oddone': return ['Find the song by a', 'different artist'];
  }
  return ['', ''];
}
/* what the player has to name, with its own colour, so a switch from "song" to "artist" is hard to miss */
const GUESS = {
  song:   { label: 'Guess the song',   color: '#4de0e0' },
  artist: { label: 'Guess the artist', color: '#ff5e8a' },
  album:  { label: 'Guess the album',  color: '#c58bff' },
  year:   { label: 'Guess the year',   color: '#ffe066' },
  genre:  { label: 'Guess the genre',  color: '#6fe3a4' },
  tf:     { label: 'True or false',    color: '#7aa7ff' },
  odd:    { label: 'Odd one out',      color: '#ff8a4c' }
};
function guessOf(q) {
  switch (q.type) {
    case 'artist': return 'artist';
    case 'album': return 'album';
    case 'year': case 'first': return 'year';
    case 'genre': return 'genre';
    case 'truefalse': return 'tf';
    case 'oddone': return 'odd';
    case 'cover': return q.suggest === 'artist' ? 'artist' : q.suggest === 'title' ? 'song' : 'album';
    default: return 'song';   // title, heardle
  }
}
const HEARDLE_STAGES = [1, 2, 4, 7, 11, 16];   // steps used before they became a setting (older stats)
/* a mode's Heardle steps, cleaned up: 2–10 increasing values between 0.1 and 30 seconds */
function heardleSteps(v) {
  const a = [...new Set((Array.isArray(v) ? v : []).map(Number).filter(x => x >= 0.1 && x <= 30).map(x => Math.round(x * 10) / 10))].sort((a, b) => a - b).slice(0, 10);
  return a.length >= 2 ? a : [0.1, 1, 2, 4, 7, 11, 16];
}
const fmtSec = v => `${Math.round(v * 10) / 10}s`;
const DIFFICULTIES = [['easy', 'Random'], ['normal', 'Similar'], ['hard', 'Very similar'], ['artist', 'Same artist'], ['album', 'Same album']];

function artistGroups(pool) {
  const m = new Map();
  for (const t of pool) { const a = t.artists[0]; if (!a) continue; const k = normArtist(a.name); if (!m.has(k)) m.set(k, { key: k, name: a.name, tracks: [], keys: new Set() }); const g = m.get(k); const tk = normAns(t.name); if (!g.keys.has(tk)) { g.keys.add(tk); g.tracks.push(t); } }
  return [...m.values()].filter(g => g.tracks.length >= 3);
}
function feasible(k, pool) {
  const years = new Set(pool.map(t => t.album.year).filter(Boolean));
  switch (k) {
    case 'year': return years.size >= 1;
    case 'first': return years.size >= 2;
    case 'album': return new Set(pool.map(t => normAns(t.album.name))).size >= 2;
    case 'genre': return pool.some(t => broadOf(t).size);
    case 'oddone': return artistGroups(pool).length > 0 && new Set(pool.map(t => normArtist(t.artists[0]?.name))).size >= 2;
    case 'cover': return pool.some(t => t.album.image);
    default: return pool.length >= 2;
  }
}
function uniqNames(arr) { const m = new Map(); for (const n of arr) { if (!n) continue; const k = normAns(n); if (k && !m.has(k)) m.set(k, n); } return [...m.values()].sort((a, b) => a.localeCompare(b)); }
function similarTo(t) {
  const d = S.difficulty === 'artist' || S.difficulty === 'album' ? 'hard' : S.difficulty;
  if (d === 'easy') return null;
  const g = broadOf(t), y = t.album.year, ak = normArtist(t.artists[0]?.name);
  return x => {
    if (x.id === t.id) return false;
    if (d === 'hard' && normArtist(x.artists[0]?.name) === ak) return true;
    const yOk = y && x.album.year && Math.abs(x.album.year - y) <= (d === 'hard' ? 3 : 8);
    const gOk = g.size > 0 && [...broadOf(x)].some(v => g.has(v));
    return d === 'hard' ? (gOk && (yOk || !y)) || (yOk && !g.size) : (gOk || yOk);
  };
}
/* pick k values that differ from `exclude`: first from `extra` (catalog lookups), then from the pool */
function distinct(pool, getter, exclude, k, prefer, extra = []) {
  const seen = new Set(exclude.map(normAns)); const out = [];
  const push = v => { if (!v) return; const n = normAns(v); if (!n || seen.has(n)) return; seen.add(n); out.push(v); };
  for (const v of shuffle(extra)) { if (out.length >= k) break; push(v); }
  let cands = shuffle(pool);
  if (prefer) cands = [...cands.filter(prefer), ...cands.filter(x => !prefer(x))];
  for (const t of cands) { if (out.length >= k) break; push(getter(t)); }
  return out;
}
function yearChoices(y, k) {
  const spread = S.difficulty === 'easy' ? 12 : S.difficulty === 'normal' ? 7 : 3;
  const set = new Set([y]); let tries = 0;
  while (set.size < k + 1 && tries++ < 200) { const d = rand(spread * 2 + 1) - spread; const c = y + d; if (d && c <= CURRENT_YEAR && c > 1900) set.add(c); }
  return [...set].sort((a, b) => a - b).map(String);
}
/* catalog-backed wrong options, depending on the "wrong options" setting */
async function extraOptions(kind, t) {
  const d = S.difficulty; if (d !== 'artist' && d !== 'album') return [];
  const timeout = p => Promise.race([p, sleep(4500).then(() => [])]);
  try {
    if (kind === 'title') {
      if (d === 'album') { const a = await timeout(Catalog.albumTitles(t)); if (a.length >= 3) return a; return [...a, ...await timeout(Catalog.artistTitles(t))]; }
      return timeout(Catalog.artistTitles(t));
    }
    if (kind === 'artist') return timeout(Catalog.similarArtists(t));
    if (kind === 'album') return timeout(Catalog.artistAlbums(t));
  } catch (e) { console.warn(e); }
  return [];
}

/* ---------------- songs from your last games (kept out of new games while there are others) ---------------- */
const Recent = {
  d: Object.assign({ game: 0, songs: {} }, store.get('recent', {})),   // songs: trackKey -> number of the game it was last in
  begin() { this.d.game++; this.save(); },
  add(t) { if (t?.name) this.d.songs[trackKey(t)] = this.d.game; },
  save() { const min = this.d.game - 20; for (const [k, g] of Object.entries(this.d.songs)) if (g < min) delete this.d.songs[k]; store.set('recent', this.d); },
  has(key, games) { const g = this.d.songs[key]; return g != null && g < this.d.game && g >= this.d.game - games; },
  clear() { this.d.songs = {}; this.save(); }
};

const Engine = {
  pool: [], groups: [], keys: new Map(), used: new Set(), bad: new Set(), lastArtists: [], types: [], skipped: [], names: {}, opts: {},
  /* opts.groupBy(track) -> source keys used to balance the mix; opts.weights {key: share} (multiplayer shares);
     opts.needPreview for multiplayer */
  setup(pool, opts = {}) {
    this.pool = pool; this.opts = opts; this.used = new Set(); this.bad = new Set(); this.lastArtists = [];
    this.picked = {}; this.chosenGroup = null; this.exact = opts.exact ?? S.exactSplit; this.groupOf = new Map();
    this.keys = new Map(pool.map(t => [t.id, trackKey(t)])); this.poolKeys = new Set(this.keys.values());
    const by = opts.groupBy || (t => t.src || []), groups = new Map();
    for (const t of pool) for (const g of (by(t)?.length ? by(t) : ['?'])) { if (!groups.has(g)) groups.set(g, []); groups.get(g).push(t); }
    this.groups = [...groups.entries()].map(([key, tracks]) => ({ key, tracks }));
    this.planQuotas(opts.total ?? (S.rule === 'classic' ? S.rounds : 0));
    const want = Object.keys(TYPES).filter(k => S.types[k]);
    this.types = want.filter(k => feasible(k, pool));
    this.skipped = want.filter(k => !this.types.includes(k));
    this.names = {
      title: uniqNames(pool.map(songLabel)),
      artist: uniqNames(pool.flatMap(t => t.artists.map(a => a.name))),
      album: uniqNames(pool.map(t => t.album.name ? `${t.artists[0]?.name} – ${t.album.name}` : ''))
    };
    Recent.begin();
    return this.types;
  },
  key(t) { return this.keys.get(t.id) || trackKey(t); },
  avail(t) { return !this.used.has(this.key(t)) && !this.bad.has(t.id); },
  /* exact split: how many of the game's songs each group gets (largest remainder, so 25/25/25/25 of 20 is 5/5/5/5) */
  planQuotas(n) {
    this.quota = null;
    if (!this.exact || !(n > 0) || this.groups.length < 2) return;
    const W = this.opts.weights, size = S.mixMode === 'size';
    const w = this.groups.map(g => ({ key: g.key, w: W ? Math.max(0, W[g.key] || 0) : size ? g.tracks.length : 1 })), tot = w.reduce((a, x) => a + x.w, 0);
    if (!tot) return;
    const exact = w.map(x => ({ key: x.key, v: x.w / tot * n })), q = {};
    for (const x of exact) q[x.key] = Math.floor(x.v);
    let left = n - Object.values(q).reduce((a, b) => a + b, 0);
    for (const x of shuffle(exact).sort((a, b) => (b.v % 1) - (a.v % 1))) { if (left <= 0) break; if (x.v > 0) { q[x.key]++; left--; } }
    this.quota = q;
  },
  /* a picked song wasn't used after all (it wouldn't play): give its slot back */
  release(t) {
    const g = t && this.groupOf.get(t.id); if (g == null) return;
    this.groupOf.delete(t.id); this.picked[g] = Math.max(0, (this.picked[g] || 0) - 1);
  },
  take(t) {
    if (this.chosenGroup != null) { this.picked[this.chosenGroup] = (this.picked[this.chosenGroup] || 0) + 1; this.groupOf.set(t.id, this.chosenGroup); this.chosenGroup = null; }
    this.used.add(this.key(t)); this.lastArtists = [normArtist(t.artists[0]?.name), ...this.lastArtists].slice(0, 2); return t; },
  /* one random song. With weights (multiplayer shares) each group gets its share of the picks;
     in "even" mode every source (liked songs, a chart…) gets an equal chance; in "size" mode every song does */
  pickFrom(ok) {
    const W = this.opts.weights, size = S.mixMode === 'size';
    this.chosenGroup = null;
    if (this.groups.length < 2 || (!W && size && !this.exact)) { const c = this.pool.filter(ok); return c.length ? pick(c) : null; }
    const weight = g => W ? Math.max(0, W[g.key] || 0) : size ? g.tracks.length : 1;
    const cands = this.groups.map(g => ({ key: g.key, w: weight(g), c: g.tracks.filter(ok) })).filter(x => x.c.length);
    if (!cands.length) return null;
    if (this.exact) {
      // exact split: every group has a fixed number of slots for this game (e.g. 5/5/5/5 of 20), filled in random order;
      // a group whose songs have run out simply gets no more
      const open = this.quota ? cands.filter(x => (this.quota[x.key] || 0) - (this.picked[x.key] || 0) > 0) : [];
      if (open.length) {
        let r = Math.random() * open.reduce((a, x) => a + this.quota[x.key] - (this.picked[x.key] || 0), 0);
        for (const x of open) { r -= this.quota[x.key] - (this.picked[x.key] || 0); if (r <= 0) { this.chosenGroup = x.key; return pick(x.c); } }
        const x = open[open.length - 1]; this.chosenGroup = x.key; return pick(x.c);
      }
      // no fixed number of songs (Survival, Endless…) or every slot used: stay as close to the shares as possible
      const total = this.groups.reduce((a, g) => a + weight(g), 0) || 1, n = Object.values(this.picked).reduce((a, b) => a + b, 0) + 1;
      const behind = x => x.w / total * n - (this.picked[x.key] || 0);
      const best = shuffle(cands.filter(x => x.w > 0)).sort((a, b) => behind(b) - behind(a))[0] || pick(cands);
      this.chosenGroup = best.key; return pick(best.c);
    }
    const total = cands.reduce((a, x) => a + x.w, 0);
    if (total <= 0) return pick(pick(cands).c);   // only zero-share groups have songs left
    let r = Math.random() * total;
    for (const x of cands) { r -= x.w; if (r <= 0 && x.w > 0) { this.chosenGroup = x.key; return pick(x.c); } }
    const last = cands.filter(x => x.w > 0).pop(); this.chosenGroup = last.key; return pick(last.c);
  },
  /* Never repeats a song within a game until every song has been used. Prefers songs that weren't in your
     last few games (setting) and a different artist than the last two questions, relaxing those rules as needed. */
  pickTrack(pred = () => true) {
    const games = S.avoidRecent ? S.recentGames : 0;
    const fresh = t => !games || !Recent.has(this.key(t), games);
    const newArtist = t => !this.lastArtists.includes(normArtist(t.artists[0]?.name));
    const tiers = [t => fresh(t) && newArtist(t), fresh, newArtist, () => true];
    for (const rule of tiers) { const t = this.pickFrom(x => this.avail(x) && rule(x) && pred(x)); if (t) return this.take(t); }
    const rest = this.pool.filter(t => !this.bad.has(t.id) && pred(t)); if (!rest.length) return null;
    this.used.clear();   // every song has been played this game: start the cycle again
    return this.take(pick(rest));
  },
  /* a song for a question. Sometimes (mode setting "similar songs") it's swapped for a relative of the picked
     song that isn't in your songs: from the same album, by the same artist, or by a similar artist */
  async pickSong(pred = () => true) {
    const t = this.pickTrack(pred); if (!t) return null;
    if (!(S.similar > 0) || Math.random() >= S.similar) return t;
    const x = await this.relative(t, pred).catch(e => { console.warn('similar', e); return null; });
    if (!x) return t;
    // only the song actually asked about counts: the original stays available, and "last artists" is the relative's
    this.used.delete(this.key(t));
    this.lastArtists[0] = normArtist(x.artists[0]?.name);
    if (this.groupOf.has(t.id)) { this.groupOf.set(x.id, this.groupOf.get(t.id)); this.groupOf.delete(t.id); }   // the relative takes the original's slot
    return x;
  },
  async relative(t, pred) {
    const mix = S.similarMix || {}, left = ['album', 'artist', 'related'].filter(k => (mix[k] || 0) > 0).map(k => [k, mix[k]]), order = [];
    while (left.length) {   // weighted order: the preferred kind first, the others as fallbacks
      let r = Math.random() * left.reduce((a, x) => a + x[1], 0), i = 0;
      while (i < left.length - 1 && (r -= left[i][1]) > 0) i++;
      order.push(left.splice(i, 1)[0][0]);
    }
    const games = S.avoidRecent ? S.recentGames : 0;
    for (const kind of order) {
      const cands = await Promise.race([Similar.candidates(t, kind), sleep(5000).then(() => [])]);
      const ok = cands.filter(x => {
        const k = trackKey(x);
        return x.preview && k !== this.key(t) && !this.poolKeys.has(k) && !this.used.has(k) && !this.bad.has(x.id)
          && (!games || !Recent.has(k, games)) && pred(x) && Lib.filtered([x]).length;
      });
      if (!ok.length) continue;
      const x = pick(ok);
      x.similar = { kind, of: t.name, ofArtist: t.artists[0]?.name || '', orig: slimTrack(t) };
      x.src = ['similar']; if (t.owners) x.owners = t.owners;
      this.used.add(trackKey(x));
      return x;
    }
    return null;
  },
  /* remember what a shown question used, so the next games can avoid it */
  shown(q) { for (const t of [q.track, ...(q.pair || []), ...(q.items || [])]) Recent.add(t); Recent.save(); },
  markBad(t) { if (t) { this.bad.add(t.id); Player.markBroken(t); this.release(t); } },
  /* builds questions until one works; a song that can't be played is skipped for the rest of the game */
  async nextPrepared() {
    let offline = 0;
    for (let i = 0; i < 30; i++) {
      const type = pick(this.types); if (!type) return null;
      let q = null;
      try { q = await makeQ(type); } catch (e) { console.warn('question build failed', type, e); }
      if (!q) continue;
      if (q.audio && q.track) {
        let ok;
        try { ok = await Player.prepare(q.track, { needPreview: this.opts.needPreview }); }
        catch (e) { if (++offline >= 3) throw e; await sleep(800); continue; }
        if (!ok) { this.bad.add(q.track.id); this.release(q.track); continue; }
      }
      q.sc = scoringSnapshot();
      return q;
    }
    return null;
  }
};

async function makeQ(type) {
  const E = Engine, pool = E.pool, K = Math.max(1, S.numChoices - 1);
  const fmtPref = S.answerFormat === 'mixed' ? (Math.random() < 0.5 ? 'choice' : 'text') : S.answerFormat;
  const q = { type, id: uid(), audio: !!TYPES[type].audio, startFrac: S.clipStart === 'start' ? 0 : S.clipStart === 'middle' ? -1 : Math.random(), clipLength: S.clipLength };
  const withChoices = async (kind, answer, getter, t, accept) => {
    q.answer = answer; q.accept = accept || [answer]; q.kind = kind;
    if (fmtPref === 'choice') {
      const extra = await extraOptions(kind, t);
      const ds = distinct(pool, getter, q.accept, K, similarTo(t), extra);
      if (ds.length) {
        q.format = 'choice'; q.choices = shuffle([answer, ...ds]); q.answerIndex = q.choices.indexOf(answer);
        return;
      }
    }
    q.format = 'text';
  };
  let t;
  switch (type) {
    case 'title':
      t = await E.pickSong(); if (!t) return null;
      q.track = slimTrack(t); q.suggest = 'title'; await withChoices('title', t.name, x => x.name, t, titleAccept(t)); break;
    case 'artist':
      t = await E.pickSong(x => x.artists.length); if (!t) return null;
      q.track = slimTrack(t); q.suggest = 'artist'; await withChoices('artist', t.artists[0].name, x => x.artists[0]?.name, t, artistAccept(t)); break;
    case 'album':
      t = (await E.pickSong(x => x.album.name && normAns(x.album.name) !== normAns(x.name))) || (await E.pickSong(x => x.album.name)); if (!t) return null;
      q.track = slimTrack(t); q.suggest = 'album'; await withChoices('album', t.album.name, x => x.album.name, t); break;
    case 'year': {
      t = await E.pickSong(x => x.album.year); if (!t) return null;
      q.track = slimTrack(t); q.year = t.album.year; q.info = S.yearShowInfo;
      if (S.yearFormat === 'slider') {
        const ys = pool.map(x => x.album.year).filter(Boolean);
        q.format = 'slider'; q.min = Math.min(...ys, q.year) - 3; q.max = Math.min(CURRENT_YEAR, Math.max(...ys, q.year) + 3);
        if (q.max - q.min < 12) { q.min = Math.max(1900, q.year - 10); q.max = Math.min(CURRENT_YEAR, q.year + 10); }
        q.answer = String(q.year);
      } else if (S.yearFormat === 'decade') {
        const d = Math.floor(q.year / 10) * 10; const opts = new Set([d]);
        for (const c of shuffle([d - 10, d + 10, d - 20, d + 20, d - 30]).filter(x => x >= 1920 && x <= CURRENT_YEAR)) { if (opts.size > K) break; opts.add(c); }
        q.format = 'choice'; q.choices = [...opts].sort((a, b) => a - b).map(x => x + 's'); q.answer = d + 's'; q.answerIndex = q.choices.indexOf(q.answer);
      } else { q.format = 'choice'; q.choices = yearChoices(q.year, K); q.answer = String(q.year); q.answerIndex = q.choices.indexOf(q.answer); }
      break;
    }
    case 'cover':
      t = await E.pickSong(x => x.album.image); if (!t) return null;
      q.track = slimTrack(t); q.audio = !!S.coverAudio;
      q.coverStyle = S.coverStyle === 'random' ? pick(['pixelate', 'blur', 'tiles', 'zoom']) : S.coverStyle;
      q.zoomOrigin = `${15 + rand(70)}% ${15 + rand(70)}%`;
      if (S.coverAnswer === 'artist') { q.suggest = 'artist'; await withChoices('artist', t.artists[0].name, x => x.artists[0]?.name, t, artistAccept(t)); }
      else if (S.coverAnswer === 'title') { q.suggest = 'title'; await withChoices('title', t.name, x => x.name, t, titleAccept(t)); }
      else { q.suggest = 'album'; await withChoices('album', t.album.name, x => x.album.name, t); }
      break;
    case 'heardle':
      t = await E.pickSong(); if (!t) return null;
      q.track = slimTrack(t); q.suggest = 'title'; q.stages = heardleSteps(S.heardleStages);
      if (q.startFrac === -1) q.startFrac = 0.35;
      await withChoices('title', t.name, x => x.name, t, titleAccept(t)); break;
    case 'genre': {
      t = await E.pickSong(x => broadOf(x).size); if (!t) return null;
      q.track = slimTrack(t); const g = [...broadOf(t)]; const ans = pick(g);
      const present = new Set(pool.flatMap(x => [...broadOf(x)]));
      let others = shuffle(BROAD.map(b => b[0]).filter(n => !g.includes(n)));
      others = [...others.filter(n => present.has(n)), ...others.filter(n => !present.has(n))];
      q.format = 'choice'; q.choices = shuffle([ans, ...others.slice(0, K)]); q.answer = ans; q.answerIndex = q.choices.indexOf(ans); q.genres = genresOf(t).slice(0, 4);
      break;
    }
    case 'truefalse': {
      t = await E.pickSong(); if (!t) return null;
      q.track = slimTrack(t);
      const kinds = ['title', 'artist']; if (t.album.year) kinds.push('year');
      const kind = pick(kinds); let truth = Math.random() < 0.5, val;
      if (kind === 'title') { val = truth ? t.name : distinct(pool, x => x.name, [t.name], 1, similarTo(t), await extraOptions('title', t))[0]; if (!val) { val = t.name; truth = true; } q.statement = `This song is “${val}”`; }
      else if (kind === 'artist') { val = truth ? t.artists[0].name : distinct(pool, x => x.artists[0]?.name, t.artists.map(a => a.name), 1, similarTo(t), await extraOptions('artist', t))[0]; if (!val) { val = t.artists[0].name; truth = true; } q.statement = `This is by ${val}`; }
      else { val = truth ? t.album.year : Math.min(CURRENT_YEAR, t.album.year + pick([-6, -4, -3, -2, 2, 3, 4, 6])); if (val === t.album.year) truth = true; q.statement = `This came out in ${val}`; }
      q.tf = true; q.format = 'choice'; q.choices = ['True', 'False']; q.answerIndex = truth ? 0 : 1; q.answer = q.choices[q.answerIndex];
      break;
    }
    case 'first': {
      const a = E.pickTrack(x => x.album.year); if (!a) return null;
      let c = pool.filter(x => x.album.year && x.album.year !== a.album.year);
      if (S.difficulty !== 'easy' && S.difficulty !== 'normal') { const near = c.filter(x => Math.abs(x.album.year - a.album.year) <= 4); if (near.length) c = near; }
      const unused = c.filter(x => E.avail(x)); if (unused.length) c = unused;
      if (!c.length) return null;
      const b = pick(c); E.used.add(E.key(b));
      const pair = shuffle([a, b]).map(slimTrack);
      q.pair = pair; q.cards = pair.map(x => ({ title: x.name, sub: x.artists[0]?.name, img: x.album.thumb || x.album.image, id: x.id }));
      q.choices = pair.map(x => x.name); q.answerIndex = pair[0].album.year < pair[1].album.year ? 0 : 1; q.answer = q.choices[q.answerIndex];
      q.format = 'choice'; q.track = pair[q.answerIndex]; q.audio = false;
      break;
    }
    case 'oddone': {
      const groups = artistGroups(pool); if (!groups.length) return null;
      const fresh = groups.filter(g => g.tracks.filter(x => E.avail(x)).length >= 3);
      const g = pick(fresh.length ? fresh : groups);
      const unusedG = g.tracks.filter(x => E.avail(x));
      const three = shuffle(unusedG.length >= 3 ? unusedG : g.tracks).slice(0, 3);
      const gset = new Set(three.map(x => normAns(x.name)));
      let others = pool.filter(x => !x.artists.some(ar => normArtist(ar.name) === g.key) && !gset.has(normAns(x.name)));
      const nearFn = similarTo(three[0]); if (nearFn) { const near = others.filter(nearFn); if (near.length) others = near; }
      const unused = others.filter(x => E.avail(x)); if (unused.length) others = unused;
      if (!others.length) return null;
      const odd = pick(others);
      for (const x of [...three, odd]) E.used.add(E.key(x));
      const items = shuffle([...three, odd]).map(slimTrack);
      q.items = items; q.cards = items.map(x => ({ title: x.name, id: x.id }));
      q.choices = items.map(x => x.name); q.answerIndex = items.findIndex(x => x.id === odd.id); q.answer = odd.name;
      q.format = 'choice'; q.groupArtist = g.name; q.track = items[q.answerIndex]; q.audio = false;
      break;
    }
  }
  return q;
}
/* time per question; multiplayer Heardle gets enough for every step (clip + ~8 s to guess each) */
const limitFor = (q, mp) => q.type === 'heardle' ? (mp ? Math.min(180, Math.round(q.stages.reduce((a, s) => a + s + 8, 0)) + 5) : 0) : S.timeLimit;
