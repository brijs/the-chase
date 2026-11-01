import { scorecardHtml } from './scorecard.js';

/**
 * The cards between innings: the toss, and the AI's innings played out.
 *
 * Toss: their captain tosses, you call heads or tails (← / → and Enter, or
 * click). The coin spins. Win it and you choose to bat or bowl first (1 / 2);
 * lose it and the AI chooses, reading the conditions: cloud, a green top or a
 * crumbling pitch says bowl, a flat road in the sun says bat.
 *
 * The AI's innings (you only ever bat, so it is simulated): its overs tick
 * up one line at a time with the running score and who fell, then the total
 * and the full card (B). Space or Enter hurries it along.
 */
const CSS = `
#flow { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: min(560px, calc(100vw - 24px)); max-height: 90vh; overflow: auto; padding: 18px 22px; text-align: center; pointer-events: auto; display: none; z-index: 7; background: rgba(246,242,230,0.97); }
#flow.on { display: block; }
#flow h1 { margin: 0 0 4px; font-size: 22px; letter-spacing: 0.06em; color: #1c2847; }
#flow p { margin: 8px 0; }
#flow .small { font-size: 11.5px; color: #6f6a55; }
#flow .row { display: flex; gap: 8px; justify-content: center; margin: 12px 0 4px; flex-wrap: wrap; }
#flow button { font: inherit; color: inherit; background: #ebe4d0; border: 1px solid #c9bfa4; border-radius: 6px; padding: 8px 16px; cursor: pointer; }
#flow button.on { background: #283a63; border-color: #283a63; color: #f6f2e6; }
#flow button.go { background: #9a2731; border-color: #9a2731; color: #f6f2e6; font-weight: bold; }
#flow .coin { width: 92px; height: 92px; margin: 14px auto 6px; position: relative; transform-style: preserve-3d; }
#flow .coin i { position: absolute; inset: 0; border-radius: 50%; display: flex; align-items: center; justify-content: center; font: bold 34px/1 ui-monospace, Menlo, monospace; backface-visibility: hidden; border: 4px solid #a8873a; background: radial-gradient(circle at 35% 30%, #f6dd8a, #d6aa45 60%, #a8873a); color: #6b4f16; box-shadow: inset 0 0 0 3px rgba(255,255,255,0.25); }
#flow .coin i.t { transform: rotateY(180deg); }
#flow .coin.spin { animation: coinspin 1.5s cubic-bezier(.25,.6,.3,1) forwards; }
@keyframes coinspin { 0% { transform: translateY(0) rotateY(0); } 45% { transform: translateY(-70px) rotateY(var(--mid)); } 100% { transform: translateY(0) rotateY(var(--end)); } }
#flow .big { font-size: 30px; font-weight: bold; color: #9a2731; }
#flow .overs { text-align: left; font: 12px/1.5 ui-monospace, Menlo, monospace; margin: 10px 0; max-height: 46vh; overflow: auto; }
#flow .ov { display: grid; grid-template-columns: 3.2em 1fr 5.2em; gap: 6px; padding: 2px 4px; border-bottom: 1px solid #ebe4d0; }
#flow .ov.new { animation: ovin 0.25s ease-out; }
@keyframes ovin { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
#flow .ov .tot { text-align: right; font-weight: bold; color: #1c2847; }
#flow .ov .fall { grid-column: 2 / 4; color: #9a2731; font-size: 11px; }
#flow .ov b.w { color: #9a2731; } #flow .ov b.b4 { color: #3a83c6; } #flow .ov b.b6 { color: #283a63; background: #f3c94a; padding: 0 2px; }
#flow .card { text-align: left; background: #1d2c25; color: #f6f2e6; border-radius: 6px; padding: 10px 12px; font: 12px/1.4 ui-monospace, Menlo, monospace; margin-top: 8px; }
#flow .card h2 { margin: 0; font-size: 14px; color: #f3c94a; }
#flow .card .sub, #flow .card .fow, #flow .card td.how { color: #b0a68a; }
#flow .card .big { font-size: 20px; color: #f3c94a; }
#flow .card table { width: 100%; border-collapse: collapse; margin: 4px 0 8px; }
#flow .card th { text-align: right; color: #b0a68a; font-weight: normal; border-bottom: 1px solid #3b4340; padding: 2px 4px; }
#flow .card td { text-align: right; padding: 2px 4px; border-bottom: 1px solid #26392f; }
#flow .card th:first-child, #flow .card td:first-child, #flow .card .l { text-align: left; }
#flow .card .row { display: flex; justify-content: space-between; margin: 3px 0; }
`;

/** What the AI does with the toss, and why. c: resolved conditions. */
export function aiTossChoice(c, rnd) {
  if (c.swing >= 1.35 || c.seam >= 1.6) return { batFirst: false, why: 'the ball will move about early' };
  if (c.uneven >= 1.7) return { batFirst: true, why: 'the pitch will only get worse' };
  if (c.seam <= 0.7 && c.swing <= 0.8) return { batFirst: true, why: 'a flat one in the sun: runs on the board' };
  return rnd() < 0.55 ? { batFirst: false, why: 'they like to know what they are chasing' } : { batFirst: true, why: 'they want runs on the board' };
}

export function createFlow({ root, audio }) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const el = document.createElement('div');
  el.id = 'flow';
  el.className = 'panel';
  root.appendChild(el);
  let state = null; // the card's own state machine
  let timer = 0;
  const api = {
    get open() {
      return !!state;
    },
    get stage() {
      return state?.stage ?? null;
    },
  };
  const close = () => {
    clearTimeout(timer);
    state = null;
    el.classList.remove('on');
  };
  api.close = close;

  // ---------------------------------------------------------------- the toss
  /** yours, theirs: team names; conditions: resolved; onDone({ won, batFirst }). */
  api.toss = ({ yours, theirs, conditions, rnd = Math.random, onDone }) => {
    state = { stage: 'call', sel: 'heads', yours, theirs, conditions, rnd, onDone };
    el.classList.add('on');
    drawCall();
  };
  function drawCall() {
    const s = state;
    el.innerHTML = `<h1>THE TOSS</h1>
      <p class="small"><b>${s.yours}</b> (you) v <b>${s.theirs}</b></p>
      <p>${s.theirs.split(' ')[0]}'s captain tosses. Call it.</p>
      <div class="coin"><i class="h">H</i><i class="t">T</i></div>
      <div class="row"><button data-call="heads" class="${s.sel === 'heads' ? 'on' : ''}">← Heads</button><button data-call="tails" class="${s.sel === 'tails' ? 'on' : ''}">Tails →</button></div>
      <div class="row"><button class="go" data-act="call">Call ${s.sel} (Enter)</button></div>`;
    el.querySelectorAll('[data-call]').forEach((b) => (b.onclick = () => ((state.sel = b.dataset.call), drawCall())));
    el.querySelector('[data-act=call]').onclick = () => flip();
  }
  function flip() {
    const s = state;
    s.stage = 'flip';
    s.face = s.rnd() < 0.5 ? 'heads' : 'tails';
    s.won = s.face === s.sel;
    const coin = el.querySelector('.coin');
    const turns = 6 + Math.floor(s.rnd() * 3);
    const end = turns * 360 + (s.face === 'tails' ? 180 : 0);
    coin.style.setProperty('--mid', `${end * 0.55}deg`);
    coin.style.setProperty('--end', `${end}deg`);
    coin.classList.add('spin');
    el.querySelector('[data-act=call]').textContent = `You called ${s.sel}…`;
    el.querySelectorAll('button').forEach((b) => (b.disabled = true));
    audio.play('coin');
    audio.play('coinLand', {}, 1.45);
    timer = setTimeout(result, 1700);
  }
  function result() {
    const s = state;
    s.stage = s.won ? 'choose' : 'aiChose';
    const Face = s.face[0].toUpperCase() + s.face.slice(1);
    const coin = `<div class="coin" style="transform: rotateY(${s.face === 'tails' ? 180 : 0}deg)"><i class="h">H</i><i class="t">T</i></div>`;
    if (s.won) {
      s.pick = 'bat';
      audio.play('applause', { size: 0.3 });
      const draw = () => {
        el.innerHTML = `<h1>${Face}! You won the toss</h1>${coin}
          <p>Bat first and set a total, or bowl first and chase?</p>
          <div class="row"><button data-pick="bat" class="${s.pick === 'bat' ? 'on' : ''}">1 · Bat first</button><button data-pick="bowl" class="${s.pick === 'bowl' ? 'on' : ''}">2 · Bowl first (chase)</button></div>
          <div class="row"><button class="go" data-act="go">${s.pick === 'bat' ? 'Bat first' : 'Bowl first'} (Enter)</button></div>
          <p class="small">You only ever bat: if you bowl first, their innings is played out for you.</p>`;
        el.querySelectorAll('[data-pick]').forEach((b) => (b.onclick = () => ((s.pick = b.dataset.pick), draw())));
        el.querySelector('[data-act=go]').onclick = () => done(s.pick === 'bat');
      };
      s.draw = draw;
      draw();
    } else {
      const c = aiTossChoice(s.conditions, s.rnd);
      s.ai = c;
      el.innerHTML = `<h1>${Face}. ${s.theirs.split(' ')[0]} won the toss</h1>${coin}
        <p>They chose to <b>${c.batFirst ? 'bat' : 'bowl'}</b> first: ${c.why}.</p>
        <p>${c.batFirst ? `You'll chase whatever they make.` : 'You bat first: set them a total.'}</p>
        <div class="row"><button class="go" data-act="go">Continue (Enter)</button></div>`;
      el.querySelector('[data-act=go]').onclick = () => done(!c.batFirst);
    }
  }
  function done(batFirst) {
    const { onDone, won } = state;
    close();
    onDone({ won, batFirst });
  }

  // ---------------------------------------------------------------- the AI's innings
  /**
   * sim: { m, overs } from simulateInnings; book: its scorebook; title; other:
   * your innings in one line (when you batted first); resultText: the match
   * result (when this innings ends it); doneLabel; onDone.
   */
  api.innings = ({ sim, book, title, intro, other = null, resultText = null, doneLabel = 'Continue', onDone }) => {
    state = { stage: 'innings', sim, book, title, intro, other, resultText, doneLabel, onDone, shown: 0, card: false };
    el.classList.add('on');
    drawInnings();
    const per = sim.overs.length > 12 ? 0.2 : sim.overs.length > 6 ? 0.32 : 0.5;
    const tick = () => {
      if (!state || state.stage !== 'innings') return;
      state.shown++;
      const ov = sim.overs[state.shown - 1];
      if (ov?.falls.length) audio.play('ooh', { size: 0.3 });
      else if (ov && ov.marks.some((x) => x === '4' || x === '6')) audio.play('applause', { size: 0.15 });
      else audio.play('tick');
      drawInnings();
      if (state.shown < sim.overs.length) timer = setTimeout(tick, per * 1000);
      else finishInnings();
    };
    timer = setTimeout(tick, 600);
  };
  function finishInnings() {
    const s = state;
    s.stage = 'inningsDone';
    s.shown = s.sim.overs.length;
    // The crowd is yours: a cheer if their chase fell short, polite applause otherwise.
    const youWon = s.resultText?.startsWith(s.book.teams.bowl.name);
    audio.play(youWon ? 'cheer' : 'applause', { size: youWon ? 0.9 : 0.4 });
    drawInnings();
  }
  const mark = (x) => (x === 'W' ? '<b class="w">W</b>' : x === '4' ? '<b class="b4">4</b>' : x === '6' ? '<b class="b6">6</b>' : x === '0' ? '•' : x);
  function drawInnings() {
    const s = state;
    const { m, overs } = s.sim;
    const last = overs[s.shown - 1];
    const done = s.stage === 'inningsDone';
    const total = done ? `${m.runs}/${m.wkts}` : last ? `${last.total}/${last.wkts}` : '0/0';
    const lines = overs.slice(0, s.shown).map((o, i) => `<div class="ov ${i === s.shown - 1 && !done ? 'new' : ''}"><span>Ov ${o.n}</span><span>${o.marks.map(mark).join(' ')}</span><span class="tot">${o.total}/${o.wkts}</span>${o.falls.map((f) => `<span class="fall">✕ ${f}</span>`).join('')}${(o.notes ?? []).map((f) => `<span class="fall" style="color:#2f8f86">↺ ${f}</span>`).join('')}</div>`).join('');
    el.innerHTML = `<h1>${s.title}</h1>
      ${s.intro ? `<p class="small">${s.intro}</p>` : ''}
      <div class="big">${s.book.teams.bat.name.split(' ').pop().toUpperCase()} ${total}</div>
      ${s.card && done ? `<div class="card">${scorecardHtml({ m, bk: s.book, reason: 'innings', other: s.other })}</div>` : `<div class="overs">${lines || '<span class="small">first ball…</span>'}</div>`}
      ${done ? `${s.resultText ? `<p class="big" style="font-size:20px;color:#1c2847">${s.resultText}</p>` : `<p>${m.target == null ? `You need <b>${m.runs + 1}</b> to win off ${m.overs} overs.` : ''}</p>`}
        <div class="row"><button data-act="card">${s.card ? 'Overs' : 'Scorecard'} (B)</button><button class="go" data-act="go">${s.doneLabel} (Enter)</button></div>` : `<div class="row"><button data-act="skip">Skip to the end (Space)</button></div>`}`;
    el.querySelector('[data-act=skip]')?.addEventListener('click', hurry);
    el.querySelector('[data-act=card]')?.addEventListener('click', () => ((s.card = !s.card), drawInnings()));
    el.querySelector('[data-act=go]')?.addEventListener('click', inningsDone);
    const box = el.querySelector('.overs');
    if (box) box.scrollTop = box.scrollHeight;
  }
  function hurry() {
    clearTimeout(timer);
    finishInnings();
  }
  function inningsDone() {
    const { onDone } = state;
    close();
    onDone?.();
  }

  // ---------------------------------------------------------------- a notice
  /** A card with a title, a few lines and one button (Enter). */
  api.announce = ({ title, lines = [], button = 'Continue', onDone }) => {
    state = { stage: 'announce', onDone };
    el.classList.add('on');
    el.innerHTML = `<h1>${title}</h1>${lines.map((l) => `<p>${l}</p>`).join('')}<div class="row"><button class="go" data-act="go">${button} (Enter)</button></div>`;
    el.querySelector('[data-act=go]').onclick = () => announced();
    audio.play('drsSting');
  };
  function announced() {
    const { onDone } = state;
    close();
    onDone?.();
  }

  // ---------------------------------------------------------------- keys
  /** Keys while a card is up; returns true when handled. */
  api.key = (k) => {
    const s = state;
    if (!s) return false;
    if (s.stage === 'call') {
      if (k === '1') s.sel = 'heads';
      else if (k === '2') s.sel = 'tails';
      else if (k === 'enter') return flip(), true;
      drawCall();
    } else if (s.stage === 'choose') {
      if (k === '1') s.pick = 'bat';
      else if (k === '2') s.pick = 'bowl';
      else if (k === 'enter') return done(s.pick === 'bat'), true;
      s.draw();
    } else if (s.stage === 'aiChose' && k === 'enter') done(!s.ai.batFirst);
    else if (s.stage === 'announce' && k === 'enter') announced();
    else if (s.stage === 'innings' && (k === 'skip' || k === 'enter')) hurry();
    else if (s.stage === 'inningsDone') {
      if (k === 'enter') inningsDone();
      else if (k === 'scorecard') (s.card = !s.card), drawInnings();
    }
    return true;
  };
  /** The arrows (or the pad's direction): left / right pick on the toss cards. */
  api.dir = (d) => {
    const s = state;
    if (!s) return false;
    if (s.stage === 'call' && /[LR]/.test(d)) (s.sel = d.includes('L') ? 'heads' : 'tails'), drawCall();
    if (s.stage === 'choose' && /[LR]/.test(d)) (s.pick = d.includes('L') ? 'bat' : 'bowl'), s.draw();
    return true;
  };
  return api;
}
