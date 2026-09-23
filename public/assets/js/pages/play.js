'use strict';
/* Play hub: choose which song sources are in the mix, then pick a game. */
const Home = {
  busy: false,
  setRow(m) {
    const k = esc(m.key), label = esc(m.label);
    return `<div class="set-row ${m.on ? '' : 'off'}">
      <label class="sw"><input type="checkbox" data-act="setOn" data-k="${k}" ${m.on ? 'checked' : ''} aria-label="Use ${label}"><span></span></label>
      <div class="set-m"><b>${label}</b><small class="mute">${fmtN(m.count)} songs · ${timeAgo(m.at)}</small></div>
      <div class="set-btns">
        <button class="btn sm ghost" data-act="setOnly" data-k="${k}" title="Use only this source">Only</button>
        <button class="btn sm ghost icon" data-act="setRefresh" data-k="${k}" title="Load again" aria-label="Reload ${label}">↻</button>
        <button class="btn sm ghost icon" data-act="setRemove" data-k="${k}" title="Remove" aria-label="Remove ${label}">✕</button>
      </div></div>`;
  },
  render() {
    Header.render('play'); Player.badge();
    const all = Lib.all(), pool = Lib.filtered(all), n = pool.length, sum = Lib.summary(all);
    const logged = !!Auth.tok, cov = Lib.genreCoverage(), best = Stats.d.best, st = Stats.summary(), o = Lib.opts;
    const on = Lib.enabled();
    const mix = `
      <div class="src-block"><h3>In the mix</h3>
        ${Lib.sets.length ? Lib.sets.map(m => this.setRow(m)).join('') : '<p class="note">Nothing loaded yet — add songs below.</p>'}
        ${Lib.sets.length && !on.length ? '<p class="note warn-t">Every source is switched off. Switch one on to play.</p>' : ''}
        <div id="prog" class="hidden"><div class="prog"><i></i></div><small class="mute" id="progTxt"></small></div>
      </div>`;
    const spotify = logged ? `
      <div class="src-block"><h3>Add from Spotify</h3>
        <div class="add-row"><button class="btn sm" data-act="loadLiked">${Lib.get('liked') ? 'Reload' : 'Add'} liked songs</button>
          <span class="row"><small class="mute">up to</small><select class="field" data-set="maxLiked" data-num="1" aria-label="How many liked songs">${[250, 500, 1000, 2000, 5000].map(v => `<option value="${v}" ${S.maxLiked === v ? 'selected' : ''}>${fmtN(v)}</option>`).join('')}</select></span></div>
        <div class="add-row"><button class="btn sm" data-act="loadTop">${Lib.get('top') ? 'Reload' : 'Add'} most played</button>
          <select class="field" data-set="topRange" aria-label="Time range">${TOP_RANGES.map(([v, l]) => `<option value="${v}" ${S.topRange === v ? 'selected' : ''}>${l[0].toUpperCase() + l.slice(1)}</option>`).join('')}</select></div>
        <div class="add-row"><button class="btn sm" data-act="pickPl">Add playlists…</button></div>
      </div>` : `
      <div class="src-block"><h3>Your Spotify songs</h3><p class="note">Log in to quiz yourself on your liked songs, most played and playlists.</p>${clientId() ? '<button class="btn primary" data-act="login">Log in with Spotify</button>' : ''}</div>`;
    const charts = `
      <div class="src-block"><h3>Add a chart</h3>
        <div class="row"><select class="field" id="chartCountry" aria-label="Country chart">${CHART_COUNTRIES.map(c => `<option ${o.chart === c ? 'selected' : ''}>${c}</option>`).join('')}</select>
          <select class="field" id="chartGenre" aria-label="Genre chart"><option value="0">Any genre</option>${DEEZER_GENRES.map(([id, nm]) => `<option value="${id}" ${+o.chartGenre === id ? 'selected' : ''}>${esc(nm)}</option>`).join('')}</select>
          <button class="btn sm" data-act="loadChart">Add chart</button></div>
        <p class="note" style="margin:8px 0 0">Top 100 from Deezer. Add as many charts as you like — each one shows up above.</p>
      </div>`;
    const blendBase = on.filter(m => m.kind !== 'blend');
    const blend = `
      <div class="src-block"><h3>Similar songs</h3>
        <p class="note">Songs you haven’t saved, found from the artists in ${blendBase.length ? blendBase.map(m => esc(m.label)).join(', ') : 'the sources you switch on'}.</p>
        <label class="chk"><input type="checkbox" data-act="blendOpt" data-k="blendArtist" ${o.blendArtist ? 'checked' : ''}> More songs by the same artists</label>
        <label class="chk"><input type="checkbox" data-act="blendOpt" data-k="blendSimilar" ${o.blendSimilar ? 'checked' : ''}> Songs by similar artists</label>
        <div class="row"><small class="mute">Top</small><select class="field" data-act-change="blendArtists" aria-label="Artists">${[10, 20, 30, 50, 80].map(v => `<option ${o.blendArtists === v ? 'selected' : ''}>${v}</option>`).join('')}</select><small class="mute">artists,</small>
          <select class="field" data-act-change="blendPer" aria-label="Songs per artist">${[3, 6, 10, 15].map(v => `<option ${o.blendPer === v ? 'selected' : ''}>${v}</option>`).join('')}</select><small class="mute">songs each</small></div>
        <button class="btn sm" data-act="buildBlend" style="margin-top:8px" ${blendBase.length ? '' : 'disabled'}>${Lib.get('blend') ? 'Find new similar songs' : 'Find similar songs'}</button>
      </div>`;
    const genres = logged && cov.total ? `
      <div class="src-block"><h3>Genres</h3>
        <p class="note">${fmtN(cov.done)} of ${fmtN(cov.total)} artists scanned. Needed for genre questions and filters on Spotify songs (charts from a genre already know theirs).</p>
        <button class="btn sm" data-act="scanGenres" ${cov.done >= cov.total ? 'disabled' : ''}>${cov.done >= cov.total ? 'All scanned' : 'Scan genres'}</button></div>` : '';
    const fName = (Me?.display_name || '').split(' ')[0];
    const where = on.length === 1 ? esc(on[0].label) : `${on.length} sources`;
    $('#main').innerHTML = `
      <div class="page-head"><div><h1>${fName ? 'Ready, ' + esc(fName) + '?' : 'Pick a game'}</h1>
        <p class="mute" style="margin:6px 0 0">${n ? `${fmtN(n)} songs from ${fmtN(sum.artists)} artists, from ${where}${sum.yMin ? `, ${sum.yMin}–${sum.yMax}` : ''}${n !== all.length ? ` (${fmtN(all.length)} before filters)` : ''}.` : all.length ? 'No songs match your filters — loosen them in Settings.' : Lib.sets.length ? 'Every source is switched off — switch one on to play.' : 'Add some songs to start.'}</p></div>
        <div class="row"><a class="btn" href="/settings">Settings</a><a class="btn" href="/multiplayer">Play with friends</a></div></div>
      <div class="home-grid">
        <div class="panel">${mix}${spotify}${charts}${blend}${genres}</div>
        <div>
          <div class="modes">
            ${Object.entries(PRESETS).filter(([k]) => k !== 'custom').map(([k, p]) => `<a class="mode ${n < 4 ? 'off' : ''}" href="${n < 4 ? '#' : `/game?mode=${k}`}" ${n < 4 ? 'data-act="needSongs"' : ''}><span class="ic">${p.icon}</span><b>${esc(p.name)}</b><span class="d">${esc(p.desc)}</span>${best[k] ? `<span class="best num">Best ${fmtN(best[k])}</span>` : ''}</a>`).join('')}
            <a class="mode feature" href="/game?mode=custom"><span class="ic">🎛️</span><span><b>Custom game</b><span class="d">Your own rules. ${esc(settingsSummary(modeSettings('custom')))}${best.custom ? ` Best ${fmtN(best.custom)}.` : ''}</span></span></a>
          </div>
          <div class="panel" style="margin-top:22px">
            <div class="row" style="justify-content:space-between;align-items:baseline"><h2 style="margin:0">Your stats</h2><a href="/stats">See all</a></div>
            <div class="stats-row" style="margin-top:12px"><div class="stat"><b class="num">${fmtN(st.games)}</b><span>games</span></div><div class="stat"><b class="num">${fmtN(st.bestScore)}</b><span>best score</span></div><div class="stat"><b class="num">${Math.round(st.accuracy * 100)}%</b><span>accuracy</span></div><div class="stat"><b class="num">${st.avgTime ? st.avgTime.toFixed(1) + 's' : '—'}</b><span>avg. right answer</span></div></div>
          </div>
        </div>
      </div>`;
    if (this.busy) this.lockButtons();
  },
  lockButtons() { $$('#main .panel [data-act]').forEach(b => { if (b.tagName === 'BUTTON') b.disabled = true; }); },
  prog(txt, frac) {
    $('#prog')?.classList.remove('hidden');
    const i = $('#prog i'); if (i) i.style.width = Math.round(clamp(frac ?? 0, 0, 1) * 100) + '%';
    const t = $('#progTxt'); if (t) t.textContent = txt;
  },
  async task(label, fn, okMsg) {
    if (this.busy) return toast('Still working on the last one…');
    this.busy = true; this.lockButtons(); this.prog(label, 0);
    try { const r = await fn((t, f) => this.prog(t, f)); if (okMsg) toast(typeof okMsg === 'function' ? okMsg(r) : okMsg); }
    catch (e) { toast(e.message); }
    this.busy = false; this.render();
  }
};
function timeAgo(t) { if (!t) return 'never'; const m = Math.round((Date.now() - t) / 60000); if (m < 1) return 'just now'; if (m < 60) return m + ' min ago'; const h = Math.round(m / 60); if (h < 24) return h + ' h ago'; return Math.round(h / 24) + ' days ago'; }

Object.assign(Act, {
  needSongs() { toast(Lib.all().length ? 'Fewer than 4 songs match your filters. Loosen them in Settings.' : 'Add at least 4 songs first — from Spotify, a chart, or both.'); },
  setOn(el) { Lib.toggle(el.dataset.k, el.checked); Home.render(); },
  setOnly(el) { Lib.only(el.dataset.k); Home.render(); toast(`Only “${Lib.get(el.dataset.k)?.label}” is in the mix now.`); },
  setRemove(el) { const m = Lib.get(el.dataset.k); if (!m || !confirm(`Remove “${m.label}”?`)) return; Lib.removeSet(m.key).then(() => Home.render()); },
  setRefresh(el) { const m = Lib.get(el.dataset.k); if (m) Home.task(`Reloading ${m.label}…`, p => Lib.refresh(m.key, p), () => `“${m.label}” is up to date.`); },
  loadLiked() { Home.task('Loading liked songs…', p => Lib.loadLiked(S.maxLiked, p), m => `Loaded ${fmtN(m.count)} liked songs.`); },
  loadTop() { Home.task('Loading most played…', p => Lib.loadTop(S.topRange, p), m => `Loaded ${fmtN(m.count)} most played songs.`); },
  loadChart() {
    const o = Lib.opts; o.chart = $('#chartCountry').value; o.chartGenre = +$('#chartGenre').value; Lib.saveOpts();
    Home.task('Loading chart…', () => Lib.loadChart({ country: o.chart, genre: o.chartGenre }), m => `Added ${m.label} (${m.count} songs).`);
  },
  blendOpt(el) { Lib.opts[el.dataset.k] = el.checked; Lib.saveOpts(); },
  buildBlend() {
    if (!Lib.opts.blendArtist && !Lib.opts.blendSimilar) return toast('Tick at least one kind of similar song.');
    Home.task('Finding similar songs…', p => Lib.buildBlend(p), n => `Found ${fmtN(n)} similar songs.`);
  },
  scanGenres() { Home.task('Scanning genres…', p => Lib.scanGenres((d, t) => p(`${d} of ${t} artists`, d / Math.max(1, t))), 'Genres scanned.'); },
  async pickPl() {
    if (Home.busy) return toast('Still working on the last one…');
    Modal.open('<h2>Add playlists</h2><div class="loading">Loading your playlists…</div>', 'narrow');
    try { await Lib.fetchPlaylists(); } catch (e) { Modal.close(); return toast('Couldn’t load playlists: ' + e.message); }
    Modal.open(`<button class="btn sm ghost x" data-act="closeModal">Close</button><h2>Add playlists</h2>
      <p class="mute"><small>Each playlist becomes its own source you can switch on and off. Spotify only lets apps read playlists you own or collaborate on, so the others are greyed out.</small></p>
      <div class="pl-list">${Lib.playlists.map(p => `<label class="pl-item ${p.own ? '' : 'off'}">${p.image ? `<img src="${esc(p.image)}" alt="">` : '<span class="ph"></span>'}<div><b>${esc(p.name)}</b><br><small class="mute">${fmtN(p.total)} songs${p.own ? '' : ' · by ' + esc(p.owner)}${Lib.get('pl:' + p.id) ? ' · already added' : ''}</small></div><input type="checkbox" class="plPick" value="${esc(p.id)}" ${p.own ? '' : 'disabled'}></label>`).join('') || '<p class="mute">No playlists found.</p>'}</div>
      <div class="sheet-foot"><button class="btn ghost" data-act="closeModal">Cancel</button><button class="btn primary" data-act="plLoad">Add selected</button></div>`, 'narrow');
  },
  plLoad() {
    const ids = $$('.plPick:checked').map(i => i.value), chosen = Lib.playlists.filter(p => ids.includes(p.id));
    Modal.close();
    if (!chosen.length) return;
    Home.task('Loading playlists…', async p => {
      let songs = 0;
      for (const pl of chosen) { try { songs += (await Lib.loadPlaylist(pl, p)).count; } catch (e) { toast(`Couldn’t read “${pl.name}”: ${e.message}`); } }
      return songs;
    }, n => `Added ${chosen.length} playlist${chosen.length > 1 ? 's' : ''} (${fmtN(n)} songs).`);
  }
});
document.addEventListener('change', e => { const k = e.target.dataset?.actChange; if (k) { Lib.opts[k] = +e.target.value; Lib.saveOpts(); } });

(async function () {
  await Lib.init();
  Home.render();
  if (Auth.tok && !Me) { await loadMe(); Home.render(); }
  // first visit without an account: start with the default chart so there is something to play
  if (!Lib.sets.length && !Auth.tok) Home.task('Loading chart…', () => Lib.loadChart({ country: Lib.opts.chart || CFG.DEFAULT_CHART }), m => `Loaded ${m.label}. Add more charts on the left.`);
})();
