'use strict';
/* Where artists are from, via MusicBrainz (the only free source that knows this).
   MusicBrainz allows about one request per second, so lookups go through a single queue and every answer
   is saved to disk (STATE_DIR/artist-countries.json): each artist is only ever looked up once, for everyone. */
const fs = require('node:fs');
const path = require('node:path');
const { normArtist, log } = require('./util');

function create(cfg) {
  const file = path.join(cfg.stateDir, 'artist-countries.json');
  let db = {};            // artist key -> { c: 'HR' | '' (not found), t: time }
  let dirty = false, writable = true;
  try { db = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') log('countries: could not read', file, e.message); }
  try { fs.mkdirSync(cfg.stateDir, { recursive: true }); } catch (e) { writable = false; log('countries: STATE_DIR is not writable, answers are kept in memory only:', e.message); }
  const save = () => {
    if (!dirty || !writable) return; dirty = false;
    try { fs.writeFileSync(file + '.tmp', JSON.stringify(db)); fs.renameSync(file + '.tmp', file); }
    catch (e) { writable = false; log('countries: could not save', e.message); }
  };
  setInterval(save, 30_000).unref();

  const MONTH = 30 * 24 * 3600e3;
  const fresh = e => e && (e.c ? true : Date.now() - e.t < MONTH);   // "not found" is retried after a month
  const queue = new Map();   // key -> name, in arrival order
  let running = false;

  async function lookup(name) {
    const url = `https://musicbrainz.org/ws/2/artist/?fmt=json&limit=8&query=${encodeURIComponent(`artist:"${name.replace(/"/g, '')}"`)}`;
    const res = await fetch(url, { headers: { 'User-Agent': `Earworm/2 (${cfg.publicUrl || 'self-hosted song quiz'})`, Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
    if (res.status === 503 || res.status === 429) throw Object.assign(new Error('slow down'), { retry: true });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const j = await res.json(), key = normArtist(name);
    const same = (j.artists || []).filter(a => normArtist(a.name) === key || (a.aliases || []).some(x => normArtist(x.name) === key));
    const best = same.sort((a, b) => (b.score || 0) - (a.score || 0))[0];
    if (!best || (best.score || 0) < 80) return '';
    return (best.country || best.area?.['iso-3166-1-codes']?.[0] || best['begin-area']?.['iso-3166-1-codes']?.[0] || '').toUpperCase().slice(0, 2);
  }
  async function run() {
    if (running) return; running = true;
    try {
      while (queue.size) {
        const [key, name] = queue.entries().next().value;
        try { db[key] = { c: await lookup(name), t: Date.now() }; dirty = true; queue.delete(key); }
        catch (e) { if (!e.retry) { queue.delete(key); } else await new Promise(r => setTimeout(r, 5000)); }
        await new Promise(r => setTimeout(r, 1100));
      }
    } finally { running = false; save(); }
  }

  /* known answers now; unknown names are queued. pending = how many of these are still waiting */
  function get(names) {
    const countries = {}; let pending = 0;
    for (const name of names) {
      const key = normArtist(name); if (!key) continue;
      const e = db[key];
      if (fresh(e)) countries[name] = e.c;
      else { pending++; if (!queue.has(key) && queue.size < 20_000) queue.set(key, name); }
    }
    if (queue.size) run();
    return { countries, pending, queue: queue.size };
  }
  return { get, save };
}

module.exports = { create };
