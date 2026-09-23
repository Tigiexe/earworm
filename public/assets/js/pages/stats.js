'use strict';
/* Profile & stats page */

function renderStats() {
  Header.render(''); Player.badge();
  const s = Stats.summary(), pct = x => Math.round(x * 100) + '%';
  const tile = (v, l) => `<div class="tile"><b class="num">${v}</b><span>${l}</span></div>`;
  const av = Me?.images?.length ? `<img src="${esc(Me.images[0].url)}" alt="">` : `<span class="av">${esc(((Me?.display_name) || 'G')[0].toUpperCase())}</span>`;
  const hist = s.history;
  let chart = '<p class="mute">Play a few games to see your score over time.</p>';
  if (hist.length >= 2) {
    const W = 600, H = 180, pad = 24, max = Math.max(...hist.map(h => h.score), 1);
    const x = i => pad + (W - 2 * pad) * i / (hist.length - 1), y = v => H - pad - (H - 2 * pad) * v / max;
    const line = hist.map((h, i) => `${x(i)},${y(h.score)}`).join(' ');
    const accLine = hist.map((h, i) => `${x(i)},${H - pad - (H - 2 * pad) * h.acc}`).join(' ');
    chart = `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Score per game">
      <line x1="${pad}" y1="${H - pad}" x2="${W - pad}" y2="${H - pad}" stroke="var(--line)"/>
      <polyline points="${accLine}" fill="none" stroke="var(--mute)" stroke-width="1.5" stroke-dasharray="4 4"/>
      <polyline points="${line}" fill="none" stroke="var(--acc)" stroke-width="3" stroke-linejoin="round"/>
      ${hist.map((h, i) => `<circle cx="${x(i)}" cy="${y(h.score)}" r="3.5" fill="var(--acc)"><title>${esc(h.name)}: ${h.score} points, ${pct(h.acc)} correct</title></circle>`).join('')}
    </svg><small class="mute">Last ${hist.length} games. Solid line is score (best ${fmtN(max)}), dashed is accuracy.</small>`;
  }
  const bars = (rows) => rows.map(([label, frac, val]) => `<div class="bar-row"><span>${label}</span><span class="bar"><i style="width:${Math.round(clamp(frac, 0, 1) * 100)}%"></i></span><span class="v num">${val}</span></div>`).join('');
  const typeRows = Object.entries(s.byType).sort((a, b) => b[1].n - a[1].n).map(([k, v]) => [`${TYPES[k]?.icon || ''} ${esc(TYPES[k]?.name || k)}`, v.c / v.n, `${pct(v.c / v.n)} <small class="mute">of ${v.n}</small>`]);
  const modes = Object.entries(s.byMode).sort((a, b) => b[1].n - a[1].n);
  const artists = Object.entries(s.byArtist).filter(([, v]) => v.n >= 3);
  const bestA = [...artists].sort((a, b) => b[1].c / b[1].n - a[1].c / a[1].n || b[1].n - a[1].n).slice(0, 6);
  const worstA = [...artists].sort((a, b) => a[1].c / a[1].n - b[1].c / b[1].n || b[1].n - a[1].n).slice(0, 6);
  const songList = list => list.length ? list.map(([id, t]) => `<div class="miss">${t.img ? `<img src="${esc(t.img)}" alt="">` : ''}<div><b>${esc(t.name)}</b> <span class="mute">— ${esc(t.artist)}</span></div><small class="mute num">${t.c}/${t.n}</small></div>`).join('') : '<p class="mute"><small>Not enough data yet.</small></p>';
  const recent = Stats.d.games.slice(0, 12);
  $('#main').innerHTML = `
    <div class="profile">${av}<div><h1>${esc(Me?.display_name || 'Your stats')}</h1><p class="mute" style="margin:0">${fmtN(s.games)} games, ${fmtN(s.answers)} songs answered${s.playDays ? `, played on ${s.playDays} day${s.playDays > 1 ? 's' : ''}` : ''}. Stats are saved in this browser.</p></div></div>
    <div class="tiles">
      ${tile(fmtN(s.games), 'games played')}${tile(fmtN(s.points), 'total points')}${tile(fmtN(Math.round(s.avgScore)), 'average score')}${tile(fmtN(s.bestScore), 'best score')}
      ${tile(pct(s.accuracy), 'accuracy')}${tile(s.avgTime ? s.avgTime.toFixed(1) + 's' : '—', 'avg. right answer')}${tile(s.fastest != null ? s.fastest.toFixed(2) + 's' : '—', 'fastest right answer')}${tile(s.bestStreak, 'best streak')}
      ${tile(fmtN(s.uniqueSongs), 'different songs')}${tile(s.dayStreak, 'days in a row')}${tile(fmtN(s.hints), 'hints used')}${tile(fmtN(s.timeouts), 'ran out of time')}
      ${s.yearErr != null ? tile(s.yearErr.toFixed(1) + ' yrs', 'avg. year guess error') : ''}${s.yearExact ? tile(s.yearExact, 'exact years') : ''}${s.heardleAvg != null ? tile(s.heardleAvg.toFixed(1) + 's', 'avg. Heardle solve') : ''}${s.coverAvg != null ? tile((s.coverAvg + 1).toFixed(1) + '/9', 'avg. cover reveal needed') : ''}
      ${s.mpGames ? tile(`${s.mpWins}/${s.mpGames}`, 'multiplayer wins') : ''}
    </div>
    <div class="panel" style="margin-bottom:22px"><h2>Score over time</h2>${chart}</div>
    <div class="stats-grid">
      <div class="panel"><h2>By question type</h2>${typeRows.length ? bars(typeRows) : '<p class="mute">No answers yet.</p>'}</div>
      <div class="panel"><h2>By game mode</h2>${modes.length ? `<table class="list"><tr><th>Mode</th><th class="r">Games</th><th class="r">Average</th><th class="r">Best</th><th class="r">Accuracy</th></tr>${modes.map(([name, v]) => `<tr><td>${esc(name)}</td><td class="r num">${v.n}</td><td class="r num">${fmtN(Math.round(v.scores.reduce((a, b) => a + b, 0) / v.n))}</td><td class="r num">${fmtN(Math.max(...v.scores))}</td><td class="r num">${pct(v.acc.reduce((a, b) => a + b, 0) / v.n)}</td></tr>`).join('')}</table>` : '<p class="mute">No games yet.</p>'}</div>
      <div class="panel"><h2>Artists you know best</h2>${bestA.length ? bars(bestA.map(([a, v]) => [esc(a), v.c / v.n, `${v.c}/${v.n}`])) : '<p class="mute"><small>Answer at least 3 songs by an artist.</small></p>'}</div>
      <div class="panel"><h2>Artists that trip you up</h2>${worstA.length ? bars(worstA.map(([a, v]) => [esc(a), v.c / v.n, `${v.c}/${v.n}`])) : '<p class="mute"><small>Answer at least 3 songs by an artist.</small></p>'}</div>
      <div class="panel"><h2>Songs you keep missing</h2>${songList(Stats.misses())}</div>
      <div class="panel"><h2>Songs you always get</h2>${songList(Stats.nails())}</div>
    </div>
    <div class="panel" style="margin-top:22px"><h2>Recent games</h2>${recent.length ? `<table class="list"><tr><th>When</th><th>Mode</th><th class="r">Score</th><th class="r">Correct</th><th class="r">Streak</th></tr>${recent.map(g => `<tr><td>${new Date(g.at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</td><td>${esc(g.name)}${g.mp ? ` <small class="mute">(multiplayer${g.place ? `, #${g.place}` : ''})</small>` : ''}</td><td class="r num">${fmtN(g.score)}</td><td class="r num">${g.c}/${g.n}</td><td class="r num">${g.streak}</td></tr>`).join('')}</table>` : '<p class="mute">No games yet. <a href="/play">Play one</a>.</p>'}</div>
    <div class="row" style="margin-top:18px"><button class="btn ghost" data-act="exportStats">Download my stats</button><button class="btn ghost" data-act="resetStats">Reset stats</button></div>`;
}
Object.assign(Act, {
  exportStats() { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(Stats.d, null, 1)], { type: 'application/json' })); a.download = 'earworm-stats.json'; a.click(); },
  resetStats() { if (confirm('Delete all your stats in this browser?')) { Stats.reset(); renderStats(); } }
});
renderStats();
