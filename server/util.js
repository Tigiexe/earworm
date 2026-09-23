'use strict';
/* Small helpers: TTL cache, rate limiters, text matching, logging. */

/* ---------------- LRU cache with per-entry expiry ---------------- */
class Cache {
  constructor(max = 5000) { this.max = max; this.m = new Map(); }
  get(k) {
    const e = this.m.get(k); if (!e) return undefined;
    if (e.exp < Date.now()) { this.m.delete(k); return undefined; }
    this.m.delete(k); this.m.set(k, e); return e.v;
  }
  set(k, v, ttlMs) {
    if (!(ttlMs > 0)) return;
    this.m.delete(k); this.m.set(k, { v, exp: Date.now() + ttlMs });
    while (this.m.size > this.max) this.m.delete(this.m.keys().next().value);
  }
}

/* ---------------- per-client token buckets ---------------- */
class Buckets {
  constructor(burst, perSec) { this.burst = burst; this.rate = perSec; this.m = new Map(); setInterval(() => this.sweep(), 60_000).unref(); }
  take(key, n = 1) {
    const now = Date.now(); let b = this.m.get(key);
    if (!b) { b = { t: this.burst, at: now }; this.m.set(key, b); }
    b.t = Math.min(this.burst, b.t + (now - b.at) / 1000 * this.rate); b.at = now;
    if (b.t < n) return false;
    b.t -= n; return true;
  }
  sweep() { const now = Date.now(); for (const [k, b] of this.m) if (now - b.at > 120_000) this.m.delete(k); }
}

/* ---------------- outbound limiter: at most `n` calls per `windowMs`, queued ---------------- */
class Window {
  constructor(n, windowMs, maxQueue = 400) { this.n = n; this.w = windowMs; this.maxQueue = maxQueue; this.stamps = []; this.q = []; this.timer = null; }
  take() {
    if (this.q.length >= this.maxQueue) return Promise.reject(Object.assign(new Error('busy'), { status: 503 }));
    return new Promise(res => { this.q.push(res); this.pump(); });
  }
  pump() {
    const now = Date.now();
    while (this.stamps.length && now - this.stamps[0] >= this.w) this.stamps.shift();
    while (this.q.length && this.stamps.length < this.n) { this.stamps.push(now); this.q.shift()(); }
    if (this.q.length && !this.timer) {
      this.timer = setTimeout(() => { this.timer = null; this.pump(); }, Math.max(20, this.w - (now - this.stamps[0])));
    }
  }
}

/* ---------------- text matching (same rules as the browser) ---------------- */
const stripAcc = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đð]/g, 'd').replace(/[ĐÐ]/g, 'D').replace(/ß/g, 'ss').replace(/ø/g, 'o').replace(/æ/g, 'ae');
function cleanTitle(s) { s = String(s || ''); const c = s.replace(/\s*[([][^)\]]*[)\]]/g, '').replace(/\s+-\s+.*$/, '').trim(); return c || s; }
const KEEP = /[^a-z0-9Ѐ-ӿ぀-ヿ一-鿿가-힯]+/g;
const normAns = s => stripAcc(cleanTitle(s)).toLowerCase().replace(/\s(feat|ft|featuring)\.?\s.*$/, '').replace(/&/g, ' and ').replace(KEEP, ' ').replace(/^the /, '').trim();
const normArtist = s => stripAcc(String(s || '')).toLowerCase().replace(/&/g, ' and ').replace(KEEP, ' ').replace(/^the /, '').trim();
function lev(a, b) {
  if (a === b) return 0; const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) { const cur = [i]; for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; }
  return prev[n];
}
function simWith(norm, a, b) { a = norm(a); b = norm(b); if (!a || !b) return 0; if (a === b) return 1; return 1 - lev(a, b) / Math.max(a.length, b.length); }
const sim = (a, b) => simWith(normAns, a, b);
const simArtist = (a, b) => simWith(normArtist, a, b);

/* ---------------- misc ---------------- */
const log = (...a) => console.log(new Date().toISOString(), ...a);
function httpError(status, msg) { return Object.assign(new Error(msg || 'error'), { status }); }

module.exports = { Cache, Buckets, Window, cleanTitle, normAns, normArtist, sim, simArtist, log, httpError };
