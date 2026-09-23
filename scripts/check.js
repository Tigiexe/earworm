'use strict';
/* Quick logic checks for the song picker: loads the browser scripts with tiny stubs. Run: npm run check */
const vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
const mem = {};
const el = () => ({ style: { setProperty() {} }, classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {}, setAttribute() {}, appendChild() {} });
const ctx = {
  console, setTimeout, clearTimeout, setInterval, clearInterval, performance, crypto: globalThis.crypto, TextEncoder, URLSearchParams, URL, AbortSignal,
  localStorage: { getItem: k => mem[k] ?? null, setItem: (k, v) => { mem[k] = String(v); }, removeItem: k => { delete mem[k]; } },
  sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  location: { origin: 'http://x', pathname: '/play', search: '', href: '' },
  document: { documentElement: el(), addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], createElement: el, head: el(), body: el() },
  window: {}, Audio: function () { return { play: async () => {}, pause() {}, addEventListener() {}, removeEventListener() {} }; },
  indexedDB: undefined, fetch: async () => { throw new Error('offline'); }
};
ctx.window = ctx; vm.createContext(ctx);
const src = ['core', 'library', 'audio', 'engine'].map(n => fs.readFileSync(path.join(__dirname, '../public/assets/js', n + '.js'), 'utf8')).join('\n;\n');
vm.runInContext(src + `
;globalThis.T = { S: () => S, Engine, Recent, trackKey, Player };`, ctx);
const { Engine, Recent } = ctx.T, S = ctx.T.S();
const song = (i, src = 'a', artist = 'Artist ' + (i % 40)) => ({ id: 'id' + i, name: 'Song ' + i, artists: [{ id: 'ar' + artist, name: artist }], album: { name: 'Album ' + i, year: 1990 + (i % 30), image: 'https://x/' + i }, src: [src] });
let fails = 0; const ok = (c, msg) => { console.log((c ? 'ok   ' : 'FAIL ') + msg); if (!c) fails++; };
S.types = { title: true }; S.avoidRecent = true; S.recentGames = 3; S.mixMode = 'even';

// 1: no repeats inside a game
let pool = Array.from({ length: 60 }, (_, i) => song(i));
Engine.setup(pool); let keys = Array.from({ length: 30 }, () => Engine.pickTrack().id);
ok(new Set(keys).size === 30, 'no song repeats within a 30-song game (60 songs)');
// 2: next game avoids the last game's songs
pool.filter(t => keys.includes(t.id)).forEach(t => Recent.add(t)); Recent.save();
Engine.setup(pool); const g2 = Array.from({ length: 30 }, () => Engine.pickTrack().id);
ok(g2.every(id => !keys.includes(id)), 'next game avoids songs from the previous game when it can');
// 3: switched off
S.avoidRecent = false; Engine.setup(pool); const g3 = Array.from({ length: 60 }, () => Engine.pickTrack().id);
ok(new Set(g3).size === 60, 'with the setting off, still no repeats within a game');
// 4: tiny pool: repeats only after everything was used, never crashes
S.avoidRecent = true; const tiny = pool.slice(0, 5); Engine.setup(tiny);
const g4 = Array.from({ length: 12 }, () => Engine.pickTrack()?.id);
ok(g4.every(Boolean) && new Set(g4.slice(0, 5)).size === 5, 'tiny pool (5 songs, 12 rounds) cycles through all songs before repeating');
// 5: unplayable songs never come back
Engine.setup(tiny); Engine.bad.add('id0'); Engine.bad.add('id1');
ok(Array.from({ length: 20 }, () => Engine.pickTrack().id).every(id => id !== 'id0' && id !== 'id1'), 'songs marked unplayable are never picked again');
// 6: even mix between a small and a big source
const mixed = [...Array.from({ length: 10 }, (_, i) => song(1000 + i, 'small')), ...Array.from({ length: 1000 }, (_, i) => song(2000 + i, 'big'))];
let small = 0; for (let r = 0; r < 40; r++) { Engine.setup(mixed); for (let k = 0; k < 10; k++) if (Engine.pickTrack().src[0] === 'small') small++; }
ok(small > 120 && small < 280, `even mix: small source got ${small}/400 picks (expect ~200)`);
S.mixMode = 'size'; small = 0; for (let r = 0; r < 40; r++) { Engine.setup(mixed); for (let k = 0; k < 10; k++) if (Engine.pickTrack().src[0] === 'small') small++; }
ok(small < 25, `size mix: small source got ${small}/400 picks (expect ~4)`);
// 7: preview expiry parsing
const P = ctx.T.Player, soon = Math.floor(Date.now() / 1000) + 30, later = soon + 3600;
ok(!P.fresh('https://c/x.mp3?hdnea=exp=' + soon + '~acl') && P.fresh('https://c/x.mp3?hdnea=exp=' + later + '~acl') && P.fresh('https://itunes/x.m4a'), 'preview links are refreshed before they expire');
process.exit(fails ? 1 : 0);
