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
  return { id: t.id, uri: t.uri, name: t.name, artists: t.artists, album: t.album, dur: t.dur, isrc: t.isrc, explicit: t.explicit, preview: t.preview, link: t.link, owners: t.owners, broad: t.broad, dz: t.dz, src: t.src, similar: t.similar, alt: t.alt };
}
/* answers that count for a song's title / artist: the shown name plus the original-script name it replaced */
const titleAccept = t => [t.name, ...(t.alt?.names || [])];
const artistAccept = t => [...t.artists.map(a => a.name), ...(t.alt?.artists || [])];

/* ---------------- English / romanized names ----------------
   For songs written in Japanese, Korean or Chinese script. Spotify is asked for English names when songs load
   (it has official ones for many). Songs still in those scripts are looked up in the background: Deezer's version
   of the same recording (by ISRC; good for artist names), then Apple's US iTunes store (good for titles:
   夜に駆ける → Yoru ni kakeru, 紅蓮華 → Gurenge). Found names are kept next to the originals (t.rom), so the setting
   can be switched off instantly, and the original names always stay valid answers. */
const NON_LATIN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const isLatinName = s => !!s && !NON_LATIN.test(s) && /\p{Script=Latin}/u.test(s);
/* how a song shows up with the setting on */
function romanView(t) {
  const r = t.rom; if (!r || (!r.n && !r.a)) return t;
  const a0 = t.artists[0];
  return { ...t, name: r.n || t.name, artists: r.a && a0 ? [{ ...a0, name: r.a }, ...t.artists.slice(1)] : t.artists, alt: { names: r.n ? [t.name] : [], artists: r.a && a0 ? [a0.name] : [] } };
}
const Romanize = {
  cache: store.get('romanNames', {}),   // isrc (or name key) -> { n: title, a: artist } — empty strings when nothing was found
  queue: [], running: false, lastItunes: 0,
  needs: t => NON_LATIN.test(t.name) || NON_LATIN.test(t.artists[0]?.name || ''),
  schedule(setKey) { if (!S.romanized || this.queue.includes(setKey)) return; this.queue.push(setKey); this.run(); },
  async run() {
    if (this.running) return; this.running = true;
    let found = 0;
    try {
      while (this.queue.length && S.romanized) {
        const key = this.queue.shift(), tracks = Lib.data.get(key); if (!tracks) continue;
        let touched = false;
        for (const t of tracks.filter(x => this.needs(x) && !x.rom)) {
          const k = t.isrc || trackKey(t);
          if (!(k in this.cache)) { this.cache[k] = await this.find(t); store.set('romanNames', this.cache); }
          const r = this.cache[k];
          if (r && (r.n || r.a)) { t.rom = r; touched = true; found++; }
        }
        if (touched && Lib.data.get(key) === tracks) { await DB.set('set:' + key, tracks); Lib.changed(); }
      }
    } finally { this.running = false; }
    if (found && /^\/(play|settings)?$/.test(location.pathname)) toast(`Found English / romanized names for ${fmtN(found)} song${found > 1 ? 's' : ''}.`);
  },
  async find(t) {
    const out = { n: '', a: '' }, a0 = t.artists[0]?.name || '';
    const wantTitle = NON_LATIN.test(t.name), wantArtist = NON_LATIN.test(a0);
    if (t.isrc) {
      try {
        const d = await Dz.get('track/isrc:' + t.isrc);
        if (wantTitle && isLatinName(d?.title_short || d?.title)) out.n = d.title_short || d.title;
        if (wantArtist && isLatinName(d?.artist?.name)) out.a = d.artist.name;
      } catch {}
    }
    if (wantTitle && !out.n) {
      // iTunes allows about 20 searches a minute from each browser
      const wait = this.lastItunes + 3200 - Date.now(); if (wait > 0) await sleep(wait); this.lastItunes = Date.now();
      try {
        const p = new URLSearchParams({ media: 'music', entity: 'song', limit: '10', country: 'US', lang: 'en_us', term: `${out.a || a0} ${t.name}` });
        const j = await (await fetch('https://itunes.apple.com/search?' + p, { signal: AbortSignal.timeout(8000) })).json();
        const artistOk = r => [out.a, a0].filter(Boolean).some(x => { const A = normArtist(r.artistName), B = normArtist(x); return nearEq(A, B) || A.includes(B) || B.includes(A); });
        const extra = /cover|karaoke|instrumental|remix|first take|live|acoustic|english ver/i;
        const hit = (j.results || []).find(r => r.trackName && isLatinName(r.trackName) && artistOk(r) && !extra.test(r.trackName)
          && (!t.dur || !r.trackTimeMillis || Math.abs(r.trackTimeMillis - t.dur) < 6000));
        if (hit) out.n = cleanTitle(hit.trackName);
        if (hit && wantArtist && !out.a && isLatinName(hit.artistName)) out.a = hit.artistName;
      } catch {}
    }
    return out;
  }
};

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
  async artistTop(id, n = 10) { if (!id) return []; const r = await this.cached(`top:${id}:${n}`, () => this.get(`artist/${id}/top`, { limit: n })); return (r.data || []).map(d => fromDeezer(d, 'similar')).filter(Boolean); },
  async related(id, n = 8) { if (!id) return []; const r = await this.cached(`rel:${id}`, () => this.get(`artist/${id}/related`, { limit: n })); return r.data || []; },
  async albums(id) { if (!id) return []; const r = await this.cached(`alb:${id}`, () => this.get(`artist/${id}/albums`, { limit: 60 })); return r.data || []; },
  async albumTracks(albumId) { if (!albumId) return []; const r = await this.cached(`at:${albumId}`, () => this.get(`album/${albumId}/tracks`, { limit: 100 })); return r.data || []; },
  async search(q, type = 'track', n = 8) { const r = await this.cached(`s:${type}:${q}:${n}`, () => this.get(type === 'all' ? 'search' : 'search/' + type, { limit: n, q })); return r.data || []; },
  async chart(opts) { return (await api('/api/chart', opts, { timeout: 30000, retries: 1 })).data || []; }   // a first load also fetches album years, ~10 s
};
const CHART_COUNTRIES = ['Worldwide', 'USA', 'UK', 'Canada', 'Australia', 'Germany', 'France', 'Italy', 'Spain', 'Netherlands', 'Belgium', 'Austria', 'Switzerland', 'Sweden', 'Norway', 'Denmark', 'Finland', 'Poland', 'Croatia', 'Serbia', 'Slovenia', 'Ireland', 'Portugal', 'Brazil', 'Mexico', 'Colombia', 'Argentina', 'Turkey', 'South Africa'];
const DEEZER_GENRES = [[132, 'Pop', 'Pop'], [116, 'Rap & Hip-Hop', 'Hip-Hop & Rap'], [152, 'Rock', 'Rock'], [113, 'Dance', 'Electronic'], [106, 'Electro', 'Electronic'], [165, 'R&B', 'R&B & Soul'], [85, 'Alternative', 'Indie & Alternative'], [464, 'Metal', 'Metal'], [197, 'Latin', 'Latin'], [84, 'Country', 'Country & Folk'], [144, 'Reggae', 'Reggae & Afro'], [129, 'Jazz', 'Jazz & Blues'], [98, 'Classical', 'Classical & Soundtrack'], [173, 'Film & games', 'Classical & Soundtrack']];
const TOP_RANGES = [['short_term', 'last 4 weeks'], ['medium_term', 'last 6 months'], ['long_term', 'past year']];
/* genres a chart can be narrowed to (from each song's album genre on Deezer) */
const CHART_GENRES = ['Pop', 'Hip-Hop & Rap', 'Rock', 'Electronic', 'R&B & Soul', 'Indie & Alternative', 'Metal', 'Latin', 'Country & Folk', 'Reggae & Afro', 'Jazz & Blues', 'Classical & Soundtrack'];
const dzBroad = d => DZ_GENRES[d.album?.genre_id]?.[1];

/* ---------------- where artists are from (MusicBrainz, through our server) ---------------- */
const CHART_ISO = { USA: 'US', UK: 'GB', Canada: 'CA', Australia: 'AU', Germany: 'DE', France: 'FR', Italy: 'IT', Spain: 'ES', Netherlands: 'NL', Belgium: 'BE', Austria: 'AT',
  Switzerland: 'CH', Sweden: 'SE', Norway: 'NO', Denmark: 'DK', Finland: 'FI', Poland: 'PL', Croatia: 'HR', Serbia: 'RS', Slovenia: 'SI', Ireland: 'IE', Portugal: 'PT',
  Brazil: 'BR', Mexico: 'MX', Colombia: 'CO', Argentina: 'AR', Turkey: 'TR', 'South Africa': 'ZA' };
const EX_YU = ['HR', 'RS', 'SI', 'BA', 'ME', 'MK', 'XK'];
const flag = cc => /^[A-Z]{2}$/.test(cc || '') && cc !== 'XW' && cc !== 'XE' ? String.fromCodePoint(...[...cc].map(c => 0x1F1A5 + c.charCodeAt(0))) : '';
const countryOf = t => Artists.country[normArtist(t?.artists?.[0]?.name)];
/* does an artist's country count as "from" a chart's country? Old records often say Yugoslavia (YU). Unknown artists are kept. */
const fromCountry = (cc, want) => !cc || cc === want || (cc === 'YU' && EX_YU.includes(want));
const Artists = {
  country: store.get('artistCountry', {}),   // artist key -> 'HR', or '' when MusicBrainz doesn't know
  /* looks up the first artist of each song; the server asks MusicBrainz about one artist per second and remembers every answer */
  async lookup(tracks, prog = () => {}) {
    const names = new Map();
    for (const t of tracks) { const n = t.artists?.[0]?.name, k = normArtist(n); if (k && !(k in this.country) && !names.has(k)) names.set(k, n); }
    const total = names.size; if (!total) return;
    let todo = [...names.values()], still = Date.now();
    while (todo.length) {
      const next = [];
      for (let i = 0; i < todo.length; i += 100) {
        const batch = todo.slice(i, i + 100);
        const r = await api('/api/countries', { names: batch.join('|') });
        for (const n of batch) { if (n in r.countries) this.country[normArtist(n)] = r.countries[n]; else next.push(n); }
      }
      store.set('artistCountry', this.country);
      if (next.length < todo.length) still = Date.now();
      else if (Date.now() - still > 90_000) break;   // no progress for a while: keep what we have
      todo = next;
      prog(`Checking where artists are from: ${fmtN(total - todo.length)} of ${fmtN(total)} (about ${Math.ceil(todo.length * 1.1)}s left)`, (total - todo.length) / total);
      if (todo.length) await sleep(2500);
    }
  }
};

/* ---------------- similar songs: relatives of a song, found on Deezer when a question asks for one ----------------
   album: another song from the same album · artist: another song by the same artist · related: a song by a similar artist */
const Similar = {
  async albumId(t) {
    if (t.dz?.album) return t.dz.album;
    const a = t.artists[0]?.name || ''; if (!t.album.name) return null;
    const r = await Dz.search(`artist:"${a}" album:"${cleanTitle(t.album.name)}"`, 'album', 5);
    return r.find(x => sim(x.title, t.album.name) > 0.8 && nearEq(normArtist(x.artist?.name), normArtist(a)))?.id || null;
  },
  async candidates(t, kind) {
    if (kind === 'album') {
      const id = await this.albumId(t); if (!id) return [];
      return (await Dz.albumTracks(id)).map(d => {
        const x = fromDeezer(d, 'similar'); if (!x) return null;
        x.album = { ...t.album, id: 'dzal' + id }; x.dz.album = id;   // album track lists leave out the album itself
        return x;
      }).filter(Boolean);
    }
    const aid = await Dz.artistId(t); if (!aid) return [];
    if (kind === 'artist') return Dz.artistTop(aid, 25);
    const me = normArtist(t.artists[0]?.name);
    for (const a of shuffle((await Dz.related(aid, 12)).filter(a => normArtist(a.name) !== me)).slice(0, 3)) {
      const top = await Dz.artistTop(a.id, 10); if (top.length) return top;
    }
    return [];
  }
};

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
  opts: Object.assign({ chart: CFG.DEFAULT_CHART, chartGenre: 0 }, store.get('libOpts', {})),
  _all: null,
  async init() {
    for (const k of ['lib', 'charts', 'blend', 'libSrc', 'dzChartIds']) store.del(k);   // caches from the old version
    let sets = store.get('sets', []);
    for (const m of sets.filter(m => m.kind === 'blend')) DB.del('set:' + m.key);   // similar songs are a game setting now, not a source
    sets = sets.filter(m => m.kind !== 'blend');
    const lists = await Promise.all(sets.map(m => DB.get('set:' + m.key)));
    this.sets = []; this.data.clear();
    sets.forEach((m, i) => { if (Array.isArray(lists[i]) && lists[i].length) { this.sets.push(m); this.data.set(m.key, lists[i]); } });
    if (this.sets.length !== sets.length) this.saveMeta();
    this.changed();
    for (const m of this.sets) if ((this.data.get(m.key) || []).some(t => Romanize.needs(t) && !t.rom && !((t.isrc || trackKey(t)) in Romanize.cache))) Romanize.schedule(m.key);
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
    Romanize.schedule(key);   // English / romanized names, in the background
    return m;
  },
  async removeSet(key) { this.sets = this.sets.filter(s => s.key !== key); this.data.delete(key); this.saveMeta(); this.changed(); await DB.del('set:' + key); },
  toggle(key, on) { const m = this.get(key); if (m) { m.on = !!on; this.saveMeta(); this.changed(); } },
  only(key) { for (const m of this.sets) m.on = m.key === key; this.saveMeta(); this.changed(); },
  /* everything the quiz can use right now */
  all() {
    if (!this._all) { const list = dedupe(this.enabled().flatMap(m => this.data.get(m.key) || [])); this._all = S.romanized ? list.map(romanView) : list; }
    return this._all;
  },

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
      let j;
      try { j = await sp(url); }
      catch (e) {
        if (e.status === 403 || e.status === 404) throw new Error(`Spotify won’t let this app read “${pl.name}” — apps in development mode can usually only read playlists you own or collaborate on. If it’s also on Deezer, paste the Deezer link instead.`);
        throw e;
      }
      for (const it of j.items || []) { const n = norm(it.item || it.track, 'pl:' + pl.id); if (n) out.push(n); }
      prog(`${pl.name}: ${out.length}`, out.length / Math.max(1, j.total || 1)); url = j.next;
    }
    return out;
  },
  async loadLiked(max, prog) { return this.putSet('liked', 'liked', 'Liked songs', await this.fetchLiked(max, prog), { max }); },
  async loadTop(range, prog) { return this.putSet('top', 'top', 'Most played, ' + (TOP_RANGES.find(r => r[0] === range)?.[1] || ''), await this.fetchTop(range, prog), { range }); },
  async loadPlaylist(pl, prog) { return this.putSet('pl:' + pl.id, 'pl', pl.name, await this.fetchPlaylist(pl, prog), { id: pl.id }); },

  /* ---- Deezer charts ---- */
  /* a country's top 100 on Deezer, optionally narrowed to one genre and/or to artists from that country */
  async loadChart({ country, genre, local }, prog = () => {}) {
    if (typeof genre === 'number') { genre = DEEZER_GENRES.find(x => x[0] === genre)?.[2] || ''; country = country || 'Worldwide'; }   // charts saved by older versions
    country = country || 'Worldwide'; genre = CHART_GENRES.includes(genre) ? genre : '';
    const cc = local ? CHART_ISO[country] : null;
    const key = `chart:${country}${genre ? ':' + genre : ''}${cc ? ':local' : ''}`;
    const label = `Top ${country}${genre ? ' · ' + genre : ''}${cc ? ' · local artists' : ''}`;
    prog('Loading chart…', 0.1);
    const data = await Dz.chart({ country });   // the server adds each album's release date and genre
    let tracks = data.map(d => { const b = dzBroad(d); return fromDeezer(d, key, b ? { broad: [b] } : {}); }).filter(Boolean);
    if (genre) tracks = tracks.filter(t => t.broad?.includes(genre));
    if (cc) { await Artists.lookup(tracks, prog); tracks = tracks.filter(t => fromCountry(countryOf(t), cc)); }
    if (tracks.length < 4) throw new Error(`Only ${tracks.length} songs in ${label} right now — try without the genre or local filter.`);
    return this.putSet(key, 'chart', label, tracks, { country, genre, local: !!cc });
  },
  /* any public Deezer playlist */
  async loadDeezerPlaylist(id, prog = () => {}) {
    prog('Loading the Deezer playlist…', 0.2);
    const r = await api('/api/dzplaylist', { id }, { timeout: 60000, retries: 1 });
    const key = 'dzpl:' + id;
    const tracks = (r.data || []).map(d => { const b = dzBroad(d); return fromDeezer(d, key, b ? { broad: [b] } : {}); }).filter(Boolean);
    return this.putSet(key, 'dzpl', r.title || 'Deezer playlist', tracks, { id });
  },
  /* a playlist link: Spotify (needs login, and Spotify decides which it lets this app read) or Deezer (any public one) */
  async loadLink(link, prog) {
    const s = String(link || '').trim();
    const dz = s.match(/deezer\.com\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?playlist\/(\d{1,15})/i);
    if (dz) return this.loadDeezerPlaylist(dz[1], prog);
    const spm = s.match(/open\.spotify\.com\/(?:intl-[a-z-]+\/)?(?:user\/[^/]+\/)?playlist\/([A-Za-z0-9]{22})/) || s.match(/^spotify:playlist:([A-Za-z0-9]{22})$/);
    if (spm) {
      if (!Auth.tok) throw new Error('Log in with Spotify to add Spotify playlists — or use a Deezer playlist link, which works without logging in.');
      let pl;
      try { const j = await sp(`/playlists/${spm[1]}?fields=name,owner(display_name)`); pl = { id: spm[1], name: j?.name || 'Spotify playlist' }; }
      catch (e) { throw new Error(e.status === 404 ? 'Spotify can’t find that playlist (is it private?).' : 'Spotify won’t let Earworm open that playlist. ' + e.message); }
      return this.loadPlaylist(pl, prog);
    }
    if (/link\.deezer\.com|deezer\.page\.link|spotify\.link/i.test(s)) throw new Error('That’s a short share link. Open it in your browser first, then copy the full address from the address bar.');
    throw new Error('Paste a playlist link from Spotify (open.spotify.com/playlist/…) or Deezer (deezer.com/…/playlist/…).');
  },

  /* reload a source with the options it was made with */
  async refresh(key, prog) {
    const m = this.get(key); if (!m) return;
    if (m.kind === 'liked') return this.loadLiked(m.opts.max || S.maxLiked, prog);
    if (m.kind === 'top') return this.loadTop(m.opts.range || S.topRange, prog);
    if (m.kind === 'pl') { const pl = this.playlists.find(p => p.id === m.opts.id) || { id: m.opts.id, name: m.label }; return this.loadPlaylist(pl, prog); }
    if (m.kind === 'chart') return this.loadChart(m.opts, prog);
    if (m.kind === 'dzpl') return this.loadDeezerPlaylist(m.opts.id, prog);
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
