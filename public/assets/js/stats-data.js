'use strict';
/* Every finished game is stored here (in this browser) so the stats page can crunch numbers. */
const Stats = {
  d: null,
  load() {
    let d = store.get('stats', null) || {};
    if (typeof d.games === 'number' || !Array.isArray(d.games)) d = { v: 2, legacyGames: typeof d.games === 'number' ? d.games : 0, games: [], best: d.best || {}, tracks: d.tracks || {} };
    d.best = d.best || {}; d.tracks = d.tracks || {};
    this.d = d; return this;
  },
  save() {
    const d = this.d;
    if (d.games.length > 200) d.games = d.games.slice(0, 200);
    const tr = Object.entries(d.tracks); if (tr.length > 4000) d.tracks = Object.fromEntries(tr.slice(-3500));
    if (!store.set('stats', d)) { d.games = d.games.slice(0, 80); store.set('stats', d); }
  },
  /* game: {key, name, score, bestStreak, mp, players} ; hist: [{q,res,pts}] */
  record(game, hist) {
    if (!hist.length) return false;
    const answers = hist.map(h => {
      const t = h.q.track || {};
      return { t: h.q.type, ok: h.res.correct ? 1 : 0, pf: +(h.res.factor || 0).toFixed(2), pts: h.pts, el: +(h.res.elapsed || 0).toFixed(2), to: h.res.timeout ? 1 : 0, hint: h.res.hint ? 1 : 0,
        id: t.id, ti: t.name, ar: t.artists?.[0]?.name, img: t.album?.thumb, d: h.res.extra?.diff, s: h.res.extra?.stage, hs: h.res.extra?.secs, rs: h.res.extra?.reveal };
    });
    const g = { at: Date.now(), key: game.key, name: game.name, score: game.score, n: hist.length, c: hist.filter(h => h.res.correct).length, streak: game.bestStreak || 0, mp: game.mp ? 1 : 0, place: game.place, players: game.players, answers };
    let newBest = false;
    if (!game.mp) { const prev = this.d.best[game.key]; if (prev == null || game.score > prev) { newBest = prev != null || game.score > 0; this.d.best[game.key] = game.score; } }
    this.d.games.unshift(g);
    for (const a of answers) { if (!a.id) continue; const s = this.d.tracks[a.id] || (this.d.tracks[a.id] = { n: 0, c: 0, name: a.ti, artist: a.ar, img: a.img }); s.n++; if (a.ok) s.c++; }
    this.save(); return newBest;
  },
  misses(n = 6) { return Object.entries(this.d.tracks).filter(([, s]) => s.n >= 2 && s.c / s.n < 0.5).sort((a, b) => (a[1].c / a[1].n) - (b[1].c / b[1].n) || b[1].n - a[1].n).slice(0, n); },
  nails(n = 6) { return Object.entries(this.d.tracks).filter(([, s]) => s.n >= 2 && s.c === s.n).sort((a, b) => b[1].n - a[1].n).slice(0, n); },
  summary() {
    const games = this.d.games, answers = games.flatMap(g => g.answers || []);
    const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
    const correct = answers.filter(a => a.ok);
    const byType = {}, byMode = {}, byArtist = {};
    for (const a of answers) {
      const b = byType[a.t] || (byType[a.t] = { n: 0, c: 0, el: [] }); b.n++; if (a.ok) { b.c++; b.el.push(a.el); }
      if (a.ar) { const r = byArtist[a.ar] || (byArtist[a.ar] = { n: 0, c: 0 }); r.n++; if (a.ok) r.c++; }
    }
    for (const g of games) { const m = byMode[g.name] || (byMode[g.name] = { n: 0, scores: [], acc: [] }); m.n++; m.scores.push(g.score); m.acc.push(g.n ? g.c / g.n : 0); }
    const days = new Set(games.map(g => new Date(g.at).toDateString()));
    let dayStreak = 0; for (let d = new Date(); days.has(d.toDateString()); d.setDate(d.getDate() - 1)) dayStreak++;
    const years = answers.filter(a => a.t === 'year' && a.d != null).map(a => a.d);
    const heardle = answers.filter(a => a.t === 'heardle' && a.ok && a.s != null).map(a => a.hs ?? HEARDLE_STAGES[a.s]);
    const covers = answers.filter(a => a.t === 'cover' && a.ok && a.rs != null).map(a => a.rs);
    return {
      games: games.length + (this.d.legacyGames || 0), recorded: games.length, answers: answers.length,
      points: games.reduce((s, g) => s + g.score, 0), avgScore: avg(games.map(g => g.score)), bestScore: Math.max(0, ...games.map(g => g.score), ...Object.values(this.d.best)),
      accuracy: answers.length ? correct.length / answers.length : 0, avgTime: avg(correct.map(a => a.el)), fastest: correct.length ? Math.min(...correct.map(a => a.el)) : null,
      bestStreak: Math.max(0, ...games.map(g => g.streak || 0)), hints: answers.filter(a => a.hint).length, timeouts: answers.filter(a => a.to).length,
      uniqueSongs: Object.keys(this.d.tracks).length, dayStreak, playDays: days.size,
      yearErr: years.length ? avg(years) : null, yearExact: years.filter(d => d === 0).length, heardleAvg: heardle.length ? avg(heardle) : null, coverAvg: covers.length ? avg(covers) : null,
      byType, byMode, byArtist, mpGames: games.filter(g => g.mp).length, mpWins: games.filter(g => g.mp && g.place === 1).length,
      history: games.slice(0, 40).reverse().map(g => ({ at: g.at, score: g.score, acc: g.n ? g.c / g.n : 0, name: g.name }))
    };
  },
  reset() { this.d = { v: 2, legacyGames: 0, games: [], best: {}, tracks: {} }; this.save(); }
};
Stats.load();
