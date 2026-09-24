'use strict';
/* Deezer + iTunes access for the browser: a whitelisted, cached proxy, chart lookup,
   and preview resolution that checks the audio file really exists before handing it out. */
const { Cache, Window, cleanTitle, normArtist, sim, simArtist, httpError, log } = require('./util');

const DZ = 'https://api.deezer.com/';
const cache = new Cache(8000);
const inflight = new Map();
const dzLimit = new Window(40, 5000);        // Deezer allows 50 requests / 5 s per IP; keep headroom
const itLimit = new Window(18, 60_000, 60);  // iTunes Search allows ~20 / minute
const MIN = 60_000, HOUR = 60 * MIN;

/* Preview links carry an expiry (…exp=1727000000…). Never cache anything past the earliest one. */
function ttlFor(text, ttl) {
  let min = Infinity;
  for (const m of text.matchAll(/exp=(\d{9,11})/g)) min = Math.min(min, +m[1] * 1000);
  return Math.min(ttl, min - Date.now() - 2 * MIN);
}

async function getJSON(url, limiter, { ttl, key = url, tries = 2 } = {}) {
  const hit = cache.get(key); if (hit !== undefined) return hit;
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    for (let attempt = 0; attempt < tries; attempt++) {
      await limiter.take();
      let res, text;
      try {
        res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'Earworm/2 (song quiz)' }, signal: AbortSignal.timeout(9000) });
        text = await res.text();
      } catch (e) { if (attempt + 1 < tries) continue; throw httpError(502, 'Music service unreachable'); }
      if (res.status === 429 || res.status >= 500) { await new Promise(r => setTimeout(r, 1200)); continue; }
      let j; try { j = JSON.parse(text); } catch { throw httpError(502, 'Bad response from music service'); }
      if (j && j.error) {
        const code = j.error.code;
        if (code === 4 && attempt + 1 < tries) { await new Promise(r => setTimeout(r, 1500)); continue; } // quota
        if (code === 800) { cache.set(key, { data: [] }, 10 * MIN); return { data: [] }; }                   // no data
        throw httpError(code === 4 ? 503 : 502, j.error.message || 'Music service error');
      }
      cache.set(key, j, ttlFor(text, ttl));
      return j;
    }
    throw httpError(503, 'Music service is busy, try again');
  })().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/* ---------------- generic proxy ---------------- */
const PATHS = [
  [/^search(\/(track|artist|album|playlist))?$/, HOUR],
  [/^artist\/\d{1,12}(\/(top|related|albums))?$/, 6 * HOUR],
  [/^album\/\d{1,12}(\/tracks)?$/, 12 * HOUR],
  [/^playlist\/\d{1,15}\/tracks$/, 30 * MIN],
  [/^chart\/\d{1,6}\/tracks$/, 30 * MIN],
  [/^track\/(\d{1,15}|isrc:[A-Za-z0-9]{12})$/, 6 * HOUR]
];
async function proxy(p, query) {
  const rule = PATHS.find(([re]) => re.test(p));
  if (!rule) throw httpError(404, 'Unknown path');
  const q = new URLSearchParams();
  const text = query.get('q');
  if (text != null) { if (text.length > 200) throw httpError(400, 'Query too long'); q.set('q', text); }
  const limit = parseInt(query.get('limit'), 10); if (limit > 0) q.set('limit', String(Math.min(limit, 100)));
  const index = parseInt(query.get('index'), 10); if (index > 0) q.set('index', String(Math.min(index, 2000)));
  const qs = q.toString();
  return getJSON(DZ + p + (qs ? '?' + qs : ''), dzLimit, { ttl: rule[1] });
}

/* ---------------- charts ---------------- */
const COUNTRY_RE = /^[A-Za-z][A-Za-z .'-]{1,39}$/;
async function chart({ country, genre }) {
  let data;
  if (genre) {
    if (!/^\d{1,6}$/.test(genre)) throw httpError(400, 'Bad genre');
    data = (await getJSON(`${DZ}chart/${genre}/tracks?limit=100`, dzLimit, { ttl: 30 * MIN })).data;
  } else {
    if (!COUNTRY_RE.test(country || '')) throw httpError(400, 'Bad country');
    const title = ('top ' + country).toLowerCase();
    const found = await getJSON(`${DZ}search/playlist?limit=25&q=${encodeURIComponent('Top ' + country)}`, dzLimit, { ttl: 24 * HOUR });
    const exact = (found.data || []).filter(p => (p.title || '').toLowerCase() === title);
    const pl = exact.find(p => /deezer charts/i.test(p.user?.name || '')) || exact[0];
    if (!pl) throw httpError(404, `Deezer has no “Top ${country}” chart`);
    data = (await getJSON(`${DZ}playlist/${pl.id}/tracks?limit=100`, dzLimit, { ttl: 30 * MIN })).data;
  }
  data = (data || []).filter(d => d && d.id && d.preview);
  await addAlbumInfo(data);
  return { data };
}
/* Chart lists leave out each album's release date and genre, which year and genre questions need.
   Fill them in from the albums (cached for a week), giving up on whatever isn't back within a few seconds. */
async function addAlbumInfo(tracks) {
  const ids = [...new Set(tracks.map(t => t.album?.id).filter(Boolean))];
  const info = new Map();
  const work = (async () => {
    let i = 0;
    await Promise.all(Array.from({ length: 4 }, async () => {
      while (i < ids.length) {
        const id = ids[i++];
        try { const a = await getJSON(`${DZ}album/${id}`, dzLimit, { ttl: 7 * 24 * HOUR, tries: 1 }); info.set(id, a); } catch {}
      }
    }));
  })();
  await Promise.race([work, new Promise(r => setTimeout(r, 12_000))]);
  for (const t of tracks) {
    const a = info.get(t.album?.id); if (!a) continue;
    if (a.release_date && !t.album.release_date) t.album.release_date = a.release_date;
    if (a.genre_id > 0) t.album.genre_id = a.genre_id;
  }
}

/* ---------------- previews ---------------- */
const AUDIO_HOSTS = /(^|\.)(dzcdn\.net|deezer\.com|mzstatic\.com|apple\.com)$/i;
const verified = new Cache(20000);
async function audioOk(url) {
  let u; try { u = new URL(url); } catch { return false; }
  if (u.protocol !== 'https:' || !AUDIO_HOSTS.test(u.hostname)) return false;
  const hit = verified.get(url); if (hit !== undefined) return hit;
  let ok = false;
  try {
    const r = await fetch(url, { headers: { Range: 'bytes=0-1023' }, signal: AbortSignal.timeout(6000) });
    ok = (r.status === 200 || r.status === 206) && !/text\/html|json/i.test(r.headers.get('content-type') || '');
    r.body?.cancel().catch(() => {});
  } catch { ok = false; }
  verified.set(url, ok, ok ? 20 * MIN : 5 * MIN);
  return ok;
}

function bestMatch(list, title, artist, getT, getA) {
  let best = null, bs = 0;
  for (const x of list || []) { const s = sim(getT(x), title) * 0.6 + simArtist(getA(x), artist) * 0.4; if (s > bs) { bs = s; best = x; } }
  return bs >= 0.62 ? best : null;
}

const previews = new Cache(20000);
/* Returns {url, source} or null. Every candidate is checked before it is returned. */
async function preview({ dz, isrc, title, artist }) {
  const key = dz ? 'dz:' + dz : `q:${isrc || ''}|${normArtist(artist)}|${cleanTitle(title).toLowerCase()}`;
  const hit = previews.get(key); if (hit !== undefined) return hit;
  const tryUrl = async (url, source) => (url && await audioOk(url)) ? { url, source } : null;
  let r = null;
  const safe = p => p.catch(e => { if (e.status === 503) throw e; return null; });
  if (dz) {
    // cached track JSON may be older than its preview link, so fetch fresh when the cache can't be trusted
    const d = await safe(getJSON(`${DZ}track/${dz}`, dzLimit, { ttl: 10 * MIN }));
    r = await tryUrl(d?.preview, 'deezer');
    if (!r && d?.title) { title = title || d.title; artist = artist || d.artist?.name; isrc = isrc || d.isrc; }
  }
  if (!r && isrc) {
    const d = await safe(getJSON(`${DZ}track/isrc:${isrc}`, dzLimit, { ttl: 10 * MIN }));
    r = await tryUrl(d?.preview, 'deezer');
  }
  if (!r && title) {
    const q = `artist:"${artist || ''}" track:"${cleanTitle(title)}"`;
    const d = await safe(getJSON(`${DZ}search/track?limit=8&q=${encodeURIComponent(q)}`, dzLimit, { ttl: 10 * MIN }));
    const m = bestMatch(d?.data, title, artist, x => x.title, x => x.artist?.name);
    r = await tryUrl(m?.preview, 'deezer');
  }
  if (!r && title) {
    const term = encodeURIComponent(`${cleanTitle(title)} ${artist || ''}`.trim());
    const d = await safe(getJSON(`https://itunes.apple.com/search?media=music&entity=song&limit=8&term=${term}`, itLimit, { ttl: 6 * HOUR, tries: 1 }));
    const m = bestMatch(d?.results, title, artist, x => x.trackName, x => x.artistName);
    r = await tryUrl(m?.previewUrl, 'itunes');
  }
  previews.set(key, r, r ? ttlFor(r.url, 15 * MIN) : 30 * MIN);
  return r;
}

module.exports = { proxy, chart, preview, log };
