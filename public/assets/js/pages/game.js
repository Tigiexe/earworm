'use strict';
/* Single-player game page: /game?mode=<preset key | custom> */
const MODE = new URLSearchParams(location.search).get('mode') || 'custom';
const Game = {
  st: null, pre: null, savedS: null,
  intro() {
    Header.render('play'); Player.initSDK(); Player.badge();
    const p = PRESETS[MODE], s = MODE === 'custom' ? S : presetSettings(MODE);
    const pool = Lib.filtered();
    $('#qArea').innerHTML = `<div class="intro"><div class="intro-ic">${p ? p.icon : '🎛️'}</div><h1>${esc(p ? p.name : 'Custom game')}</h1>
      <p class="mute">${esc(p ? p.desc : '')}</p><p>${esc(settingsSummary(s))}</p>
      <p class="mute"><small>${fmtN(pool.length)} songs in the mix. Audio: ${Player.mode() === 'sdk' ? 'full songs' : '30-second previews'}.</small></p>
      <div class="row" style="justify-content:center"><button class="btn primary big" id="startBtn">Start</button><a class="btn ghost" href="/play">Back</a></div>
      <p class="mute"><small>Keys: 1–6 pick an answer, R replays the clip, Enter goes to the next song.</small></p></div>`;
    const b = $('#startBtn'); b.focus(); b.onclick = () => this.start();
  },
  async start() {
    this.savedS = S; S = MODE === 'custom' ? JSON.parse(JSON.stringify(S)) : presetSettings(MODE);
    const pool = Lib.filtered();
    if (pool.length < 4) { S = this.savedS; toast(Lib.all().length < 4 ? 'Load some songs on the Play page first.' : `Only ${pool.length} songs match your filters. Loosen them in Settings.`); return; }
    const types = Engine.setup(pool);
    if (!types.length) { S = this.savedS; toast('None of the selected question types work with these songs. Try Song title or Artist.'); return; }
    if (Engine.skipped.length) toast('Skipped ' + Engine.skipped.map(k => TYPES[k].name).join(', ') + ' — not enough song data for it.');
    Player.unlock();
    this.st = { key: MODE, rule: S.rule, round: 0, score: 0, streak: 0, best: 0, lives: S.rule === 'survival' ? S.lives : null, hist: [], correct: 0, total: S.rule === 'classic' ? S.rounds : null, blitzEnd: null };
    $('.hud').classList.remove('hidden'); this.hud(); this.next();
  },
  over() {
    const st = this.st; if (!st) return true;
    if (st.rule === 'classic') return st.round >= st.total;
    if (st.rule === 'survival') return st.lives <= 0;
    if (st.rule === 'blitz') return st.blitzEnd && performance.now() >= st.blitzEnd;
    return false;
  },
  async next() {
    const st = this.st; if (!st) return;
    Player.fadeOut(300);
    if (this.over()) return this.end();
    Reveal.clear();
    $('#qArea').innerHTML = '<div class="loading">Cueing up the next song…</div>';
    let q = null;
    try { q = await (this.pre || Engine.nextPrepared()); } catch (e) { toast(e.message); }
    this.pre = null;
    if (st !== this.st) return;
    if (!q) { toast('Ran out of playable songs.'); return this.end(); }
    st.round++;
    if (st.rule === 'blitz' && !st.blitzEnd) st.blitzEnd = performance.now() + S.blitzTime * 1000;
    this.hud();
    this.pre = Engine.nextPrepared(); this.pre.catch(() => {});
    const res = await QUI.run(q, { limit: limitFor(q), names: Engine.names, roundLabel: st.round, globalEnd: st.blitzEnd, pause: st.rule === 'blitz' ? 0 : S.readyPause, reroll: (this.rerolls || 0) < 3, onShown: x => Engine.shown(x), onTick: st.rule === 'blitz' ? () => this.tickBlitz() : null });
    if (st !== this.st) return;
    if (res.unplayable) { this.rerolls = (this.rerolls || 0) + 1; Engine.markBad(q.track); st.round--; toast('That song wouldn’t play — here’s another.', 2500); return this.next(); }
    this.rerolls = 0;   // after 3 broken songs in a row, stop swapping (something bigger is wrong) and just show the question
    if (res.aborted) return;
    this.resolve(q, res);
  },
  tickBlitz() { const st = this.st; if (!st?.blitzEnd) return; const left = Math.max(0, Math.ceil((st.blitzEnd - performance.now()) / 1000)); const el = $('#hudExtra'), t = `<b class="num">${left}s</b> left`; if (el.innerHTML !== t) el.innerHTML = t; },
  resolve(q, res) {
    const st = this.st;
    if (res.blitzOver) { st.round--; return this.end(); }
    let pts = res.points;
    if (res.correct) { st.streak++; st.best = Math.max(st.best, st.streak); st.correct++; if (S.streakBonus) pts = Math.round(pts * Score.streak(st.streak)); SFX.ok(); }
    else if (res.factor > 0) { st.streak = 0; SFX.part(); }
    else { st.streak = 0; if (st.lives != null) st.lives--; pts = -S.wrongPenalty; SFX.bad(); }
    const before = st.score; st.score = Math.max(0, st.score + pts); pts = st.score - before;
    st.hist.push({ q, res, pts });
    floatPts(pts); this.hud();
    QUI.markReveal(res);
    if (q.track && (q.audio || q.type === 'cover')) Player.afterAnswer(q.track, QUI.ctx?.startSec); else Player.fadeOut(300);
    Reveal.show({ q, res, pts, last: this.over(), onNext: () => this.next() });
  },
  hud() {
    const st = this.st; if (!st) return;
    $('#hudRound').innerHTML = st.total ? `Song <b class="num">${st.round}</b> of ${st.total}` : `Song <b class="num">${st.round}</b>`;
    if (st.rule === 'survival') $('#hudExtra').innerHTML = `<span aria-label="${st.lives} lives">${'❤️'.repeat(Math.max(0, st.lives))}${'🤍'.repeat(Math.max(0, S.lives - st.lives))}</span>`;
    else if (st.rule === 'blitz') this.tickBlitz(); else $('#hudExtra').textContent = '';
    $('#hudScore').textContent = fmtN(st.score); $('#hudStreak').textContent = streakTxt(st.streak);
  },
  end() {
    const st = this.st; if (!st) return;
    this.st = null; this.pre = null; QUI.abort(); Reveal.clear(); Player.fadeOut(600);
    const name = PRESETS[st.key]?.name || 'Custom game';
    const newBest = Stats.record({ key: st.key, name, score: st.score, bestStreak: st.best }, st.hist);
    if (this.savedS) { S = this.savedS; this.savedS = null; }
    if (!st.hist.length) return go('play');
    session.set('lastGame', { key: st.key, name, score: st.score, correct: st.correct, best: st.best, newBest, hist: st.hist.map(h => ({ q: { type: h.q.type, answer: h.q.answer, kind: h.q.kind, track: h.q.track }, res: { correct: h.res.correct, factor: h.res.factor, given: h.res.given, elapsed: h.res.elapsed }, pts: h.pts })) });
    setTimeout(() => go('results'), 250);
  }
};
Act.quit = () => { if (Game.st) Game.end(); else go('play'); };
Lib.init().then(() => Game.intro());
