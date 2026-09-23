'use strict';
/* Settings panel — renders into the Settings page or a modal (multiplayer lobby). */
const seg = (k, opts) => `<div class="seg" role="group">${opts.map(([v, l]) => `<button type="button" class="${String(getPath(k)) === String(v) ? 'on' : ''}" data-act="set" data-set="${k}" data-val="${v}">${esc(l)}</button>`).join('')}</div>`;
const rng = (k, min, max, step = 1, unit = '') => `<div class="rng"><input type="range" min="${min}" max="${max}" step="${step}" value="${getPath(k)}" data-set="${k}" data-unit="${unit}" aria-label="${k}"><output class="num">${fmtRange(getPath(k), unit)}</output></div>`;
const tog = k => `<label class="sw"><input type="checkbox" data-set="${k}" ${getPath(k) ? 'checked' : ''}><span></span></label>`;
const item = (label, ctrl, show = true, note = '') => show ? `<div class="set-item"><label>${esc(label)}${note ? `<br><small class="mute">${esc(note)}</small>` : ''}</label><div>${ctrl}</div></div>` : '';
function fmtRange(v, unit) { if (unit === 'off0') return +v === 0 ? 'Off' : v + 's'; if (unit === '%') return Math.round(v * 100) + '%'; return v + unit; }
const ACCENTS = ['#ffb547', '#ff5e8a', '#6fe3a4', '#7aa7ff', '#c58bff', '#ffe066', '#4de0e0', '#ff8a4c'];

const SettingsUI = {
  target: null,     // element to render into, or 'modal'
  mp: false,
  onStart: null,
  curve() {
    const T = Math.max(S.timeLimit, S.decayEnd + 2), W = 600, H = 110, pad = 14, pts = [];
    for (let i = 0; i <= 60; i++) { const t = T * i / 60, p = Score.speed(t); pts.push(`${pad + (W - 2 * pad) * t / T},${H - pad - (H - 2 * pad) * p / Math.max(1, S.maxPts)}`); }
    const limX = pad + (W - 2 * pad) * Math.min(S.timeLimit, T) / T, m = Math.min(S.minPts, S.maxPts);
    return `<svg class="curve" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-label="Points by answer time"><line x1="${limX}" y1="6" x2="${limX}" y2="${H - 6}" stroke="var(--hot)" stroke-dasharray="4 4"/><polyline points="${pts.join(' ')}" fill="none" stroke="var(--acc)" stroke-width="3" stroke-linejoin="round"/></svg>
      <small class="mute">${S.speedBonus ? `${S.maxPts} points up to ${S.fullWindow}s, falling to ${m} at ${S.decayEnd}s, then ${m} until the timer (red line) runs out.` : `Every correct answer is worth ${S.maxPts}.`}</small>`;
  },
  filtersHTML() {
    const f = S.filters, all = Lib.all(), sum = Lib.summary(all);
    const present = new Map(); for (const t of all) for (const g of broadOf(t)) present.set(g, (present.get(g) || 0) + 1);
    const genres = [...present.entries()].sort((a, b) => b[1] - a[1]);
    const groups = new Map(); for (const t of all) { const a = t.artists[0]?.name; if (a) groups.set(a, (groups.get(a) || 0) + 1); }
    const artists = [...groups.entries()].filter(x => x[1] >= 3).sort((a, b) => b[1] - a[1]).slice(0, 150);
    return `
      ${item('Release years', `<div class="row"><input class="field num" style="width:110px" type="number" data-set="filters.yearMin" placeholder="${sum.yMin || 'From'}" value="${f.yearMin ?? ''}" aria-label="From year"> <span class="mute">to</span> <input class="field num" style="width:110px" type="number" data-set="filters.yearMax" placeholder="${sum.yMax || 'To'}" value="${f.yearMax ?? ''}" aria-label="To year"></div>`, true, 'Songs without a known year are skipped when this is set')}
      ${item('Genres', genres.length ? `<div class="chips">${genres.map(([g, c]) => `<button type="button" class="chip ${f.genres.includes(g) ? 'on' : ''}" data-act="fGenre" data-g="${esc(g)}">${esc(g)} <small>${c}</small></button>`).join('')}</div>` : `<small class="mute">Scan genres on the Play page, or load a genre chart.</small>`)}
      ${item('Only this artist', `<select class="field" data-set="filters.artist"><option value="">Any artist</option>${artists.map(([a, c]) => `<option value="${esc(a)}" ${f.artist === a ? 'selected' : ''}>${esc(a)} (${c})</option>`).join('')}</select>`)}
      ${item('Balance between sources', seg('mixMode', [['even', 'Even'], ['size', 'By number of songs']]), true, 'Even: each source you switched on (liked songs, a chart, a friend…) comes up equally often, however big it is')}
      ${item('Avoid songs from recent games', tog('avoidRecent'), true, 'Only when there are enough other songs — small song lists still work')}
      ${item('How many games back', rng('recentGames', 1, 15, 1, ' games'), S.avoidRecent)}
      ${item('Skip explicit songs', tog('filters.noExplicit'))}
      <p class="mute" style="margin:8px 0 0"><b style="color:var(--ink)">${fmtN(Lib.filtered(all).length)}</b> of ${fmtN(all.length)} songs match. <button class="btn sm ghost" data-act="fReset">Clear filters</button> <button class="btn sm ghost" data-act="forgetRecent">Forget recent songs</button></p>
      <p class="mute"><small>Choose which sources are switched on from the <a href="/play">Play page</a>.</small></p>`;
  },
  html() {
    const mp = this.mp;
    const types = Object.entries(TYPES).map(([k, T]) => `<label class="type-t"><input type="checkbox" data-set="types.${k}" ${S.types[k] ? 'checked' : ''}><span><b>${T.icon} ${esc(T.name)}</b><small>${esc(T.desc)}</small></span></label>`).join('');
    return `
      <div class="set-sec"><h3>Start from a preset</h3><div class="chips">${Object.entries(PRESETS).filter(([k]) => !mp || (k !== 'survival' && k !== 'blitz')).map(([k, p]) => `<button type="button" class="chip" data-act="loadPreset" data-k="${k}">${p.icon} ${esc(p.name)}</button>`).join('')}</div></div>
      <div class="set-sec"><h3>Game</h3>
        ${mp ? '' : item('Game type', seg('rule', [['classic', 'Set number of songs'], ['survival', 'Survival'], ['blitz', 'Blitz'], ['endless', 'Endless']]))}
        ${item('Songs per game', rng('rounds', 3, 50), S.rule === 'classic' || mp)}
        ${item('Lives', rng('lives', 1, 10), S.rule === 'survival' && !mp)}
        ${item('Blitz length', rng('blitzTime', 30, 300, 15, 's'), S.rule === 'blitz' && !mp)}
        ${item('Time per song', rng('timeLimit', 5, 60, 1, 's'))}
        ${item('Break before each song', rng('readyPause', 0, 3, 0.5, 'off0'), true, 'Shows what you’ll guess next before the clip and timer start (not in Blitz)')}
        <div style="margin-top:10px"><div class="types">${types}</div></div>
      </div>
      <div class="set-sec"><h3>Answers</h3>
        ${item('Answer style', seg('answerFormat', [['choice', 'Multiple choice'], ['text', 'Type it'], ['mixed', 'Mix both']]))}
        ${item('Number of options', seg('numChoices', [[2, '2'], [3, '3'], [4, '4'], [6, '6']]))}
        ${item('Wrong options', seg('difficulty', DIFFICULTIES), true, '“Same artist” and “Same album” look up the artist’s other songs and albums, and similar artists for artist questions')}
        ${item('Typed songs need the artist', tog('requireArtist'), true, 'Answer as “Artist – Song” so common titles aren’t a giveaway')}
        ${item('Suggest names while typing', tog('autocomplete'), true, 'Searches the whole Deezer catalog, not just your songs')}
        ${item('Allow hints', tog('hints'))}
        ${item('Let me play the songs during Odd one out', tog('oddPreview'))}
        ${item('Next song automatically', rng('autoAdvance', 0, 15, 1, 'off0'))}
      </div>
      <div class="set-sec"><h3>Points</h3>
        ${item('Faster answers score more', tog('speedBonus'))}
        ${item('Top score', rng('maxPts', 10, 1000, 10))}
        ${item('Lowest score for a right answer', rng('minPts', 0, 1000, 10))}
        ${item('Full points for the first', rng('fullWindow', 0, 15, 0.5, 's'))}
        ${item('Points stop dropping at', rng('decayEnd', 1, 60, 0.5, 's'))}
        <div id="curveBox" style="margin:6px 0 10px">${this.curve()}</div>
        ${item('Streak bonus', tog('streakBonus'), true, '×1.1 at 3 in a row, ×1.25 at 5, ×1.5 at 10')}
        ${item('Points lost for a wrong answer', rng('wrongPenalty', 0, 100, 5))}
      </div>
      <div class="set-sec"><h3>Audio</h3>
        ${item('Play songs with', seg('audioSource', [['auto', 'Spotify if Premium'], ['preview', '30s previews']]))}
        ${item('Clip starts at', seg('clipStart', [['random', 'Random point'], ['start', 'The beginning'], ['middle', 'Around the chorus']]))}
        ${item('Clip length', seg('clipLength', [[0, 'Until you answer'], [2, '2s'], [5, '5s'], [10, '10s']]))}
        ${item('After you answer', seg('afterAnswer', [['stop', 'Stop'], ['fade', 'Play 2s more, then fade'], ['full', 'Keep playing until next song']]))}
        ${item('Volume', rng('volume', 0, 1, 0.05, '%'))}
        ${item('Sound effects', tog('sfx'))}
      </div>
      <div class="set-sec"><h3>Covers and years</h3>
        ${item('Cover reveal style', seg('coverStyle', [['pixelate', 'Pixels'], ['blur', 'Blur'], ['tiles', 'Tiles'], ['zoom', 'Zoom'], ['random', 'Surprise me']]))}
        ${item('Guess from the cover', seg('coverAnswer', [['album', 'Album'], ['artist', 'Artist'], ['title', 'Song']]))}
        ${item('Play the song during cover reveal', tog('coverAudio'))}
        ${item('Year answer', seg('yearFormat', [['slider', 'Slider (close counts)'], ['choice', 'Pick a year'], ['decade', 'Pick a decade']]))}
        ${item('Show title and artist for year questions', tog('yearShowInfo'))}
      </div>
      <div class="set-sec"><h3>Which songs</h3>${this.filtersHTML()}</div>
      <div class="set-sec"><h3>Look</h3>${item('Accent color', `<div class="row">${ACCENTS.map(c => `<button type="button" class="swatch ${S.accent === c ? 'on' : ''}" style="background:${c}" data-act="set" data-set="accent" data-val="${c}" aria-label="Accent ${c}"></button>`).join('')}<input type="color" value="${S.accent}" data-set="accent" aria-label="Custom accent"></div>`)}
        <button class="btn sm ghost" data-act="resetSettings">Reset all settings</button></div>`;
  },
  render() {
    if (this.target === 'modal') {
      const scroll = $('#modal')?.scrollTop || 0;
      Modal.open(`<button class="btn sm ghost x" data-act="closeModal">Close</button><h2>Game settings</h2>${this.html()}<div class="sheet-foot"><button class="btn primary" data-act="closeModal">Done</button></div>`, '', this.onClose);
      $('#modal').scrollTop = scroll;
    } else if (this.target) {
      this.target.innerHTML = this.html();
    }
  },
  refreshCurve() { const cb = $('#curveBox'); if (cb) cb.innerHTML = this.curve(); }
};
Object.assign(Act, {
  set(el) { const v = el.dataset.val; setPath(el.dataset.set, /^-?\d+(\.\d+)?$/.test(v) ? +v : v); saveS(); SettingsUI.render(); },
  fGenre(el) { const g = el.dataset.g, f = S.filters; f.genres = f.genres.includes(g) ? f.genres.filter(x => x !== g) : [...f.genres, g]; saveS(); SettingsUI.render(); },
  forgetRecent() { Recent.clear(); toast('Recent songs forgotten — every song is fair game again.'); },
  fReset() { S.filters = JSON.parse(JSON.stringify(DEFAULTS.filters)); saveS(); SettingsUI.render(); },
  resetSettings() { if (!confirm('Reset every setting to its default?')) return; S = JSON.parse(JSON.stringify(DEFAULTS)); saveS(); SettingsUI.render(); },
  loadPreset(el) { S = presetSettings(el.dataset.k); if (SettingsUI.mp) S.rule = 'classic'; saveS(); SettingsUI.render(); toast(PRESETS[el.dataset.k].name + ' settings loaded.'); }
});
document.addEventListener('input', e => {
  const el = e.target; if (!el.matches('input[type=range][data-set]')) return;
  setPath(el.dataset.set, +el.value);
  const o = el.parentElement.querySelector('output'); if (o) o.textContent = fmtRange(+el.value, el.dataset.unit);
  if (el.dataset.set === 'volume') setVolume(S.volume);
  SettingsUI.refreshCurve();
});
document.addEventListener('change', e => {
  const el = e.target; if (!el.dataset || !el.dataset.set || el.dataset.act) return;
  const k = el.dataset.set; let v;
  if (el.type === 'checkbox') v = el.checked;
  else if (el.type === 'range' || el.type === 'number' || el.dataset.num) v = el.value === '' ? null : +el.value;
  else v = el.value;
  setPath(k, v); saveS();
  if (!$('.set-sec')) return;
  if (k.startsWith('filters') || k === 'accent' || k.startsWith('types') || k === 'avoidRecent') SettingsUI.render(); else if (el.type === 'range') SettingsUI.refreshCurve();
});
