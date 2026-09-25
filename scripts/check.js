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
S.types = { title: true }; S.avoidRecent = true; S.similar = 0; S.recentGames = 3; S.mixMode = 'even';

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
// 7: multiplayer shares: 90 / 7 / 3
const three = ['Ana', 'Bob', 'Cid'].flatMap((o, j) => Array.from({ length: 300 }, (_, i) => ({ ...song(5000 + j * 1000 + i, 'mp'), owners: [o] })));
const got = { Ana: 0, Bob: 0, Cid: 0 };
for (let r = 0; r < 40; r++) { Engine.setup(three, { groupBy: t => t.owners, weights: { Ana: 90, Bob: 7, Cid: 3 } }); for (let k = 0; k < 25; k++) got[Engine.pickTrack().owners[0]]++; }
ok(got.Ana > 830 && got.Ana < 960 && got.Bob > 35 && got.Bob < 120 && got.Cid < 60, `shares 90/7/3 gave ${got.Ana}/${got.Bob}/${got.Cid} of 1000 picks`);
Engine.setup(three, { groupBy: t => t.owners, weights: { Ana: 100, Bob: 0, Cid: 0 } });
ok(Array.from({ length: 50 }, () => Engine.pickTrack().owners[0]).every(o => o === 'Ana'), 'a share of 0 leaves that player out');
// 8: exact split: 90/7/3 over 100 songs is exactly 90/7/3, and 50/50 alternates
const ex = { Ana: 0, Bob: 0, Cid: 0 };
Engine.setup(three, { groupBy: t => t.owners, weights: { Ana: 90, Bob: 7, Cid: 3 }, exact: true, total: 100 });
for (let k = 0; k < 100; k++) ex[Engine.pickTrack().owners[0]]++;
ok(ex.Ana === 90 && ex.Bob === 7 && ex.Cid === 3, `exact split 90/7/3 gave ${ex.Ana}/${ex.Bob}/${ex.Cid} of 100`);
Engine.setup(three.filter(t => t.owners[0] !== 'Cid'), { groupBy: t => t.owners, weights: { Ana: 50, Bob: 50 }, exact: true, total: 10 });
const seq = Array.from({ length: 10 }, () => Engine.pickTrack().owners[0]);
ok(seq.filter(o => o === 'Ana').length === 5, 'exact 50/50 over 10 songs is 5 and 5 (random order): ' + seq.map(o => o[0]).join(''));
// 9: exact split with a fixed number of songs: 25/25/25/25 over 20 is always 5/5/5/5, songs that fail give their slot back
const four = ['A', 'B', 'C', 'D'].flatMap((o, j) => Array.from({ length: 40 }, (_, i) => ({ ...song(9000 + j * 100 + i, 'mp'), owners: [o] })));
let allExact = true;
for (let r = 0; r < 30; r++) {
  Engine.setup(four, { groupBy: t => t.owners, weights: { A: 25, B: 25, C: 25, D: 25 }, exact: true, total: 20 });
  const n = { A: 0, B: 0, C: 0, D: 0 };
  for (let k = 0; k < 20; k++) { let t = Engine.pickTrack(); if (Math.random() < 0.2) { Engine.markBad(t); t = Engine.pickTrack(); } n[t.owners[0]]++; }
  if (Object.values(n).some(v => v !== 5)) { allExact = false; console.log('   got', JSON.stringify(n)); }
}
ok(allExact, 'exact 25/25/25/25 over 20 songs is 5/5/5/5 every time, even when songs fail to play');
const few = [...four.filter(t => t.owners[0] !== 'D'), ...four.filter(t => t.owners[0] === 'D').slice(0, 2)];
Engine.setup(few, { groupBy: t => t.owners, weights: { A: 25, B: 25, C: 25, D: 25 }, exact: true, total: 20 });
const m = { A: 0, B: 0, C: 0, D: 0 }; for (let k = 0; k < 20; k++) m[Engine.pickTrack().owners[0]]++;
ok(m.D === 2 && m.A + m.B + m.C === 18, `a player with only 2 songs gives 2, the rest fill up: ${JSON.stringify(m)}`);
// 10: preview expiry parsing
const P = ctx.T.Player, soon = Math.floor(Date.now() / 1000) + 30, later = soon + 3600;
ok(!P.fresh('https://c/x.mp3?hdnea=exp=' + soon + '~acl') && P.fresh('https://c/x.mp3?hdnea=exp=' + later + '~acl') && P.fresh('https://itunes/x.m4a'), 'preview links are refreshed before they expire');
process.exit(fails ? 1 : 0);
