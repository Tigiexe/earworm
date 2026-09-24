'use strict';
/* ---------------- track registry for play / like buttons ---------------- */
const TrackReg = new Map();
function reg(t) { if (t?.id) TrackReg.set(t.id, t); return t?.id || ''; }
function playBtn(t, cls = '') { if (!t) return ''; return `<button type="button" class="pbtn ${cls} ${Player.current === t.id && Player.playing ? 'on' : ''}" data-act="preview" data-tid="${esc(reg(t))}" aria-label="Play ${esc(t.name)}" title="Play / stop"><span class="pi"></span></button>`; }
function likeBtn(t) {
  if (!t || !Liked.can()) return '';
  const on = Liked.isLiked(t);
  return `<button type="button" class="lbtn ${on ? 'on' : ''}" data-act="like" data-tid="${esc(reg(t))}" ${on ? 'disabled' : ''} title="${on ? 'In your liked songs' : 'Add to liked songs'}">${on ? '♥ Liked' : '♡ Like'}</button>`;
}
function openLink(t) { if (!t) return ''; const href = t.uri ? `https://open.spotify.com/track/${t.uri.split(':').pop()}` : t.link; return href ? `<a class="rv-open" href="${esc(href)}" target="_blank" rel="noopener">${t.uri ? 'Spotify' : 'Deezer'}</a>` : ''; }
Player.onChange = (id, playing) => { $$('.pbtn').forEach(b => b.classList.toggle('on', playing && b.dataset.tid === id)); };
Object.assign(Act, {
  async preview(el) { const t = TrackReg.get(el.dataset.tid); if (t) { Player.unlock(); await Player.toggle(t); } },
  async like(el) {
    const t = TrackReg.get(el.dataset.tid); if (!t) return;
    el.disabled = true; el.textContent = 'Saving…';
    try { await Liked.save(t); $$(`.lbtn[data-tid="${CSS.escape(t.id)}"]`).forEach(b => { b.classList.add('on'); b.textContent = '♥ Liked'; b.disabled = true; }); toast(`Added “${t.name}” to your liked songs.`); }
    catch (e) { el.disabled = false; el.textContent = '♡ Like'; toast(e.message); }
  }
});
function trackCard(t, opts = {}) {
  if (!t) return '';
  const meta = [t.album.name, t.album.year].filter(Boolean).join(', ');
  const owners = t.owners?.length && !t.similar ? `<div class="owner-note">${t.owners.map(o => `<span class="pchip" style="--pc:${playerColor(o)}">${esc(o)}</span>`).join('')}<small class="mute">’s songs</small></div>` : '';
  const sm = t.similar, blend = sm ? `<div class="sim-note">${sm.orig ? playBtn(sm.orig, 'mini') : ''}<span>✨ ${sm.kind === 'album' ? `Bonus song from the same album as “${esc(sm.of)}”` : sm.kind === 'artist' ? `Bonus song by ${esc(sm.ofArtist)}, like “${esc(sm.of)}”` : `Bonus: an artist similar to ${esc(sm.ofArtist)} (“${esc(sm.of)}”)`}${t.owners?.length ? ` · picked via ${esc(t.owners.join(' & '))}’s songs` : ''}</span></div>` : '';
  const cc = countryOf(t), fl = flag(cc);
  return `<div class="rv-track">${t.album.thumb || t.album.image ? `<img src="${esc(t.album.thumb || t.album.image)}" alt="">` : ''}<div class="m"><div class="t">${esc(t.name)}</div><div>${fl ? `<span title="Artist from ${esc(cc)}">${fl}</span> ` : ''}${esc(t.artists.map(a => a.name).join(', '))}</div><div class="mute"><small>${esc(meta)}</small></div>${owners}${blend}</div>
    <div class="rv-btns">${playBtn(t)}${opts.noLike ? '' : likeBtn(t)}${openLink(t)}</div></div>`;
}

/* ---------------- question UI ---------------- */
const COVER_STEPS = 8;
const PIXEL_BLOCKS = [5, 8, 12, 18, 26, 38, 60, 110, 0];
const nameKeys = new WeakMap();
function keyed(arr) { if (!nameKeys.has(arr)) nameKeys.set(arr, arr.map(n => [n, normAns(n)])); return nameKeys.get(arr); }

const QUI = {
  ctx: null,
  run(q, opt = {}) {
    if (this.ctx && !this.ctx.done) this.ctx.finish({ aborted: true, correct: false, points: 0, factor: 0 });
    return new Promise(resolve => {
      const ctx = { q, opt, sc: q.sc || scoringSnapshot(), done: false, t0: null, hint: false, timers: [], locked: false, stage: 0, revealStep: 0, manualStep: 0, lastTick: -1, startSec: undefined };
      this.ctx = ctx;
      ctx.elapsed = () => ctx.t0 == null ? 0 : (performance.now() - ctx.t0) / 1000;
      ctx.finish = res => {
        if (ctx.done) return; ctx.done = true; ctx.locked = true;
        if (!res.unplayable) opt.onShown?.(q);
        ctx.timers.forEach(clearTimeout); cancelAnimationFrame(ctx.raf); clearTimeout(ctx.acTimer);
        document.removeEventListener('keydown', ctx.onKey);
        res.elapsed = res.elapsed ?? ctx.elapsed(); res.hint = ctx.hint;
        res.extra = res.extra || {}; if (q.type === 'cover') res.extra.reveal = ctx.revealStep;
        $$('#qArea button').forEach(b => { if (!b.dataset.keep && !b.dataset.act) b.disabled = true; });
        const inp = $('#qInput'); if (inp) inp.disabled = true;
        const l = $('#acList'); if (l) l.innerHTML = '';
        ctx.result = res; resolve(res);
      };
      // opt.pause: seconds of "up next" before the clip and the timer start, so a new question never arrives unannounced
      const pause = Math.max(0, +opt.pause || 0) * 1000;
      ctx.waiting = pause > 0; ctx.locked = ctx.waiting;
      this.render(ctx);
      ctx.onKey = e => this.key(ctx, e);
      document.addEventListener('keydown', ctx.onKey);
      if (!pause) this.begin(ctx);
      else ctx.timers.push(setTimeout(() => {
        if (ctx.done) return;
        ctx.waiting = false; ctx.locked = false;
        $('#qReady')?.classList.add('gone');
        this.begin(ctx);
      }, pause));
    });
  },
  abort() { const c = this.ctx; if (c && !c.done) c.finish({ aborted: true, timeout: true, correct: false, points: 0, factor: 0 }); },

  render(ctx) {
    const q = ctx.q, T = TYPES[q.type], area = $('#qArea');
    const vinyl = !['cover', 'first', 'oddone'].includes(q.type);
    let stage = '';
    if (vinyl) stage = `<div class="vinyl-wrap"><div class="vinyl" id="vinyl"><div class="label"><span>${esc(ctx.opt.roundLabel ?? '')}</span></div></div>
      <svg class="ring" viewBox="0 0 100 100" aria-hidden="true"><circle class="bg" cx="50" cy="50" r="48"/><circle class="fg" id="ringFg" cx="50" cy="50" r="48" pathLength="100"/></svg></div>`;
    if (q.type === 'cover') stage = `<div class="cover-stage" id="coverStage"></div><div class="cover-step" id="coverStep"></div>`;
    const [lead, key] = taskText(q);
    let task = `<div class="task"><span class="task-ic" aria-hidden="true">${T.icon}</span><div><div class="task-t">${esc(lead)} ${key ? `<em>${esc(key)}</em>` : ''}</div><div class="task-s">${esc(T.name)}${ctx.opt.limit ? ` · ${ctx.opt.limit}s` : ''}</div></div></div>`;
    if (q.type === 'year' && q.info) task += `<div class="q-info">“${esc(q.track.name)}” by ${esc(q.track.artists[0]?.name)}</div>`;
    if (q.tf) task += `<div class="q-statement">${esc(q.statement)}</div>`;
    const G = GUESS[guessOf(q)];
    area.style.setProperty('--q', G.color);
    const ready = ctx.waiting ? `<div class="q-ready" id="qReady" aria-live="polite"><div class="q-ready-in"><span class="q-ready-ic" aria-hidden="true">${T.icon}</span>
      <div class="q-ready-l">${ctx.opt.roundLabel != null ? `Song ${esc(ctx.opt.roundLabel)} · ` : ''}up next</div><div class="q-ready-t">${esc(lead)} ${key ? `<em>${esc(key)}</em>` : ''}</div></div></div>` : '';
    area.innerHTML = `
      <div class="q-head"><span class="q-kind"><i class="q-dot"></i>${esc(G.label)}<span class="mute"> · ${esc(T.name)}</span></span><span class="q-pts num" id="qPts"></span></div>
      <div class="q-bar"><i id="qBar"></i></div>
      ${stage}${task}
      <div class="q-ans" id="qAns">${this.answersHTML(ctx)}</div>
      <div class="q-tools" id="qTools">${this.toolsHTML(ctx)}</div>${ready}`;
    area.onclick = e => this.click(ctx, e);
    if (q.format === 'text') this.bindAC(ctx);
    if (q.format === 'slider') {
      const inp = $('#yrIn'); inp.oninput = () => { $('#yrOut').textContent = inp.value; };
      inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); this.answer(ctx, +inp.value); } };
      setTimeout(() => inp.focus(), 60);
    }
    if (q.type === 'cover') this.setupCover(ctx);
    if (q.type === 'heardle') this.heardleUI(ctx);
  },
  answersHTML(ctx) {
    const q = ctx.q;
    if (q.type === 'heardle') return `<div class="hd-seg" id="hdSeg"></div>
      <div class="row" style="justify-content:center;margin-bottom:14px"><button class="btn primary" data-q="play" data-keep="1" id="hdPlay">Play</button><button class="btn" data-q="skip" id="hdSkip">Skip</button></div>
      ${q.format === 'text' ? this.textHTML(q) : this.choicesHTML(q, ctx)}
      <ol class="hd-tries" id="hdLog" aria-label="Your attempts">${q.stages.map((s, i) => `<li data-st="${i}" class="${i === 0 ? 'now' : ''}"><span class="sec num">${fmtSec(s)}</span><span class="g"></span></li>`).join('')}</ol>`;
    if (q.format === 'text') return this.textHTML(q);
    if (q.format === 'slider') {
      const mid = Math.round((q.min + q.max) / 2);
      return `<div class="yr"><output id="yrOut" class="num">${mid}</output><input type="range" id="yrIn" min="${q.min}" max="${q.max}" value="${mid}" step="1" aria-label="Release year">
        <div class="yr-scale num"><span id="yrMin">${q.min}</span><span id="yrMax">${q.max}</span></div><button class="btn primary big" data-q="year">Lock in year</button></div>`;
    }
    return this.choicesHTML(q, ctx);
  },
  choicesHTML(q, ctx) {
    if (q.cards) {
      const rows = q.type === 'oddone', list = q.pair || q.items || [];
      const preview = rows && ctx?.sc?.oddPreview;
      return `<div class="cards ${rows ? 'rows' : ''}">${q.cards.map((c, i) => `<div class="cardwrap"><button class="choice" data-i="${i}"><kbd>${i + 1}</kbd>${c.img ? `<img src="${esc(c.img)}" alt="">` : ''}<span>${esc(c.title)}${c.sub ? `<br><small>${esc(c.sub)}</small>` : ''}</span></button>${playBtn(list[i], preview ? 'card-p' : 'card-p hidden')}</div>`).join('')}</div>`;
    }
    return `<div class="choices ${q.tf ? 'tf' : ''}">${q.choices.map((c, i) => `<button class="choice" data-i="${i}">${q.tf ? '' : `<kbd>${i + 1}</kbd>`}<span>${esc(c)}</span></button>`).join('')}</div>`;
  },
  textHTML(q) {
    return `<div class="text-ans" id="textAns"><div class="hint hidden" id="hintTxt"></div><div class="ac"><input class="field" id="qInput" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Your answer"><div class="ac-list" id="acList"></div></div>
      <div class="ac-msg" id="acMsg"></div>
      <div class="row"><button class="btn primary" data-q="submit">Guess</button><button class="btn ghost" data-q="giveup">${q.type === 'heardle' ? 'Give up' : 'I don’t know'}</button></div></div>`;
  },
  toolsHTML(ctx) {
    const q = ctx.q, out = [];
    if ((ctx.sc.hints ?? S.hints) && q.type !== 'heardle' && !q.tf && !q.cards && (q.format === 'text' || q.format === 'slider' || (q.format === 'choice' && q.choices.length >= 3)))
      out.push(`<button class="btn sm ghost" data-q="hint">Use a hint (−25%)</button>`);
    if (q.audio && q.type !== 'heardle') out.push(`<button class="btn sm ghost" data-q="replay" data-keep="1">Replay clip</button>`);
    if (q.type === 'cover') out.push(`<button class="btn sm ghost" data-q="more">Reveal more</button>`);
    return out.join('');
  },
  /* suggestions: songs from your library first, then the whole Deezer catalog */
  bindAC(ctx) {
    const inp = $('#qInput'), list = $('#acList'); if (!inp) return;
    const kind = ctx.q.suggest, local = keyed((ctx.opt.names || {})[kind] || []);
    let sel = -1, items = [], seq = 0;
    const hi = () => $$('.ac-i', list).forEach((d, i) => d.classList.toggle('on', i === sel));
    const draw = () => { sel = -1; list.innerHTML = items.map((n, i) => `<div class="ac-i" data-ac="${i}">${esc(n)}</div>`).join(''); };
    const msg = $('#acMsg');
    inp.oninput = () => {
      if (msg) msg.textContent = '';
      if (!S.autocomplete) { list.innerHTML = ''; return; }
      const raw = inp.value.trim(), v = normAns(raw.replace(SEP_RE, ' '));
      if (v.length < 2) { list.innerHTML = ''; items = []; return; }
      const starts = [], has = [];
      for (const [n, k] of local) { const kk = k; if (kk.includes(v)) { (kk.startsWith(v) || kk.includes(' ' + v) ? starts : has).push(n); } if (starts.length >= 4) break; }
      items = [...starts, ...has].slice(0, 4); draw();
      const my = ++seq; clearTimeout(ctx.acTimer);
      ctx.acTimer = setTimeout(async () => {
        try {
          const type = kind === 'artist' ? 'artist' : kind === 'album' ? 'album' : 'track';
          const r = await Dz.search(raw.replace(SEP_RE, ' '), type, 8);
          if (my !== seq || ctx.done) return;
          const fromDz = r.map(x => type === 'artist' ? x.name : type === 'album' ? `${x.artist?.name} – ${x.title}` : `${x.artist?.name} – ${x.title_short || x.title}`);
          const seen = new Set(items.map(normAns));
          for (const n of fromDz) { const k = normAns(n); if (!seen.has(k)) { seen.add(k); items.push(n); } if (items.length >= 8) break; }
          draw();
        } catch {}
      }, 230);
    };
    inp.onkeydown = e => {
      if (e.key === 'ArrowDown' && items.length) { sel = (sel + 1) % items.length; hi(); e.preventDefault(); }
      else if (e.key === 'ArrowUp' && items.length) { sel = (sel - 1 + items.length) % items.length; hi(); e.preventDefault(); }
      else if (e.key === 'Enter') { e.preventDefault(); if (sel >= 0) inp.value = items[sel]; list.innerHTML = ''; items = []; seq++; this.submitText(ctx); }
      else if (e.key === 'Escape') { list.innerHTML = ''; items = []; seq++; }
    };
    inp.onblur = () => setTimeout(() => { list.innerHTML = ''; items = []; seq++; }, 150);
    list.onmousedown = e => { const d = e.target.closest('[data-ac]'); if (d) { e.preventDefault(); inp.value = items[+d.dataset.ac]; list.innerHTML = ''; items = []; seq++; inp.focus(); } };
    setTimeout(() => inp.focus(), 60);
  },

  async begin(ctx) {
    const q = ctx.q;
    let r = null;
    if (q.type === 'heardle') r = await this.playStage(ctx, true);
    else if (q.audio) {
      r = await Player.play(q.track, { frac: q.startFrac, len: q.clipLength || 0, need: Math.max(ctx.opt.limit || 15, q.clipLength || 0) });
      if (ctx.done) return;
      ctx.startSec = r.start;
      if (r.ok) $('#vinyl')?.classList.add('spin');
    }
    if (ctx.done) return;
    // the song wouldn't play: let the game swap in a different one instead of asking about silence
    if (r && r.unplayable && !r.superseded && ctx.opt.reroll) return ctx.finish({ aborted: true, unplayable: true, correct: false, points: 0, factor: 0 });
    if (r && !r.ok && !r.superseded) toast(r.blocked ? 'Your browser blocked audio. Tap “Replay clip” to start it.' : r.offline ? 'Can’t reach the Earworm server.' : 'Couldn’t play this clip. Answer anyway, or tap “Replay clip”.');
    this.startTimer(ctx);
  },
  startTimer(ctx) {
    if (ctx.done) return;
    ctx.t0 = performance.now();
    const limit = ctx.opt.limit || 0, bar = $('#qBar'), ring = $('#ringFg'), pts = $('#qPts');
    if (!limit && bar) bar.parentElement.style.visibility = 'hidden';
    const loop = () => {
      if (ctx.done) return;
      const el = ctx.elapsed();
      if (ctx.opt.globalEnd && performance.now() >= ctx.opt.globalEnd) { ctx.finish({ correct: false, points: 0, factor: 0, timeout: true, blitzOver: true }); return; }
      ctx.opt.onTick?.();
      if (limit) {
        const left = Math.max(0, limit - el), frac = left / limit;
        if (bar) { bar.style.transform = `scaleX(${frac})`; bar.classList.toggle('low', left <= 3); }
        if (ring) { ring.style.strokeDashoffset = String(100 - frac * 100); ring.classList.toggle('low', left <= 3); }
        const sec = Math.ceil(left);
        if (left <= 3 && sec !== ctx.lastTick && sec > 0) { ctx.lastTick = sec; SFX.tick(); }
        if (el >= limit) { ctx.finish({ correct: false, points: 0, factor: 0, timeout: true, given: null }); return; }
      }
      if (ctx.q.type === 'cover') {
        const auto = limit ? Math.floor(el / (limit * 0.82) * COVER_STEPS) : Math.floor(el / 3);
        const step = clamp(Math.max(auto, ctx.manualStep), 0, COVER_STEPS);
        if (step !== ctx.revealStep) { ctx.revealStep = step; this.drawCover(ctx); }
      }
      if (pts) pts.textContent = '+' + this.potential(ctx) + ' pts';
      ctx.raf = requestAnimationFrame(loop);
    };
    loop();
  },
  potential(ctx) {
    const q = ctx.q; let p;
    if (q.type === 'cover') p = Score.cover(ctx.revealStep / COVER_STEPS, ctx.sc); else if (q.type === 'heardle') p = Score.heardle(ctx.stage, ctx.sc, ctx.q.stages.length); else p = Score.speed(ctx.elapsed(), ctx.sc);
    return Math.round(p * (ctx.hint ? 0.75 : 1));
  },
  click(ctx, e) {
    const b = e.target.closest('[data-q],[data-i]'); if (!b || b.disabled || ctx.waiting) return;
    if (b.dataset.i != null) { if (ctx.q.type === 'heardle') return this.heardleGuess(ctx, +b.dataset.i); return this.answer(ctx, +b.dataset.i); }
    const a = b.dataset.q;
    if (a === 'submit') this.submitText(ctx);
    else if (a === 'giveup') ctx.q.type === 'heardle' ? this.heardleFail(ctx) : this.answer(ctx, '');
    else if (a === 'year') this.answer(ctx, +$('#yrIn').value);
    else if (a === 'hint') this.useHint(ctx, b);
    else if (a === 'replay') this.replay(ctx);
    else if (a === 'more') ctx.manualStep = Math.min(COVER_STEPS, ctx.revealStep + 1);
    else if (a === 'play') this.playStage(ctx);
    else if (a === 'skip') this.heardleNext(ctx, null);
  },
  key(ctx, e) {
    if (ctx.locked || e.metaKey || e.ctrlKey || e.altKey || e.target.matches('input, textarea, select')) return;
    const q = ctx.q;
    if (/^[1-9]$/.test(e.key) && q.format === 'choice') { const btn = $(`#qArea [data-i="${+e.key - 1}"]`); if (btn && !btn.disabled && !btn.classList.contains('gone')) { e.preventDefault(); btn.click(); } }
    else if (q.tf && (e.key === 't' || e.key === 'f')) { e.preventDefault(); this.answer(ctx, e.key === 't' ? 0 : 1); }
    else if (e.key === 'r') this.replay(ctx);
    else if (e.key === ' ' && q.type === 'heardle') { e.preventDefault(); this.playStage(ctx); }
  },
  async replay(ctx) {
    const q = ctx.q; if (!q.audio || ctx.waiting) return;
    const r = await Player.play(q.track, { start: ctx.startSec, frac: q.startFrac, len: q.clipLength || 0, need: ctx.opt.limit || 15 });
    if (r.ok) { ctx.startSec = r.start; $('#vinyl')?.classList.add('spin'); }
  },
  submitText(ctx) {
    const v = $('#qInput')?.value || ''; if (!v.trim()) return;
    if (ctx.q.type === 'heardle') return this.heardleGuess(ctx, v);
    this.answer(ctx, v);
  },
  useHint(ctx, btn) {
    if (ctx.hint || ctx.locked) return; ctx.hint = true; btn.disabled = true;
    const q = ctx.q;
    if (q.format === 'choice') { shuffle(q.choices.map((_, i) => i).filter(i => i !== q.answerIndex)).slice(0, Math.floor((q.choices.length - 1) / 2)).forEach(i => $(`#qArea [data-i="${i}"]`)?.classList.add('gone')); }
    else if (q.format === 'text') { const h = $('#hintTxt'); h.textContent = maskAnswer(q.answer); /* only the masked answer, never the artist */ h.classList.remove('hidden'); }
    else if (q.format === 'slider') { const lo = Math.max(q.min, q.year - rand(6)), hi = Math.min(q.max, lo + 6); const inp = $('#yrIn'); inp.min = lo; inp.max = hi; inp.value = Math.round((lo + hi) / 2); $('#yrOut').textContent = inp.value; $('#yrMin').textContent = lo; $('#yrMax').textContent = hi; }
  },
  /* returns {ok, needArtist} for typed answers */
  checkText(ctx, given) {
    const q = ctx.q, artists = (q.track?.artists || []).map(a => a.name);
    if (q.kind === 'title') {   // the romanized name and the original-script name both count
      const rs = (q.accept || [q.answer]).map(a => matchSong(given, a, [...artists, ...(q.track?.alt?.artists || [])], ctx.sc.requireArtist ?? S.requireArtist));
      return rs.find(r => r.ok) || rs.find(r => r.needArtist) || { ok: false };
    }
    if (q.kind === 'album') { const parts = String(given).split(SEP_RE); return { ok: isMatch(given, q.accept) || (parts.length >= 2 && parts.some((p, i) => isMatch(p, q.accept) && artistMatch(parts[1 - i] ?? '', artists))) || (parts.length >= 2 && isMatch(parts.slice(1).join(' '), q.accept)) }; }
    if (q.kind === 'artist') return { ok: artistMatch(given, q.accept) };
    return { ok: isMatch(given, q.accept) };
  },
  grade(ctx, given) {
    const q = ctx.q, el = ctx.elapsed(), sc = ctx.sc;
    let correct = false, factor = 0, shown = '', extra = {};
    if (q.format === 'choice') { correct = given === q.answerIndex; factor = correct ? 1 : 0; shown = q.choices[given] ?? ''; }
    else if (q.format === 'text') { correct = !!given && this.checkText(ctx, given).ok; factor = correct ? 1 : 0; shown = given || '—'; }
    else if (q.format === 'slider') { const d = Math.abs(given - q.year); factor = Score.yearFactor(d); correct = d <= 2; shown = String(given); extra.diff = d; }
    const base = q.type === 'cover' ? Score.cover(ctx.revealStep / COVER_STEPS, sc) : q.type === 'heardle' ? Score.heardle(ctx.stage, sc, q.stages.length) : Score.speed(el, sc);
    return { correct, factor, points: Math.round(base * factor * (ctx.hint ? 0.75 : 1)), given: shown, elapsed: el, extra };
  },
  needArtistMsg(ctx, given) {
    if (ctx.q.format !== 'text' || !given || ctx.q.kind !== 'title') return false;
    const r = this.checkText(ctx, given);
    if (r.needArtist) { const m = $('#acMsg'); if (m) m.textContent = 'Add the artist too, like “Artist – Song”. Pick a suggestion to fill it in.'; $('#qInput')?.focus(); return true; }
    return false;
  },
  answer(ctx, given) {
    if (ctx.locked) return;
    if (this.needArtistMsg(ctx, given)) return;
    ctx.locked = true;
    if (ctx.q.format === 'choice') $(`#qArea [data-i="${given}"]`)?.classList.add('picked');
    ctx.finish(this.grade(ctx, given));
  },
  markReveal(res) {
    const ctx = this.ctx; if (!ctx) return; const q = ctx.q;
    if (q.format === 'choice') {
      $(`#qArea [data-i="${q.answerIndex}"]`)?.classList.add('right');
      $$('#qArea .choice.picked').forEach(b => { if (+b.dataset.i !== q.answerIndex) b.classList.add('wrong'); });
    } else if (q.format === 'text') $('#textAns')?.classList.add(res?.correct ? 'right' : 'wrong');
    else if (q.format === 'slider') { const out = $('#yrOut'); if (out) out.innerHTML = `<span class="yr-true">${q.year}</span>`; }
    $$('#qArea .card-p').forEach(b => b.classList.remove('hidden'));
    if (q.type === 'oddone') q.items.forEach((t, i) => { const s = $(`#qArea [data-i="${i}"] span`); if (s && !s.querySelector('small')) s.insertAdjacentHTML('beforeend', `<br><small>${esc(t.artists[0]?.name)}</small>`); });
    if (q.type === 'first') q.pair.forEach((t, i) => { const s = $(`#qArea [data-i="${i}"] small`); if (s) s.textContent += ` · ${t.album.year}`; });
    $('#vinyl')?.classList.remove('spin');
    if (q.type === 'cover') { ctx.revealStep = COVER_STEPS; this.drawCover(ctx); }
  },

  /* cover reveal */
  setupCover(ctx) {
    const q = ctx.q, st = $('#coverStage');
    if (q.coverStyle === 'pixelate' || q.coverStyle === 'tiles') {
      st.innerHTML = '<canvas id="covCv" width="480" height="480"></canvas>';
      const img = new Image(); img.onload = () => { ctx.img = img; this.drawCover(ctx); }; img.src = q.track.album.image;
      ctx.order = shuffle([...Array(16).keys()]);
    } else { st.innerHTML = `<img id="covImg" alt="" src="${esc(q.track.album.image)}" style="transform-origin:${q.zoomOrigin}">`; this.drawCover(ctx); }
  },
  drawCover(ctx) {
    const q = ctx.q, step = ctx.revealStep, lv = step / COVER_STEPS;
    const lab = $('#coverStep'); if (lab) lab.textContent = step >= COVER_STEPS ? 'Fully revealed' : `Revealed ${step + 1} of ${COVER_STEPS + 1}`;
    if (q.coverStyle === 'blur' || q.coverStyle === 'zoom') {
      const im = $('#covImg'); if (!im) return;
      if (q.coverStyle === 'blur') { im.style.filter = `blur(${((1 - lv) * 26).toFixed(1)}px)`; im.style.transform = `scale(${1 + (1 - lv) * 0.12})`; }
      else im.style.transform = `scale(${(1 + (1 - lv) * 6).toFixed(2)})`;
      return;
    }
    const cv = $('#covCv'), img = ctx.img; if (!cv || !img) return;
    const c = cv.getContext('2d'); if (!c) return; const W = cv.width;
    if (q.coverStyle === 'pixelate') {
      const n = PIXEL_BLOCKS[step];
      if (!n) { c.imageSmoothingEnabled = true; c.drawImage(img, 0, 0, W, W); return; }
      const oc = document.createElement('canvas'); oc.width = oc.height = n; oc.getContext('2d').drawImage(img, 0, 0, n, n);
      c.imageSmoothingEnabled = false; c.clearRect(0, 0, W, W); c.drawImage(oc, 0, 0, n, n, 0, 0, W, W);
    } else {
      const shown = step >= COVER_STEPS ? 16 : 1 + Math.round(lv * 12);
      c.fillStyle = '#120b26'; c.fillRect(0, 0, W, W);
      const sw = img.naturalWidth / 4, sh = img.naturalHeight / 4, d = W / 4;
      for (let k = 0; k < shown; k++) { const i = ctx.order[k], x = i % 4, y = Math.floor(i / 4); c.drawImage(img, x * sw, y * sh, sw, sh, x * d, y * d, d, d); }
    }
  },

  /* heardle */
  heardleUI(ctx) {
    const q = ctx.q, s = q.stages, st = ctx.stage;
    $('#hdSeg').innerHTML = s.map((v, i) => `<i style="flex:${Math.max(0.35, v - (s[i - 1] || 0))}" class="${i <= st ? 'on' : ''}"></i>`).join('');
    $('#hdPlay').textContent = `Play ${fmtSec(s[st])}`;
    $('#hdSkip').textContent = st < s.length - 1 ? `Skip (+${fmtSec(s[st + 1] - s[st])})` : 'Skip';
    $$('#hdLog li').forEach(li => li.classList.toggle('now', +li.dataset.st === st && !ctx.done));
    const pts = $('#qPts'); if (pts) pts.textContent = '+' + this.potential(ctx) + ' pts';
  },
  async playStage(ctx, first = false) {
    const q = ctx.q;
    const r = await Player.play(q.track, { start: ctx.startSec, frac: q.startFrac, len: q.stages[ctx.stage], need: 17 });
    if (r.ok) { ctx.startSec = r.start; const v = $('#vinyl'); v?.classList.add('spin'); ctx.timers.push(setTimeout(() => v?.classList.remove('spin'), q.stages[ctx.stage] * 1000)); }
    else if (!first && !r.superseded && !ctx.done) toast(r.blocked ? 'Tap Play to start the audio.' : 'Couldn’t play this clip.');
    return r;
  },
  heardleGuess(ctx, given) {
    if (ctx.locked) return;
    const q = ctx.q;
    if (q.format === 'text' && this.needArtistMsg(ctx, given)) return;
    const res = this.grade(ctx, given);
    if (res.correct) {
      ctx.locked = true; if (q.format === 'choice') $(`#qArea [data-i="${given}"]`)?.classList.add('picked');
      this.heardleMark(ctx.stage, 'hit', '✓ ' + (q.format === 'choice' ? q.choices[given] : given));
      res.extra.stage = ctx.stage; res.extra.secs = q.stages[ctx.stage]; ctx.finish(res); return;
    }
    if (q.format === 'choice') { const b = $(`#qArea [data-i="${given}"]`); if (b) { b.classList.add('wrong'); b.disabled = true; } }
    this.heardleNext(ctx, q.format === 'choice' ? q.choices[given] : given);
  },
  heardleNext(ctx, wrongGuess) {
    if (ctx.locked) return;
    const q = ctx.q;
    this.heardleMark(ctx.stage, wrongGuess ? 'miss' : 'skip', wrongGuess ? '✗ ' + wrongGuess : 'Skipped');
    const inp = $('#qInput'); if (inp) { inp.value = ''; inp.focus(); }
    if (ctx.stage >= q.stages.length - 1) return this.heardleFail(ctx, wrongGuess);
    ctx.stage++; this.heardleUI(ctx); this.playStage(ctx);
  },
  heardleFail(ctx, last) { if (ctx.locked) return; ctx.locked = true; ctx.finish({ correct: false, factor: 0, points: 0, given: last || '—', extra: { stage: ctx.stage } }); },
  /* fill in one row of the attempts list */
  heardleMark(stage, cls, text) {
    const li = $(`#hdLog li[data-st="${stage}"]`); if (!li) return;
    li.className = cls; li.querySelector('.g').textContent = text;
  }
};

/* ---------------- answer reveal ---------------- */
function verdict(q, res) {
  if (!res || (res.aborted && !res.given)) return { cls: 'bad', text: 'No answer' };
  if (res.timeout) return { cls: 'bad', text: 'Time’s up' };
  if (res.correct) {
    let text = pick(['Correct', 'Nailed it', 'Yes!', 'Spot on']);
    if (q.type === 'year' && res.extra?.diff) text = `Off by ${res.extra.diff} — close enough`;
    if (q.type === 'heardle') text = `Got it in ${fmtSec(q.stages[res.extra?.stage ?? 0])}`;
    return { cls: 'good', text };
  }
  if (res.factor > 0) return { cls: 'part', text: `Off by ${res.extra?.diff} years` };
  if (q.type === 'year' && res.extra?.diff != null) return { cls: 'bad', text: `Off by ${res.extra.diff} years` };
  return { cls: 'bad', text: res.given && res.given !== '—' ? 'Not quite' : 'Skipped' };
}
function revealBody(q) {
  if (q.type === 'first') return `<p class="mute" style="margin:0 0 8px">The older song:</p>${q.pair.map(t => trackCard(t)).join('')}`;
  if (q.type === 'oddone') return `<p class="mute" style="margin:0 0 8px">Three are by <b style="color:var(--ink)">${esc(q.groupArtist)}</b>. The odd one out is first:</p>${[q.items[q.answerIndex], ...q.items.filter((_, i) => i !== q.answerIndex)].map(t => trackCard(t)).join('')}`;
  let body = '';
  if (q.type === 'genre' && q.genres?.length) body = `<p class="mute" style="margin:0 0 8px">Spotify tags this artist as ${esc(q.genres.join(', '))}.</p>`;
  else if (q.format === 'text' || q.type === 'heardle') body = `<p class="mute" style="margin:0 0 8px">Answer: <b style="color:var(--ink)">${esc(q.kind === 'title' ? songLabel(q.track) : q.answer)}</b></p>`;
  else if (q.type === 'truefalse') body = `<p class="mute" style="margin:0 0 8px">It was ${q.answerIndex === 0 ? 'true' : 'false'}.</p>`;
  return body + trackCard(q.track);
}
const Reveal = {
  timer: null, onNext: null,
  clear() { clearInterval(this.timer); this.onNext = null; document.removeEventListener('keydown', this.onKey); const b = $('#revealBox'); if (b) b.innerHTML = ''; },
  onKey: e => { if (e.key === 'Enter' && !e.target.matches('input,textarea,select,button') && Reveal.onNext) { e.preventDefault(); Reveal.go(); } },
  go() { const f = this.onNext; this.clear(); f && f(); },
  show({ q, res, pts, last, onNext, extraHTML = '', nextLabel, waiting, auto = S.autoAdvance }) {
    clearInterval(this.timer);
    const v = verdict(q, res);
    const ptsTxt = pts > 0 ? `+${pts}` : pts < 0 ? `${pts}` : '0';
    $('#revealBox').innerHTML = `<div class="reveal ${v.cls}"><div class="rv-verdict"><span>${esc(v.text)}</span><span class="num">${ptsTxt}</span></div>
      ${revealBody(q)}${extraHTML}
      <div class="rv-actions">${onNext ? `<button class="btn primary" data-next="1">${esc(nextLabel || (last ? 'See results' : 'Next song'))}</button><span class="mute" id="autoNext"></span>` : `<span class="mute">${esc(waiting || '')}</span>`}</div></div>`;
    this.onNext = onNext || null;
    document.removeEventListener('keydown', this.onKey);
    const nb = $('#revealBox [data-next]'); if (nb) nb.onclick = () => this.go();
    if (onNext) {
      document.addEventListener('keydown', this.onKey);
      if (auto > 0 && !last) {
        let n = auto; const lab = $('#autoNext'); lab.innerHTML = `Next in ${n}s <button class="linkbtn" id="holdNext">wait</button>`;
        $('#holdNext').onclick = () => { clearInterval(this.timer); lab.textContent = ''; };
        this.timer = setInterval(() => { n--; if (n <= 0) { clearInterval(this.timer); this.go(); } else { const s = lab.firstChild; if (s) s.textContent = `Next in ${n}s `; } }, 1000);
      }
      setTimeout(() => nb?.focus({ preventScroll: true }), 50);
    }
    setTimeout(() => $('#revealBox .reveal')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 60);
  }
};
function floatPts(pts) {
  const host = $('.hud-score'); if (!host || !pts) return;
  const f = document.createElement('span'); f.className = 'float' + (pts < 0 ? ' neg' : ''); f.textContent = (pts > 0 ? '+' : '') + pts;
  host.appendChild(f); setTimeout(() => f.remove(), 1200);
}
const streakTxt = n => n >= 3 ? `${n} in a row` + (S.streakBonus ? ` ×${Score.streak(n)}` : '') : '';

/* ---------------- "what's in this game" side panel ---------------- */
/* built once when a game starts (by the host in multiplayer, then sent to everyone) */
function buildInfo(modeKey, players = null) {
  const p = PRESETS[modeKey] || PRESETS.custom, groups = Engine.groups;
  const tot = groups.reduce((a, g) => a + g.tracks.length, 0) || 1;
  const sources = players
    ? players.filter(x => x.pct > 0).map(x => ({ label: x.name, pct: x.pct, player: true }))
    : groups.map(g => ({ label: Lib.sourceLabel(g.key), n: g.tracks.length, pct: Math.round((S.mixMode === 'size' ? g.tracks.length / tot : 1 / groups.length) * 1000) / 10 })).sort((a, b) => b.pct - a.pct);
  const f = S.filters, filters = [];
  if (f.yearMin || f.yearMax) filters.push(`${f.yearMin || '…'}–${f.yearMax || '…'}`);
  if (f.genres?.length) filters.push(f.genres.join(', '));
  if (f.artist) filters.push('only ' + f.artist);
  if (f.noExplicit) filters.push('no explicit songs');
  return {
    icon: p.icon, name: p.name, summary: settingsSummary(S), songs: Engine.pool.length, sources, byPlayer: !!players,
    similar: S.similar > 0 ? { share: S.similar, mix: { ...S.similarMix } } : null,
    types: Engine.types.map(k => TYPES[k].name), skipped: Engine.skipped.map(k => TYPES[k].name),
    filters, recent: S.avoidRecent ? S.recentGames : 0, audio: Player.mode() === 'sdk' ? 'Full songs (Spotify Premium)' : '30-second previews'
  };
}
function similarText(sm) {
  const m = sm.mix || {}, t = (m.album || 0) + (m.artist || 0) + (m.related || 0) || 1, p = k => Math.round((m[k] || 0) / t * 100);
  return [[p('album'), 'same album'], [p('artist'), 'same artist'], [p('related'), 'similar artists']].filter(x => x[0] > 0).map(x => `${x[0]}% ${x[1]}`).join(' · ');
}
/* live: {score, correct, answered, streak, last} — single player only; multiplayer has the scoreboard */
function infoHTML(info, live = null) {
  if (!info) return '';
  const pct = n => `${Math.round(+n || 0)}%`;
  return `<div class="gi">
    <div class="gi-mode"><span class="gi-ic">${esc(info.icon)}</span><div><b>${esc(info.name)}</b><small class="mute">${esc(info.summary)}</small></div></div>
    ${live ? `<div class="gi-live"><div><b class="num">${fmtN(live.correct)}/${fmtN(live.answered)}</b><span>right</span></div><div><b class="num">${fmtN(live.best)}</b><span>best streak</span></div></div>` : ''}
    ${live?.last ? `<div class="gi-last"><small class="mute">Last song came from</small><br>${esc(live.last)}</div>` : ''}
    <h4>In the mix <small class="mute">${fmtN(info.songs)} songs</small></h4>
    ${(info.sources || []).slice(0, 8).map(s => `<div class="gi-src"><span class="l">${s.player ? `<i style="background:${playerColor(s.label)}"></i>` : ''}${esc(s.label)}</span><span class="bar"><i style="width:${Math.min(100, +s.pct || 0)}%;${s.player ? `background:${playerColor(s.label)}` : ''}"></i></span><b class="num">${pct(s.pct)}</b></div>`).join('')}
    ${(info.sources || []).length > 8 ? `<small class="mute">+${info.sources.length - 8} more</small>` : ''}
    <h4>Similar songs</h4>
    <p>${info.similar ? `On for about ${pct(info.similar.share * 100)} of questions<br><small class="mute">${esc(similarText(info.similar))}</small>` : '<span class="mute">Off</span>'}</p>
    <h4>Questions</h4>
    <p>${esc(info.types.join(', '))}${info.skipped?.length ? `<br><small class="mute">Skipped (not enough song data): ${esc(info.skipped.join(', '))}</small>` : ''}</p>
    ${info.filters?.length ? `<h4>Filters</h4><p>${esc(info.filters.join(' · '))}</p>` : ''}
    <p class="mute" style="margin-top:10px"><small>${info.recent ? `Songs from your last ${info.recent} games are kept out while there are others. ` : ''}Audio: ${esc(info.audio)}.</small></p>
  </div>`;
}

/* ---------------- game modes ---------------- */
const PRESETS = {
  classic:  { name: 'Classic',       icon: '🎧', desc: 'Name the song or the artist, four options each', set: { rule: 'classic', rounds: 10, answerFormat: 'choice', types: { title: 1, artist: 1 } } },
  heardle:  { name: 'Heardle',       icon: '⏱️', desc: 'Start with one second of audio and earn more by skipping', set: { rule: 'classic', rounds: 8, answerFormat: 'text', types: { heardle: 1 } } },
  cover:    { name: 'Cover reveal',  icon: '🖼️', desc: 'Guess the album from artwork that sharpens over time', set: { rule: 'classic', rounds: 10, types: { cover: 1 } } },
  years:    { name: 'Time machine',  icon: '📅', desc: 'Release years and which-came-first', set: { rule: 'classic', rounds: 10, types: { year: 1, first: 1 } } },
  typeit:   { name: 'Type it',       icon: '⌨️', desc: 'No options — type the answer, with suggestions from the whole catalog', set: { rule: 'classic', rounds: 10, answerFormat: 'text', types: { title: 1, artist: 1, album: 1 } } },
  deep:     { name: 'Deep cuts',     icon: '🔍', desc: 'Wrong options come from the same album or artist', set: { rule: 'classic', rounds: 10, answerFormat: 'choice', difficulty: 'album', similar: 0.35, similarMix: { album: 60, artist: 40, related: 0 }, types: { title: 1, album: 1 } } },
  survival: { name: 'Survival',      icon: '❤️', desc: 'Three lives, keep going until you run out', set: { rule: 'survival', lives: 3, types: { title: 1, artist: 1, album: 1, truefalse: 1 } } },
  blitz:    { name: 'Blitz',         icon: '⚡', desc: 'Sixty seconds, as many as you can', set: { rule: 'blitz', blitzTime: 60, timeLimit: 8, types: { title: 1, artist: 1, truefalse: 1 } } },
  chaos:    { name: 'Chaos',         icon: '🌀', desc: 'Every question type, mixed answer formats', set: { rule: 'classic', rounds: 15, answerFormat: 'mixed', types: Object.fromEntries(Object.keys(TYPES).map(k => [k, 1])) } },
  custom:   { name: 'Custom game',   icon: '🎛️', desc: 'Your own rules: question types, game type, points and more', set: {} }
};
const MP_MODES = Object.keys(PRESETS).filter(k => k !== 'survival' && k !== 'blitz');   // multiplayer is always a set number of songs
const clone = o => JSON.parse(JSON.stringify(o));
const pickRules = o => clone(Object.fromEntries(RULE_KEYS.filter(k => k in o).map(k => [k, o[k]])));
/* each mode's rules = defaults, then the mode's own, then your changes to that mode (saved per mode) */
const Modes = {
  saved: null,
  load() {
    if (this.saved) return this.saved;
    this.saved = store.get('modes', null);
    if (!this.saved) {   // first run after the update: your old settings become your Custom game
      this.saved = {}; const old = store.get('settings', null);
      if (old && old.types) this.saved.custom = pickRules(old);
      store.set('modes', this.saved);
    }
    return this.saved;
  },
  defaults(key) {
    const r = pickRules(DEFAULTS), set = PRESETS[key]?.set || {};
    for (const [k, v] of Object.entries(set)) if (k !== 'types') r[k] = v;
    if (set.types) r.types = Object.fromEntries(Object.keys(TYPES).map(k => [k, !!set.types[k]]));
    return r;
  },
  rules(key) { return deepMerge(this.defaults(key), clone(this.load()[key] || {})); },
  save(key, rules) { this.load()[key] = pickRules(rules); store.set('modes', this.saved); },
  reset(key) { delete this.load()[key]; store.set('modes', this.saved); },
  changed(key) { return !!this.load()[key]; }
};
/* the full settings a game of this mode runs with */
function modeSettings(key) { return Object.assign(clone(S), Modes.rules(key)); }
function applyMode(key) { Object.assign(S, Modes.rules(key)); }
function settingsSummary(s = S) {
  const types = Object.keys(TYPES).filter(k => s.types[k]).map(k => TYPES[k].name);
  const fmt = { choice: 'multiple choice', text: 'type the answer', mixed: 'mixed answers' }[s.answerFormat];
  const len = s.rule === 'classic' ? `${s.rounds} songs` : s.rule === 'survival' ? `${s.lives} lives` : s.rule === 'blitz' ? `${s.blitzTime}s blitz` : 'endless';
  return `${len}, ${s.timeLimit}s each, ${fmt}. ${types.join(', ') || 'No question types selected'}.`;
}
