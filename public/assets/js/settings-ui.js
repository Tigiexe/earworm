'use strict';
/* Settings panels. Two kinds:
   - global (Settings page): audio, pacing, which songs, look — applies to every game
   - one game mode's rules (the mode's start screen, or the multiplayer lobby) — only the options that matter for that mode */
const seg = (k, opts) => `<div class="seg" role="group">${opts.map(([v, l]) => `<button type="button" class="${String(getPath(k)) === String(v) ? 'on' : ''}" data-act="set" data-set="${k}" data-val="${v}">${esc(l)}</button>`).join('')}</div>`;
const rng = (k, min, max, step = 1, unit = '') => `<div class="rng"><input type="range" min="${min}" max="${max}" step="${step}" value="${getPath(k)}" data-set="${k}" data-unit="${unit}" aria-label="${k}"><output class="num">${fmtRange(getPath(k), unit)}</output></div>`;
const tog = k => `<label class="sw"><input type="checkbox" data-set="${k}" ${getPath(k) ? 'checked' : ''}><span></span></label>`;
const item = (label, ctrl, show = true, note = '') => show ? `<div class="set-item"><label>${esc(label)}${note ? `<br><small class="mute">${esc(note)}</small>` : ''}</label><div>${ctrl}</div></div>` : '';
const sec = (title, body) => body.trim() ? `<div class="set-sec"><h3>${esc(title)}</h3>${body}</div>` : '';
function fmtRange(v, unit) { if (unit === 'off0') return +v === 0 ? 'Off' : v + 's'; if (unit === '%') return Math.round(v * 100) + '%'; return v + unit; }
const HD_PRESETS = [['Quick start', [0.1, 1, 2, 4, 7, 11, 16]], ['Original Heardle', [1, 2, 4, 7, 11, 16]], ['Tiny', [0.1, 0.3, 0.6, 1, 2, 4]], ['Relaxed', [1, 3, 6, 10, 15, 25]]];
const ACCENTS = ['#ffb547', '#ff5e8a', '#6fe3a4', '#7aa7ff', '#c58bff', '#ffe066', '#4de0e0', '#ff8a4c'];

const SettingsUI = {
  target: null,     // element to render into, or 'modal'
  mode: null,       // null: global settings; a mode key: that mode's rules
  rules: null, mp: false, onChange: null, onClose: null,
  open(target, mode = null, { mp = false, onChange = null, onClose = null } = {}) {
    Object.assign(this, { target, mode, mp, onChange, onClose });
    if (mode) {
      this.rules = Modes.rules(mode);
      Edit.obj = this.rules;
      Edit.save = () => { Modes.save(this.mode, this.rules); this.onChange?.(); };
    } else { this.rules = null; Edit.obj = null; Edit.save = null; }
    this.render();
  },
  close() { Edit.obj = null; Edit.save = null; },
  curve() {
    const s = this.rules || S;
    const T = Math.max(s.timeLimit, s.decayEnd + 2), W = 600, H = 110, pad = 14, pts = [];
    for (let i = 0; i <= 60; i++) { const t = T * i / 60, p = Score.speed(t, s); pts.push(`${pad + (W - 2 * pad) * t / T},${H - pad - (H - 2 * pad) * p / Math.max(1, s.maxPts)}`); }
    const limX = pad + (W - 2 * pad) * Math.min(s.timeLimit, T) / T, m = Math.min(s.minPts, s.maxPts);
    return `<svg class="curve" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-label="Points by answer time"><line x1="${limX}" y1="6" x2="${limX}" y2="${H - 6}" stroke="var(--hot)" stroke-dasharray="4 4"/><polyline points="${pts.join(' ')}" fill="none" stroke="var(--acc)" stroke-width="3" stroke-linejoin="round"/></svg>
      <small class="mute">${s.speedBonus ? `${s.maxPts} points up to ${s.fullWindow}s, falling to ${m} at ${s.decayEnd}s, then ${m} until the timer (red line) runs out.` : `Every correct answer is worth ${s.maxPts}.`}</small>`;
  },

  /* ---------------- one mode's rules ---------------- */
  modeHTML() {
    const s = this.rules, key = this.mode, mp = this.mp, custom = key === 'custom';
    const has = k => !!s.types[k];
    const on = Object.keys(TYPES).filter(has);
    const typed = s.answerFormat !== 'choice', choosing = s.answerFormat !== 'text';
    const songTyped = typed && (has('title') || has('heardle') || (has('cover') && s.coverAnswer === 'title'));
    const wrongOptions = choosing && ['title', 'artist', 'album', 'truefalse', 'cover', 'heardle'].some(has);
    const clips = on.some(k => TYPES[k].audio && k !== 'heardle') || (has('cover') && s.coverAudio);
    const timed = on.some(k => k !== 'heardle');
    const types = Object.entries(TYPES).map(([k, T]) => `<label class="type-t"><input type="checkbox" data-set="types.${k}" ${has(k) ? 'checked' : ''}><span><b>${T.icon} ${esc(T.name)}</b><small>${esc(T.desc)}</small></span></label>`).join('');
    return `
      ${sec('Game', `
        ${item('Game type', seg('rule', [['classic', 'Set number of songs'], ['survival', 'Survival'], ['blitz', 'Blitz'], ['endless', 'Endless']]), custom && !mp)}
        ${item('Songs per game', rng('rounds', 3, 50), s.rule === 'classic' || mp)}
        ${item('Lives', rng('lives', 1, 10), s.rule === 'survival' && !mp)}
        ${item('Blitz length', rng('blitzTime', 30, 300, 15, 's'), s.rule === 'blitz' && !mp)}
        ${item('Time per song', rng('timeLimit', 5, 60, 1, 's'), timed)}
        ${custom ? `<div style="margin-top:10px"><div class="types">${types}</div></div>` : `<p class="mute" style="margin:8px 0 0"><small>Questions: ${esc(on.map(k => TYPES[k].name).join(', '))}. Want different ones? Use the Custom game.</small></p>`}`)}
      ${sec('Answers', `
        ${item('Answer style', seg('answerFormat', [['choice', 'Multiple choice'], ['text', 'Type it'], ['mixed', 'Mix both']]), on.some(k => !['year', 'genre', 'truefalse', 'first', 'oddone'].includes(k)))}
        ${item('Number of options', seg('numChoices', [[2, '2'], [3, '3'], [4, '4'], [6, '6']]), choosing)}
        ${item('Wrong options', seg('difficulty', DIFFICULTIES), wrongOptions, '“Same artist” and “Same album” look up the artist’s other songs and albums, and similar artists for artist questions')}
        ${item('Typed songs need the artist', tog('requireArtist'), songTyped, 'Answer as “Artist – Song” so common titles aren’t a giveaway')}
        ${item('Allow hints', tog('hints'), on.some(k => k !== 'heardle' && k !== 'truefalse' && k !== 'first' && k !== 'oddone'))}
        ${item('Let me play the songs during Odd one out', tog('oddPreview'), has('oddone'))}`)}
      ${sec('Points', `
        ${item('Faster answers score more', tog('speedBonus'))}
        ${item('Top score', rng('maxPts', 10, 1000, 10))}
        ${item('Lowest score for a right answer', rng('minPts', 0, 1000, 10), s.speedBonus)}
        ${item('Full points for the first', rng('fullWindow', 0, 15, 0.5, 's'), s.speedBonus && timed)}
        ${item('Points stop dropping at', rng('decayEnd', 1, 60, 0.5, 's'), s.speedBonus && timed)}
        ${s.speedBonus && timed ? `<div id="curveBox" style="margin:6px 0 10px">${this.curve()}</div>` : ''}
        ${item('Streak bonus', tog('streakBonus'), true, '×1.1 at 3 in a row, ×1.25 at 5, ×1.5 at 10')}
        ${item('Points lost for a wrong answer', rng('wrongPenalty', 0, 100, 5))}`)}
      ${sec('Similar songs', `
        ${item('Mix in similar songs', rng('similar', 0, 0.6, 0.05, '%'), true, 'How often a question swaps its song for a relative you may not have saved')}
        ${s.similar > 0 ? `${item('Same album', rng('similarMix.album', 0, 100, 5, ''), true, 'Another song from the album the question’s song is on')}
        ${item('Same artist', rng('similarMix.artist', 0, 100, 5, ''), true, 'Another song by the same artist')}
        ${item('Similar artists', rng('similarMix.related', 0, 100, 5, ''), true, 'A song by an artist Deezer lists as similar')}
        <p class="mute" style="margin:6px 0 0"><small>${this.mixText(s)}</small></p>` : ''}`)}
      ${sec('Clips', clips ? `
        ${item('Clip starts at', seg('clipStart', [['random', 'Random point'], ['start', 'The beginning'], ['middle', 'Around the chorus']]))}
        ${item('Clip length', seg('clipLength', [[0, 'Until you answer'], [2, '2s'], [5, '5s'], [10, '10s']]))}` : '')}
      ${sec('Cover reveal', has('cover') ? `
        ${item('Reveal style', seg('coverStyle', [['pixelate', 'Pixels'], ['blur', 'Blur'], ['tiles', 'Tiles'], ['zoom', 'Zoom'], ['random', 'Surprise me']]))}
        ${item('Guess from the cover', seg('coverAnswer', [['album', 'Album'], ['artist', 'Artist'], ['title', 'Song']]))}
        ${item('Play the song during cover reveal', tog('coverAudio'))}` : '')}
      ${sec('Heardle', has('heardle') ? `
        ${item('Song you get at each step', `<input class="field num" id="hdSteps" value="${esc(heardleSteps(s.heardleStages).join(', '))}" aria-label="Heardle steps in seconds" style="max-width:320px">`, true, 'Seconds, separated by commas: first try, then after each skip or wrong guess. 2 to 10 steps, 0.1–30 seconds.')}
        <div class="chips" style="margin:4px 0 0">${HD_PRESETS.map(([name, v]) => `<button type="button" class="chip ${heardleSteps(s.heardleStages).join() === v.join() ? 'on' : ''}" data-act="hdPreset" data-v="${v.join(',')}">${esc(name)} <small>${v.map(fmtSec).join(' ')}</small></button>`).join('')}</div>` : '')}
      ${sec('Release years', has('year') ? `
        ${item('Year answer', seg('yearFormat', [['slider', 'Slider (close counts)'], ['choice', 'Pick a year'], ['decade', 'Pick a decade']]))}
        ${item('Show title and artist', tog('yearShowInfo'))}` : '')}
      <div class="row" style="margin-top:6px">${Modes.changed(key) ? `<button class="btn sm ghost" data-act="resetMode">Reset ${esc(PRESETS[key]?.name || 'this mode')} to default</button>` : `<small class="mute">${key === 'custom' ? 'Changes save automatically.' : 'These are the default rules. Changes save automatically, only for this mode.'}</small>`}</div>`;
  },

  mixText(s) {
    const m = s.similarMix || {}, tot = (m.album || 0) + (m.artist || 0) + (m.related || 0);
    if (!tot) return 'Set at least one of these above 0, or no similar songs are used.';
    const p = k => Math.round((m[k] || 0) / tot * 100);
    return `About ${Math.round(s.similar * 100)}% of questions use a similar song: ${p('album')}% from the same album, ${p('artist')}% from the same artist, ${p('related')}% by similar artists. If one kind has nothing new, another is tried.`;
  },

  /* ---------------- global settings ---------------- */
  filtersHTML() {
    const f = S.filters, all = Lib.all(), sum = Lib.summary(all);
    const present = new Map(); for (const t of all) for (const g of broadOf(t)) present.set(g, (present.get(g) || 0) + 1);
    const genres = [...present.entries()].sort((a, b) => b[1] - a[1]);
    const groups = new Map(); for (const t of all) { const a = t.artists[0]?.name; if (a) groups.set(a, (groups.get(a) || 0) + 1); }
    const artists = [...groups.entries()].filter(x => x[1] >= 3).sort((a, b) => b[1] - a[1]).slice(0, 150);
    return `
      ${item('Release years', `<div class="row"><input class="field num" style="width:110px" type="number" data-set="filters.yearMin" placeholder="${sum.yMin || 'From'}" value="${f.yearMin ?? ''}" aria-label="From year"> <span class="mute">to</span> <input class="field num" style="width:110px" type="number" data-set="filters.yearMax" placeholder="${sum.yMax || 'To'}" value="${f.yearMax ?? ''}" aria-label="To year"></div>`, true, 'Songs without a known year are skipped when this is set')}
      ${item('Genres', genres.length ? `<div class="chips">${genres.map(([g, c]) => `<button type="button" class="chip ${f.genres.includes(g) ? 'on' : ''}" data-act="fGenre" data-g="${esc(g)}">${esc(g)} <small>${c}</small></button>`).join('')}</div>` : `<small class="mute">No genres yet — scan them in Genres below.</small>`)}
      ${item('Only this artist', `<select class="field" data-set="filters.artist"><option value="">Any artist</option>${artists.map(([a, c]) => `<option value="${esc(a)}" ${f.artist === a ? 'selected' : ''}>${esc(a)} (${c})</option>`).join('')}</select>`)}
      ${item('Balance between sources', seg('mixMode', [['even', 'Even'], ['size', 'By number of songs']]), true, 'Even: each source you switched on (liked songs, a chart, a friend…) comes up equally often, however big it is')}
      ${item('Avoid songs from recent games', tog('avoidRecent'), true, 'Only when there are enough other songs — small song lists still work')}
      ${item('How many games back', rng('recentGames', 1, 15, 1, ' games'), S.avoidRecent)}
      ${item('Skip explicit songs', tog('filters.noExplicit'))}
      <p class="mute" style="margin:8px 0 0"><b style="color:var(--ink)">${fmtN(Lib.filtered(all).length)}</b> of ${fmtN(all.length)} songs match. <button class="btn sm ghost" data-act="fReset">Clear filters</button> <button class="btn sm ghost" data-act="forgetRecent">Forget recent songs</button></p>
      <p class="mute"><small>Choose which sources are switched on from the <a href="/play">Play page</a>.</small></p>`;
  },
  genresHTML() {
    const st = Lib.genreStatus();
    return `<p style="margin:0 0 10px">${st.total ? `<b>${fmtN(st.known)}</b> of ${fmtN(st.total)} artists in your switched-on songs have a genre.` : 'Switch on some songs on the Play page first.'}
        ${st.todo ? ` ${fmtN(st.todo)} still to look up${st.spotifyTodo ? ` (${fmtN(st.spotifyTodo)} on Spotify)` : ''}.` : st.total ? ' Nothing left to look up.' : ''}</p>
      <div class="row"><button class="btn sm" data-act="scanGenres" ${st.todo && !this.scanning ? '' : 'disabled'}>${this.scanning ? 'Scanning…' : 'Scan genres'}</button>
        <button class="btn sm ghost" data-act="forgetGenres" ${this.scanning ? 'disabled' : ''}>Forget and scan again later</button></div>
      <div id="genProg" class="${this.scanning ? '' : 'hidden'}"><div class="prog"><i></i></div><small class="mute" id="genProgTxt"></small></div>
      <p class="mute" style="margin:12px 0 0"><small>Used for genre questions, the genre filter above and “similar” wrong options.
        Genres are saved in this browser, so a scan only looks up artists it hasn’t seen before — new songs, not the whole library again.</small></p>
      <details class="api-info"><summary>How the lookups count against limits</summary>
        <p><b>Spotify</b> (only when you’re logged in): genres are read 50 artists per request, so 1,000 artists is about 20 requests.
          Spotify doesn’t publish a daily cap — its limit counts requests over a rolling 30 seconds, and apps in development mode get a lower one.
          If you hit it, Spotify says “wait”, and Earworm waits and carries on by itself. Many big bursts in a row can make Spotify block the app for hours, so scan once and let the cache do the rest.
          Loading songs also counts: about 1 request per 50 liked songs or playlist songs.</p>
        <p><b>Deezer</b> fills in artists Spotify has no genre for (and works without logging in). It goes through this site’s server, which caches answers and stays under Deezer’s limit of 50 requests per 5 seconds, shared by everyone on the site — a big scan just runs a little slower. There’s no daily limit.</p>
      </details>`;
  },
  globalHTML() {
    return `
      ${sec('Pace', `
        ${item('Break before each song', rng('readyPause', 0, 3, 0.5, 'off0'), true, 'Shows what you’ll guess next before the clip and timer start (not in Blitz)')}
        ${item('Next song automatically', rng('autoAdvance', 0, 15, 1, 'off0'), true, 'After the answer is shown (Blitz always moves on after 1s)')}`)}
      ${sec('Song names', `
        ${item('Prefer English / romanized names', tog('romanized'), true, 'For songs and artists written in Japanese, Korean or Chinese, use the English or romanized name when Spotify or Deezer has one (米津玄師 → Kenshi Yonezu, 紅蓮華 → Gurenge). Names are looked up in the background and remembered. The original names still count as right answers.')}
        ${item('Suggest names while typing', tog('autocomplete'), true, 'Searches the whole Deezer catalog, not just your songs')}`)}
      ${sec('Audio', `
        ${item('Play songs with', seg('audioSource', [['auto', 'Spotify if Premium'], ['preview', '30s previews']]))}
        ${item('After you answer', seg('afterAnswer', [['stop', 'Stop'], ['fade', 'Play 2s more, then fade'], ['full', 'Keep playing until next song']]))}
        ${item('Volume', rng('volume', 0, 1, 0.01, '%'))}
        ${item('Sound effects', tog('sfx'))}`)}
      ${sec('Which songs', this.filtersHTML())}
      ${sec('Genres', this.genresHTML())}
      ${sec('Look', `${item('Accent color', `<div class="row">${ACCENTS.map(c => `<button type="button" class="swatch ${S.accent === c ? 'on' : ''}" style="background:${c}" data-act="set" data-set="accent" data-val="${c}" aria-label="Accent ${c}"></button>`).join('')}<input type="color" value="${S.accent}" data-set="accent" aria-label="Custom accent"></div>`)}
        <button class="btn sm ghost" data-act="resetSettings">Reset these settings</button>`)}`;
  },

  render() {
    const html = this.mode ? this.modeHTML() : this.globalHTML();
    if (this.target === 'modal') {
      const scroll = $('#modal')?.scrollTop || 0;
      const title = this.mode ? `${PRESETS[this.mode]?.icon || ''} ${esc(PRESETS[this.mode]?.name || 'Game')} settings` : 'Settings';
      Modal.open(`<button class="btn sm ghost x" data-act="closeModal">Close</button><h2>${title}</h2>${html}<div class="sheet-foot"><button class="btn primary" data-act="closeModal">Done</button></div>`, '', () => { this.close(); this.onClose?.(); });
      $('#modal').scrollTop = scroll;
    } else if (this.target) {
      this.target.innerHTML = html;
    }
  },
  refreshCurve() { const cb = $('#curveBox'); if (cb) cb.innerHTML = this.curve(); }
};
Object.assign(Act, {
  set(el) { const v = el.dataset.val; setPath(el.dataset.set, /^-?\d+(\.\d+)?$/.test(v) ? +v : v); saveEdit(); SettingsUI.render(); },
  fGenre(el) { const g = el.dataset.g, f = S.filters; f.genres = f.genres.includes(g) ? f.genres.filter(x => x !== g) : [...f.genres, g]; saveS(); SettingsUI.render(); },
  async scanGenres() {
    if (SettingsUI.scanning) return;
    SettingsUI.scanning = true; SettingsUI.render();
    const prog = (t, f) => { $('#genProg')?.classList.remove('hidden'); const i = $('#genProg i'); if (i) i.style.width = Math.round(clamp(f, 0, 1) * 100) + '%'; const x = $('#genProgTxt'); if (x) x.textContent = t; };
    try { await Lib.scanGenres(prog); const st = Lib.genreStatus(); toast(`Genres ready: ${fmtN(st.known)} of ${fmtN(st.total)} artists have one.`); }
    catch (e) { toast(e.message + ' What was found so far is saved — scan again later to continue.', 8000); }
    SettingsUI.scanning = false; SettingsUI.render();
  },
  forgetGenres() { if (!confirm('Forget all saved genres? You’ll need to scan again.')) return; Lib.forgetGenres(); SettingsUI.render(); },
  hdPreset(el) { setPath('heardleStages', el.dataset.v.split(',').map(Number)); saveEdit(); SettingsUI.render(); },
  forgetRecent() { Recent.clear(); toast('Recent songs forgotten — every song is fair game again.'); },
  fReset() { S.filters = clone(DEFAULTS.filters); saveS(); SettingsUI.render(); },
  resetSettings() {
    if (!confirm('Reset these settings to their defaults? Game mode rules stay as they are.')) return;
    const d = clone(DEFAULTS); for (const k of Object.keys(d)) if (!RULE_KEYS.includes(k)) S[k] = d[k];
    saveS(); setVolume(S.volume); SettingsUI.render();
  },
  resetMode() {
    const k = SettingsUI.mode; if (!k) return;
    Modes.reset(k); SettingsUI.rules = Modes.rules(k); Edit.obj = SettingsUI.rules;
    SettingsUI.render(); SettingsUI.onChange?.(); toast(`${PRESETS[k]?.name || 'Mode'} is back to its default rules.`);
  }
});
document.addEventListener('input', e => {
  const el = e.target; if (!el.matches('input[type=range][data-set]')) return;
  setPath(el.dataset.set, +el.value);
  const o = el.parentElement.querySelector('output'); if (o) o.textContent = fmtRange(+el.value, el.dataset.unit);
  if (el.dataset.set === 'volume' && !Edit.obj) setVolume(S.volume);
  SettingsUI.refreshCurve();
});
document.addEventListener('change', e => {
  if (e.target.id === 'hdSteps') {   // "0.1, 1, 2, 4" -> Heardle steps
    const v = heardleSteps(e.target.value.split(/[,;\s]+/).map(x => parseFloat(x.replace(/s$/i, ''))));
    setPath('heardleStages', v); saveEdit(); SettingsUI.render(); return;
  }
  const el = e.target; if (!el.dataset || !el.dataset.set || el.dataset.act) return;
  const k = el.dataset.set; let v;
  if (el.type === 'checkbox') v = el.checked;
  else if (el.type === 'range' || el.type === 'number' || el.dataset.num) v = el.value === '' ? null : +el.value;
  else v = el.value;
  setPath(k, v); saveEdit();
  if (k === 'romanized') { Lib.changed(); if (v) for (const m of Lib.sets) Romanize.schedule(m.key); }
  if (!$('.set-sec')) return;
  SettingsUI.render();   // a change can show or hide other options (and the reset button)
});
