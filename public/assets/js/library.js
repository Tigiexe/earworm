'use strict';
/* ---------------- genres ---------------- */
const BROAD = [
  ['K-Pop & J-Pop', ['k-pop', 'j-pop', 'k-rap', 'j-rock', 'anime', 'c-pop', 'k-indie', 'j-rap']],
  ['Balkan', ['croatian', 'serbian', 'bosnian', 'slovenian', 'macedonian', 'montenegrin', 'balkan', 'turbo folk', 'klapa', 'tamburica', 'yugoslav', 'narodna', 'sevdah', 'ex-yu']],
  ['Latin', ['latin', 'reggaeton', 'salsa', 'bachata', 'cumbia', 'urbano', 'sertanejo', 'corrido', 'corridos', 'banda', 'flamenco', 'mpb', 'funk carioca', 'dembow', 'latin music']],
  ['Hip-Hop & Rap', ['hip hop', 'rap', 'trap', 'drill', 'grime', 'boom bap', 'hip-hop', 'rap/hip hop']],
  ['R&B & Soul', ['r&b', 'soul', 'funk', 'motown', 'new jack swing', 'quiet storm', 'neo soul']],
  ['Metal', ['metal', 'deathcore', 'metalcore', 'djent', 'hardcore', 'nu metal']],
  ['Electronic', ['edm', 'house', 'techno', 'electro', 'electropop', 'synthpop', 'dubstep', 'drum and bass', 'trance', 'electronic', 'electronica', 'garage', 'hardstyle', 'synthwave', 'ambient', 'downtempo', 'big room', 'future bass', 'breakbeat', 'jungle', 'idm', 'phonk', 'dance']],
  ['Rock', ['rock', 'grunge', 'punk', 'emo', 'shoegaze', 'post-punk', 'new wave', 'britpop']],
  ['Indie & Alternative', ['indie', 'alternative', 'bedroom pop', 'lo-fi', 'dream pop', 'art pop', 'indie pop']],
  ['Country & Folk', ['country', 'folk', 'americana', 'bluegrass', 'singer-songwriter']],
  ['Jazz & Blues', ['jazz', 'blues', 'swing', 'bossa nova', 'bebop']],
  ['Classical & Soundtrack', ['classical', 'orchestra', 'orchestral', 'soundtrack', 'score', 'opera', 'baroque', 'video game music', 'films/games']],
  ['Reggae & Afro', ['reggae', 'dancehall', 'ska', 'afrobeat', 'afrobeats', 'amapiano', 'afropop', 'afro']],
  ['Pop', ['pop', 'boy band', 'girl group', 'europop', 'schlager']]
];
const BROAD_RE = BROAD.map(([name, kws]) => [name, kws.map(k => new RegExp('(^|[^a-z])' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^a-z]|$)'))]);
const broadCache = new Map();
function broadOfGenre(g) {
  if (broadCache.has(g)) return broadCache.get(g);
  let r = null; const s = g.toLowerCase();
  for (const [name, res] of BROAD_RE) if (res.some(re => re.test(s))) { r = name; break; }
  broadCache.set(g, r); return r;
}
const trackBroad = new Map();
function broadOf(t) {
  if (t.broad) return new Set(t.broad);
  if (trackBroad.has(t.id)) return trackBroad.get(t.id);
  const set = new Set();
  for (const a of t.artists) for (const g of (Lib.genres[a.id] || [])) { const b = broadOfGenre(g); if (b) set.add(b); }
  if (!set.size) for (const id of Lib.dzGenres[normArtist(t.artists[0]?.name)] || []) { const b = DZ_GENRES[id]?.[1]; if (b) set.add(b); }
  trackBroad.set(t.id, set); return set;
}
/* the genre names shown after a genre question: Spotify's tags, or Deezer's genre */
function genresOf(t) {
  const sp = [...new Set(t.artists.flatMap(a => Lib.genres[a.id] || []))];
  return sp.length ? sp : (Lib.dzGenres[normArtist(t.artists[0]?.name)] || []).map(id => DZ_GENRES[id]?.[0]).filter(Boolean);
}
/* Deezer genre ids -> [name, broad group] (Deezer's own names come back in the server's language, so they're fixed here) */
const DZ_GENRES = { 132: ['Pop', 'Pop'], 116: ['Rap/Hip Hop', 'Hip-Hop & Rap'], 152: ['Rock', 'Rock'], 113: ['Dance', 'Electronic'], 165: ['R&B', 'R&B & Soul'],
  85: ['Alternative', 'Indie & Alternative'], 106: ['Electro', 'Electronic'], 466: ['Folk', 'Country & Folk'], 144: ['Reggae', 'Reggae & Afro'], 129: ['Jazz', 'Jazz & Blues'],
  98: ['Classical', 'Classical & Soundtrack'], 173: ['Films/Games', 'Classical & Soundtrack'], 464: ['Metal', 'Metal'], 169: ['Soul & Funk', 'R&B & Soul'],
  2: ['African music', 'Reggae & Afro'], 16: ['Asian music', 'K-Pop & J-Pop'], 153: ['Blues', 'Jazz & Blues'], 75: ['Brazilian music', 'Latin'], 197: ['Latin music', 'Latin'],
  84: ['Country', 'Country & Folk'], 95: ['Kids', null], 81: ['Indian music', null], 12: ['Arabic music', null] };

/* ---------------- track shapes ---------------- */
function norm(t, src) {
  if (!t || t.is_local || !t.id || (t.type && t.type !== 'track')) return null;
  const al = t.album || {}, imgs = al.images || [];
  const date = al.release_date || '', year = parseInt(date.slice(0, 4)) || null;
  return {
    id: t.id, uri: t.uri, name: t.name || '', artists: (t.artists || []).map(a => ({ id: a.id, name: a.name })),
    album: { id: al.id, name: al.name || '', image: imgs[0]?.url || '', thumb: (imgs[1] || imgs[0])?.url || '', date, year, type: al.album_type || '' },
    dur: t.duration_ms || 0, isrc: t.external_ids?.isrc || '', explicit: !!t.explicit, src: [src]
  };
}
function fromDeezer(d, src, extra = {}) {
  if (!d || !d.id || !d.title) return null;
  const al = d.album || {};
  const date = al.release_date || d.release_date || '';
  return {
    id: 'dz' + d.id, uri: null, name: d.title_short || d.title, artists: [{ id: 'dza' + (d.artist?.id || ''), name: d.artist?.name || '' }],
    album: { id: 'dzal' + (al.id || ''), name: al.title || '', image: al.cover_xl || al.cover_big || '', thumb: al.cover_medium || al.cover || '', date, year: parseInt(date.slice(0, 4)) || null, type: al.record_type || '' },
    dur: (d.duration || 30) * 1000, isrc: d.isrc || '', explicit: !!d.explicit_lyrics, preview: d.preview || '', link: d.link,
    dz: { id: d.id, artist: d.artist?.id, album: al.id }, src: [src], ...extra
  };
}
const trackKey = t => normAns(t.name) + '|' + normArtist(t.artists[0]?.name || '');
function dedupe(list) {
  const byKey = new Map();
  for (const t of list) {
    const k = trackKey(t), e = byKey.get(k);
    if (e) { for (const s of t.src || []) if (!e.src.includes(s)) e.src.push(s); if (t.owners) e.owners = [...new Set([...(e.owners || []), ...t.owners])]; if (!e.uri && t.uri) Object.assign(e, { uri: t.uri, id: t.id, isrc: t.isrc || e.isrc }); if (!e.album.year && t.album.year) e.album = { ...e.album, year: t.album.year, date: t.album.date }; }
    else byKey.set(k, { ...t, src: [...(t.src || [])], owners: t.owners ? [...t.owners] : undefined });
  }
  return [...byKey.values()];
}
function slimTrack(t) {
  if (!t) return t;
  return { id: t.id, uri: t.uri, name: t.name, artists: t.artists, album: t.album, dur: t.dur, isrc: t.isrc, explicit: t.explicit, preview: t.preview, link: t.link, owners: t.owners, broad: t.broad, dz: t.dz, src: t.src };
}

/* ---------------- Deezer (free, no login) — through our server ---------------- */
const Dz = {
  mem: new Map(),
  artistIds: store.get('dzArtistIds', {}),
  get(path, params) { return api('/api/dz/' + path, params); },
  async cached(key, fn) { if (this.mem.has(key)) return this.mem.get(key); const p = fn().catch(e => { this.mem.delete(key); throw e; }); this.mem.set(key, p); return p; },
  async artistId(t) {
    const a = t.artists[0]; if (!a) return null;
    if (t.dz?.artist && t.artists[0].id?.startsWith('dza')) return t.dz.artist;
    const k = normArtist(a.name); if (k in this.artistIds) return this.artistIds[k];
    const r = await this.cached('as:' + k, () => this.get('search/artist', { limit: 5, q: a.name }));
    const best = (r.data || []).find(x => normArtist(x.name) === k) || (r.data || []).find(x => nearEq(normArtist(x.name), k));
    this.artistIds[k] = best ? best.id : null;
    const keys = Object.keys(this.artistIds); if (keys.length > 4000) for (const x of keys.slice(0, 1000)) delete this.artistIds[x];
    store.set('dzArtistIds', this.artistIds);
    return this.artistIds[k];
  },
  async artistTop(id, n = 10) { if (!id) return []; const r = await this.cached(`top:${id}:${n}`, () => this.get(`artist/${id}/top`, { limit: n })); return (r.data || []).map(d => fromDeezer(d, 'blend')).filter(Boolean); },
  async related(id, n = 8) { if (!id) return []; const r = await this.cached(`rel:${id}`, () => this.get(`artist/${id}/related`, { limit: n })); return r.data || []; },
  async albums(id) { if (!id) return []; const r = await this.cached(`alb:${id}`, () => this.get(`artist/${id}/albums`, { limit: 60 })); return r.data || []; },
  async albumTracks(albumId) { if (!albumId) return []; const r = await this.cached(`at:${albumId}`, () => this.get(`album/${albumId}/tracks`, { limit: 100 })); return r.data || []; },
  async search(q, type = 'track', n = 8) { const r = await this.cached(`s:${type}:${q}:${n}`, () => this.get(type === 'all' ? 'search' : 'search/' + type, { limit: n, q })); return r.data || []; },
  async chart(opts) { return (await api('/api/chart', opts)).data || []; }
};
const CHART_COUNTRIES = ['Worldwide', 'USA', 'UK', 'Canada', 'Australia', 'Germany', 'France', 'Italy', 'Spain', 'Netherlands', 'Belgium', 'Austria', 'Switzerland', 'Sweden', 'Norway', 'Denmark', 'Finland', 'Poland', 'Croatia', 'Serbia', 'Slovenia', 'Ireland', 'Portugal', 'Brazil', 'Mexico', 'Colombia', 'Argentina', 'Turkey', 'South Africa'];
const DEEZER_GENRES = [[132, 'Pop', 'Pop'], [116, 'Rap & Hip-Hop', 'Hip-Hop & Rap'], [152, 'Rock', 'Rock'], [113, 'Dance', 'Electronic'], [106, 'Electro', 'Electronic'], [165, 'R&B', 'R&B & Soul'], [85, 'Alternative', 'Indie & Alternative'], [464, 'Metal', 'Metal'], [197, 'Latin', 'Latin'], [84, 'Country', 'Country & Folk'], [144, 'Reggae', 'Reggae & Afro'], [129, 'Jazz', 'Jazz & Blues'], [98, 'Classical', 'Classical & Soundtrack'], [173, 'Film & games', 'Classical & Soundtrack']];
const TOP_RANGES = [['short_term', 'last 4 weeks'], ['medium_term', 'last 6 months'], ['long_term', 'past year']];

/* ---------------- catalog lookups for harder wrong options ---------------- */
const Catalog = {
  mem: new Map(),
  async once(key, fn) { if (!this.mem.has(key)) this.mem.set(key, fn().catch(e => { console.warn('catalog', key, e); return []; })); return this.mem.get(key); },
  /* song titles from the same album */
  albumTitles(t) {
    return this.once('alb:' + t.album.id, async () => {
      if (t.album.id && !t.album.id.startsWith('dzal') && Auth.tok) {
        const j = await sp(`/albums/${t.album.id}/tracks?limit=50`); return (j.items || []).map(x => x.name);
      }
      let albumId = t.dz?.album;
      if (!albumId) {
        const r = await Dz.search(`artist:"${t.artists[0]?.name}" album:"${cleanTitle(t.album.name)}"`, 'album', 5);
        albumId = (r.find(a => sim(a.title, t.album.name) > 0.8) || r[0])?.id;
      }
      return (await Dz.albumTracks(albumId)).map(x => x.title_short || x.title);
    });
  },
  /* more songs by the same artist */
  artistTitles(t) { return this.once('art:' + normArtist(t.artists[0]?.name), async () => (await Dz.artistTop(await Dz.artistId(t), 25)).map(x => x.name)); },
  /* artists that sound similar */
  similarArtists(t) { return this.once('rel:' + normArtist(t.artists[0]?.name), async () => (await Dz.related(await Dz.artistId(t), 12)).map(a => a.name)); },
  /* other albums by the same artist */
  artistAlbums(t) {
    return this.once('aa:' + normArtist(t.artists[0]?.name), async () => {
      if (t.artists[0]?.id && !t.artists[0].id.startsWith('dza') && Auth.tok) {
        try { const j = await sp(`/artists/${t.artists[0].id}/albums?include_groups=album,single&limit=50`); return (j.items || []).map(a => a.name); } catch {}
      }
      return (await Dz.albums(await Dz.artistId(t))).map(a => a.title);
    });
  }
};

/* ---------------- liking songs on Spotify ---------------- */
const Liked = {
  saved: new Set(store.get('likedNow', [])),
  can() { return !!Auth.tok; },
  isLiked(t) { return !!t && (this.saved.has(t.id) || (t.src || []).includes('liked')); },
  async spotifyUri(t) {
    if (t.uri) return t.uri;
    let q = t.isrc ? `isrc:${t.isrc}` : `track:"${cleanTitle(t.name)}" artist:"${t.artists[0]?.name || ''}"`;
    let j = await sp('/search?type=track&limit=5&q=' + encodeURIComponent(q));
    let items = j?.tracks?.items || [];
    if (!items.length && t.isrc) { j = await sp('/search?type=track&limit=5&q=' + encodeURIComponent(`${cleanTitle(t.name)} ${t.artists[0]?.name || ''}`)); items = j?.tracks?.items || []; }
    const best = items.find(x => sim(x.name, t.name) > 0.75 && x.artists.some(a => nearEq(normArtist(a.name), normArtist(t.artists[0]?.name)))) || (t.isrc ? items[0] : null);
    return best?.uri || null;
  },
  async save(t) {
    if (!Auth.tok) throw new Error('Log in with Spotify to like songs.');
    if (!Auth.hasScope('user-library-modify')) throw new Error('Log out and back in once to let Earworm save songs to your library.');
    const uri = await this.spotifyUri(t);
    if (!uri) throw new Error('Couldn’t find this song on Spotify.');
    try { await sp('/me/library?uris=' + encodeURIComponent(uri), { method: 'PUT' }); }
    catch (e) { if (e.status === 400) await sp('/me/library', { method: 'PUT', body: JSON.stringify({ uris: [uri] }) }); else throw e; }
    this.saved.add(t.id); store.set('likedNow', [...this.saved].slice(-500));
  }
};

/* ---------------- the library: independent song sources you switch on and off ----------------
   Each source ("set") is one list: liked songs, most played, one playlist, one chart, or similar songs.
   Its songs are kept in IndexedDB under "set:<key>", the list of sets (and which are on) in localStorage. */
const SPOTIFY_KINDS = ['liked', 'top', 'pl'];
const Lib = {
  sets: [],              // [{ key, kind, label, count, at, on, opts }]
  data: new Map(),       // key -> tracks
  playlists: store.get('playlists', []),
  genres: store.get('genres', {}),       // Spotify artist id -> Spotify genre tags
  dzGenres: store.get('dzGenres', {}),   // artist name key -> Deezer genre ids
  opts: Object.assign({ chart: CFG.DEFAULT_CHART, chartGenre: 0, blendArtist: true, blendSimilar: true, blendPer: 6, blendArtists: 30 }, store.get('libOpts', {})),
  _all: null,
  async init() {
    for (const k of ['lib', 'charts', 'blend', 'libSrc', 'dzChartIds']) store.del(k);   // caches from the old version
    const sets = store.get('sets', []);
    const lists = await Promise.all(sets.map(m => DB.get('set:' + m.key)));
    this.sets = []; this.data.clear();
    sets.forEach((m, i) => { if (Array.isArray(lists[i]) && lists[i].length) { this.sets.push(m); this.data.set(m.key, lists[i]); } });
    if (this.sets.length !== sets.length) this.saveMeta();
    this.changed();
    return this;
  },
  saveMeta() { store.set('sets', this.sets); },
  saveOpts() { store.set('libOpts', this.opts); },
  changed() { this._all = null; trackBroad.clear(); },
  get(key) { return this.sets.find(s => s.key === key); },
  enabled() { return this.sets.filter(s => s.on); },
  isSpotify(m) { return SPOTIFY_KINDS.includes(m.kind); },
  async putSet(key, kind, label, tracks, opts = {}) {
    tracks = dedupe(tracks.map(t => ({ ...t, src: [key] })));
    if (!tracks.length) throw new Error(`“${label}” has no songs Earworm can use.`);
    const prev = this.get(key);
    const m = { key, kind, label, count: tracks.length, at: Date.now(), on: prev ? prev.on : true, opts };
    const i = this.sets.findIndex(s => s.key === key); if (i >= 0) this.sets[i] = m; else this.sets.push(m);
    this.data.set(key, tracks); this.saveMeta(); this.changed();
    await DB.set('set:' + key, tracks);
    return m;
  },
  async removeSet(key) { this.sets = this.sets.filter(s => s.key !== key); this.data.delete(key); this.saveMeta(); this.changed(); await DB.del('set:' + key); },
  toggle(key, on) { const m = this.get(key); if (m) { m.on = !!on; this.saveMeta(); this.changed(); } },
  only(key) { for (const m of this.sets) m.on = m.key === key; this.saveMeta(); this.changed(); },
  /* everything the quiz can use right now */
  all() { if (!this._all) this._all = dedupe(this.enabled().flatMap(m => this.data.get(m.key) || [])); return this._all; },

  /* ---- Spotify ---- */
  async fetchLiked(max, prog) {
    let url = '/me/tracks?limit=50', out = [];
    while (url && out.length < max) {
      const j = await sp(url);
      for (const it of j.items || []) { const n = norm(it.track || it.item, 'liked'); if (n) { n.added = it.added_at; out.push(n); } }
      prog(`Liked songs: ${fmtN(out.length)} of ${fmtN(Math.min(j.total || 0, max))}`, out.length / Math.max(1, Math.min(j.total || 1, max)));
      url = j.next;
    }
    return out.slice(0, max);
  },
  async fetchTop(range, prog) {
    const out = [];
    for (const off of [0, 49]) {
      const j = await sp(`/me/top/tracks?time_range=${range}&limit=50&offset=${off}`);
      for (const t of j.items || []) { const n = norm(t, 'top'); if (n) out.push(n); }
      prog(`Most played: ${out.length}`, 1); if (!j.next) break;
    }
    return out;
  },
  async fetchPlaylists() {
    let url = '/me/playlists?limit=50', out = [];
    while (url && out.length < 400) {
      const j = await sp(url);
      for (const p of j.items || []) { if (!p) continue; out.push({ id: p.id, name: p.name, image: p.images?.[p.images.length - 1]?.url || p.images?.[0]?.url || '', total: p.items?.total ?? p.tracks?.total ?? 0, own: p.owner?.id === Me?.id || !!p.collaborative, owner: p.owner?.display_name || '' }); }
      url = j.next;
    }
    this.playlists = out; store.set('playlists', out); return out;
  },
  async fetchPlaylist(pl, prog) {
    let url = `/playlists/${pl.id}/items?limit=50`, out = [];
    while (url && out.length < 3000) {
      const j = await sp(url);
      for (const it of j.items || []) { const n = norm(it.item || it.track, 'pl:' + pl.id); if (n) out.push(n); }
      prog(`${pl.name}: ${out.length}`, out.length / Math.max(1, j.total || 1)); url = j.next;
    }
    return out;
  },
  async loadLiked(max, prog) { return this.putSet('liked', 'liked', 'Liked songs', await this.fetchLiked(max, prog), { max }); },
  async loadTop(range, prog) { return this.putSet('top', 'top', 'Most played, ' + (TOP_RANGES.find(r => r[0] === range)?.[1] || ''), await this.fetchTop(range, prog), { range }); },
  async loadPlaylist(pl, prog) { return this.putSet('pl:' + pl.id, 'pl', pl.name, await this.fetchPlaylist(pl, prog), { id: pl.id }); },

  /* ---- Deezer charts ---- */
  async loadChart({ country, genre }) {
    const g = DEEZER_GENRES.find(x => x[0] === +genre);
    const data = await Dz.chart(g ? { genre: g[0] } : { country });
    const key = g ? 'chart:g' + g[0] : 'chart:' + country;
    const tracks = data.map(d => fromDeezer(d, key, g ? { broad: [g[2]] } : {})).filter(Boolean);
    return this.putSet(key, 'chart', g ? `${g[1]} chart` : `Top ${country}`, tracks, g ? { genre: g[0] } : { country });
  },

  /* ---- similar songs, based on every other source that is switched on ---- */
  async buildBlend(prog) {
    const o = this.opts;
    const base = dedupe(this.enabled().filter(m => m.kind !== 'blend').flatMap(m => this.data.get(m.key) || []));
    if (!base.length) throw new Error('Switch on some songs first — similar songs are based on them.');
    const have = new Set(base.map(trackKey));
    const counts = new Map();
    for (const t of base) { const a = t.artists[0]; if (!a) continue; const k = normArtist(a.name); const e = counts.get(k) || { n: 0, t }; e.n++; counts.set(k, e); }
    const artists = [...counts.values()].sort((a, b) => b.n - a.n).slice(0, o.blendArtists).map(e => e.t);
    const out = [], seenArtist = new Set(artists.map(t => normArtist(t.artists[0].name)));
    const add = list => { for (const t of list) { const k = trackKey(t); if (!have.has(k)) { have.add(k); out.push(t); } } };
    let done = 0;
    await pool(artists, 3, async t => {
      try {
        const id = await Dz.artistId(t);
        if (id && o.blendArtist) add((await Dz.artistTop(id, o.blendPer + 4)).filter(x => x.preview).slice(0, o.blendPer));
        if (id && o.blendSimilar) {
          const rel = (await Dz.related(id, 6)).filter(a => !seenArtist.has(normArtist(a.name))).slice(0, 2);
          for (const a of rel) { seenArtist.add(normArtist(a.name)); add((await Dz.artistTop(a.id, 5)).filter(x => x.preview).slice(0, Math.max(2, Math.round(o.blendPer / 2)))); }
        }
      } catch (e) { console.warn('blend', e); }
      done++; prog(`${done} of ${artists.length} artists`, done / artists.length);
    });
    await this.putSet('blend', 'blend', 'Similar songs', out, { artist: o.blendArtist, similar: o.blendSimilar, per: o.blendPer, artists: o.blendArtists });
    return out.length;
  },

  /* reload a source with the options it was made with */
  async refresh(key, prog) {
    const m = this.get(key); if (!m) return;
    if (m.kind === 'liked') return this.loadLiked(m.opts.max || S.maxLiked, prog);
    if (m.kind === 'top') return this.loadTop(m.opts.range || S.topRange, prog);
    if (m.kind === 'pl') { const pl = this.playlists.find(p => p.id === m.opts.id) || { id: m.opts.id, name: m.label }; return this.loadPlaylist(pl, prog); }
    if (m.kind === 'chart') return this.loadChart(m.opts);
    if (m.kind === 'blend') return this.buildBlend(prog);
  },
  /* ---- genres: Spotify artist tags first, Deezer album genres for the rest. Both are kept in this browser
     (localStorage "genres" and "dzGenres"), so a scan only ever looks up artists it hasn't seen before. ---- */
  spotifyArtistIds() { return [...new Set(this.all().map(t => t.artists[0]?.id).filter(id => id && !id.startsWith('dz')))]; },
  /* one track per artist, for artists in the songs that are switched on */
  artistReps() { const m = new Map(); for (const t of this.all()) { const k = normArtist(t.artists[0]?.name); if (k && !m.has(k)) m.set(k, t); } return [...m.entries()]; },
  genreStatus() {
    const reps = this.artistReps();
    const known = reps.filter(([, t]) => broadOf(t).size).length;
    const spotifyTodo = Auth.tok ? this.spotifyArtistIds().filter(id => !(id in this.genres)).length : 0;
    const deezerTodo = reps.filter(([k, t]) => !broadOf(t).size && !(k in this.dzGenres)).length;
    return { total: reps.length, known, spotifyTodo, deezerTodo, todo: spotifyTodo + deezerTodo };
  },
  async scanGenres(prog) {
    // 1. Spotify, 50 artists per request (falls back to one at a time if the batch endpoint isn't available to this app)
    if (Auth.tok) {
      const ids = this.spotifyArtistIds().filter(id => !(id in this.genres));
      let done = 0, batch = true;
      try {
        for (let i = 0; i < ids.length; i += 50) {
          const chunk = ids.slice(i, i + 50);
          if (batch) {
            try { const j = await sp('/artists?ids=' + chunk.join(',')); for (const a of j?.artists || []) if (a?.id) this.genres[a.id] = a.genres || []; }
            catch (e) { if (/quota|rate limit/i.test(e.message)) throw e; batch = false; }
          }
          if (!batch) await pool(chunk, 3, async id => {
            try { const a = await sp('/artists/' + id); this.genres[id] = a?.genres || []; }
            catch (e) { if (/quota|rate limit/i.test(e.message)) throw e; this.genres[id] = []; }
          });
          for (const id of chunk) if (!(id in this.genres)) this.genres[id] = [];
          done += chunk.length; prog(`Spotify: ${fmtN(done)} of ${fmtN(ids.length)} artists`, done / ids.length * 0.5);
          store.set('genres', this.genres);
        }
      } finally { store.set('genres', this.genres); trackBroad.clear(); }
    }
    // 2. Deezer for every artist that still has no usable genre (also covers charts and people who aren't logged in)
    const todo = this.artistReps().filter(([k, t]) => !broadOf(t).size && !(k in this.dzGenres));
    let done = 0;
    await pool(todo, 3, async ([k, t]) => {
      try {
        const id = await Dz.artistId(t);
        const count = new Map();
        for (const al of id ? await Dz.albums(id) : []) if (al.genre_id > 0) count.set(al.genre_id, (count.get(al.genre_id) || 0) + (al.record_type === 'album' ? 2 : 1));
        this.dzGenres[k] = [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(e => e[0]);
      } catch (e) { if (e.status === 429 || e.status === 503) throw e; this.dzGenres[k] = []; }
      done++; prog(`Deezer: ${fmtN(done)} of ${fmtN(todo.length)} artists`, 0.5 + done / Math.max(1, todo.length) * 0.5);
      if (done % 25 === 0) store.set('dzGenres', this.dzGenres);
    }).finally(() => { store.set('dzGenres', this.dzGenres); trackBroad.clear(); });
  },
  forgetGenres() { this.genres = {}; this.dzGenres = {}; store.del('genres'); store.del('dzGenres'); trackBroad.clear(); },

  sourceLabel(k) { return this.get(k)?.label || (k.startsWith('mp:') ? 'A friend’s songs' : 'Songs'); },
  filtered(list = this.all()) {
    const f = S.filters;
    return list.filter(t => {
      if (f.noExplicit && t.explicit) return false;
      if (f.yearMin && (!t.album.year || t.album.year < f.yearMin)) return false;
      if (f.yearMax && (!t.album.year || t.album.year > f.yearMax)) return false;
      if (f.artist && !t.artists.some(a => a.name === f.artist)) return false;
      if (f.genres?.length) { const b = broadOf(t); if (!f.genres.some(g => b.has(g))) return false; }
      return true;
    });
  },
  summary(list = this.all()) { const ys = list.map(t => t.album.year).filter(Boolean); return { songs: list.length, artists: new Set(list.map(t => normArtist(t.artists[0]?.name))).size, yMin: ys.length ? Math.min(...ys) : null, yMax: ys.length ? Math.max(...ys) : null }; }
};
