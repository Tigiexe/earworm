'use strict';
/* Results of the last single-player game */

Header.render('play'); Player.badge();
(function () {
  const g = session.get('lastGame', null);
  if (!g) { $('#main').innerHTML = '<div class="loading">No finished game to show. <a href="/play">Play one</a>.</div>'; return; }
  const n = g.hist.length, acc = n ? Math.round(g.correct / n * 100) : 0;
  const times = g.hist.filter(h => h.res.correct).map(h => h.res.elapsed);
  const avg = times.length ? (times.reduce((a, b) => a + b, 0) / times.length).toFixed(1) + 's' : '—';
  $('#main').innerHTML = `
    <div class="res-head"><p class="mute" style="margin:0 auto 6px">${esc(g.name)}</p><div class="res-score num">${fmtN(g.score)}</div><div class="mute">points</div>
      ${g.newBest ? '<div class="newbest">New personal best</div>' : ''}
      <div class="res-stats"><div class="stat"><b class="num">${g.correct}/${n}</b><span>correct</span></div><div class="stat"><b class="num">${acc}%</b><span>accuracy</span></div><div class="stat"><b class="num">${g.best}</b><span>best streak</span></div><div class="stat"><b class="num">${avg}</b><span>avg. right answer</span></div></div>
      <div class="row" style="justify-content:center"><a class="btn primary big" href="/game?mode=${esc(g.key)}">Play again</a><button class="btn" data-act="share">Copy result</button><a class="btn ghost" href="/play">Back to Play</a><a class="btn ghost" href="/stats">All stats</a></div></div>
    <div class="res-list">${g.hist.map(h => {
      const t = h.q.track, cls = h.res.correct ? 'ok' : h.res.factor > 0 ? 'part' : 'no';
      const said = h.res.given && h.res.given !== '—' && h.res.given !== h.q.answer ? ' · you said “' + esc(h.res.given) + '”' : '';
      return `<div class="res-item">${t?.album?.thumb ? `<img src="${esc(t.album.thumb)}" alt="">` : ''}<div class="m"><div><b>${esc(t?.name || '')}</b> — ${esc(t?.artists?.[0]?.name || '')}</div><div class="mute"><small>${TYPES[h.q.type].icon} ${esc(TYPES[h.q.type].name)}${said}</small></div></div>
        <div class="rv-btns">${playBtn(t)}${likeBtn(t)}</div><div class="p num ${cls}">${h.pts > 0 ? '+' : ''}${h.pts}</div></div>`;
    }).join('')}</div>`;
  Act.share = () => {
    const grid = g.hist.map(h => h.res.correct ? '🟩' : h.res.factor > 0 ? '🟨' : '🟥').join('');
    const txt = `Earworm — ${g.name}\n${fmtN(g.score)} points, ${g.correct}/${n} correct, best streak ${g.best}\n${grid}`;
    navigator.clipboard?.writeText(txt).then(() => toast('Result copied — paste it anywhere.'), () => toast(txt, 8000));
  };
})();
