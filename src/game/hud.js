import { GAME, DIFFICULTY } from './rules.js';
import { SHOTS } from './batting.js';

/**
 * The Chase HUD: a DOM layer over the canvas (never through the pixel pass).
 * Scoreline and this over, the call (FOUR, OUT ...), the delivery report and
 * your timing, the AI's over plan, a timing meter (Easy, or G), the controls
 * legend (H), and the intro / pause / result cards. Messages are keyed to game
 * time, so they line up with the play at any speed.
 */
const CSS = `
#hud { position: fixed; inset: 0; pointer-events: none; font: 13px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace; color: #2a211c; z-index: 5; }
#hud .panel { background: rgba(246, 242, 230, 0.94); border: 1px solid #c9bfa4; border-radius: 8px; box-shadow: 0 2px 10px rgba(23, 26, 24, 0.12); }
#hud-top { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); display: flex; gap: 14px; align-items: center; padding: 7px 12px; white-space: nowrap; max-width: calc(100vw - 24px); flex-wrap: wrap; justify-content: center; }
#hud-top b { font-size: 16px; color: #1c2847; }
#hud-top .need { color: #9a2731; font-weight: bold; }
#hud-top .dim { color: #6f6a55; }
#hud-over { display: flex; gap: 4px; }
#hud-over span { min-width: 20px; height: 20px; padding: 0 3px; border-radius: 10px; background: #ebe4d0; border: 1px solid #c9bfa4; display: grid; place-items: center; font-size: 11px; }
#hud-over span.b4 { background: #3a83c6; color: #f6f2e6; border-color: #3a83c6; }
#hud-over span.b6 { background: #283a63; color: #f3c94a; border-color: #283a63; }
#hud-over span.w { background: #9a2731; color: #f6f2e6; border-color: #9a2731; }
#hud-call { position: absolute; top: 19%; left: 50%; transform: translate(-50%, -50%) scale(0.9); font: bold 44px/1 ui-monospace, Menlo, monospace; letter-spacing: 0.06em; color: #1c2847; text-shadow: 0 2px 0 #f6f2e6, 0 0 18px rgba(246,242,230,0.9); opacity: 0; transition: opacity 0.25s, transform 0.25s; text-align: center; white-space: nowrap; }
#hud-call.on { opacity: 1; transform: translate(-50%, -50%) scale(1); }
#hud-call.out { color: #9a2731; }
#hud-call.six { color: #283a63; }
#hud-call small { display: block; font-size: 15px; letter-spacing: 0.02em; margin-top: 8px; color: #2a211c; }
#hud-info { position: absolute; top: 58px; left: 50%; transform: translateX(-50%); padding: 6px 12px; text-align: center; opacity: 0; transition: opacity 0.3s; max-width: calc(100vw - 24px); }
#hud-info.on { opacity: 1; }
#hud-info .shot { color: #1c2847; font-weight: bold; }
#hud-info .perfect { color: #2f8f86; } #hud-info .early, #hud-info .late { color: #e39a2e; } #hud-info .very { color: #9a2731; }
#hud-next { position: absolute; top: 58px; left: 50%; transform: translateX(-50%) scale(0.96); padding: 6px 14px 8px; text-align: center; opacity: 0; transition: opacity 0.15s, transform 0.15s; white-space: nowrap; }
#hud-next.on { opacity: 1; transform: translateX(-50%) scale(1); }
#hud-next .k { color: #6f6a55; font-size: 11px; letter-spacing: 0.06em; }
#hud-next .type { color: #9a2731; font-weight: bold; font-size: 15px; }
#hud-next .bar { height: 3px; background: #f3c94a; margin-top: 5px; border-radius: 2px; transform-origin: left; }
#hud-plan { position: absolute; left: 12px; top: 12px; padding: 7px 10px; max-width: 260px; opacity: 0; transition: opacity 0.5s; }
#hud-plan.on { opacity: 1; }
#hud-plan .k { color: #6f6a55; font-size: 11px; }
#hud-meter { position: absolute; left: 50%; bottom: 22px; transform: translateX(-50%); width: min(360px, 80vw); height: 16px; padding: 3px; display: none; }
#hud-meter.on { display: block; }
#hud-meter .track { position: relative; height: 100%; background: #ebe4d0; border-radius: 4px; overflow: hidden; }
#hud-meter .zone { position: absolute; top: 0; bottom: 0; background: #9cc472; }
#hud-meter .zone.perfect { background: #2f8f86; }
#hud-meter .dot { position: absolute; top: 1px; bottom: 1px; width: 6px; margin-left: -3px; background: #c13a3c; border-radius: 3px; }
#hud-meter .press { position: absolute; top: 0; bottom: 0; width: 2px; background: #1c2847; display: none; }
#hud-help { position: absolute; right: 12px; bottom: 12px; padding: 8px 10px; font-size: 11.5px; pointer-events: auto; }
#hud-help table { border-collapse: collapse; }
#hud-help td { padding: 1px 6px; text-align: center; }
#hud-help td.k { color: #9a2731; font-weight: bold; }
#hud-help .rows { margin-top: 5px; color: #4a4f3c; }
#hud-help.min table, #hud-help.min .rows { display: none; }
#hud-help .tab { display: none; }
#hud-help.min .tab { display: block; cursor: pointer; }
#hud-card { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); padding: 20px 24px; width: min(520px, calc(100vw - 32px)); text-align: center; pointer-events: auto; display: none; }
#hud-card.on { display: block; }
#hud-card h1 { margin: 0 0 4px; font-size: 26px; letter-spacing: 0.04em; color: #1c2847; }
#hud-card p { margin: 8px 0; }
#hud-card .big { font-size: 34px; font-weight: bold; color: #9a2731; }
#hud-card .row { display: flex; gap: 8px; justify-content: center; margin: 12px 0; flex-wrap: wrap; }
#hud-card button { font: inherit; color: inherit; background: #ebe4d0; border: 1px solid #c9bfa4; border-radius: 6px; padding: 7px 12px; cursor: pointer; }
#hud-card button.on { background: #283a63; border-color: #283a63; color: #f6f2e6; }
#hud-card button.go { background: #9a2731; border-color: #9a2731; color: #f6f2e6; font-weight: bold; }
#hud-card .keys { display: inline-grid; grid-template-columns: repeat(3, auto); gap: 3px 10px; text-align: center; font-size: 12px; margin: 6px 0; }
#hud-card .keys b { color: #9a2731; }
#hud-card .small { font-size: 11.5px; color: #6f6a55; }
#hud-card a { color: #283a63; }
#hud-pad { position: absolute; left: 12px; bottom: 12px; display: none; pointer-events: auto; gap: 6px; }
#hud-pad.on { display: flex; align-items: flex-end; }
#hud-pad .grid { display: grid; grid-template-columns: repeat(3, 52px); gap: 4px; }
#hud-pad button { font: 11px/1.1 ui-monospace, Menlo, monospace; height: 44px; border-radius: 8px; border: 1px solid #c9bfa4; background: rgba(246,242,230,0.94); color: #2a211c; touch-action: manipulation; }
#hud-pad button.loft.on { background: #283a63; color: #f6f2e6; }
@media (max-width: 620px) { #hud-call { font-size: 30px; } #hud-help { display: none; } #hud-plan { display: none; } #hud-top { font-size: 11px; gap: 8px; } }
`;

const GRID = [
  ['UL', '↑←', 'Guide (3rd man)'], ['U', '↑', 'Punch'], ['UR', '↑→', 'Glance'],
  ['L', '←', 'Cut'], ['', 'D', 'Defend'], ['R', '→', 'Pull / flick'],
  ['DL', '↓←', 'Cover'], ['D', '↓', 'Straight'], ['DR', '↓→', 'On drive'],
];

export function createHud({ hidden = false, onPick, onStart, onPad, onNets, onTune, onController } = {}) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const root = document.createElement('div');
  root.id = 'hud';
  if (hidden) root.style.display = 'none';
  root.innerHTML = `
    <div id="hud-top" class="panel" style="display:none"></div>
    <div id="hud-call"></div>
    <div id="hud-info" class="panel"></div>
    <div id="hud-plan" class="panel"></div>
    <div id="hud-next" class="panel"></div>
    <div id="hud-meter" class="panel"><div class="track"><div class="zone"></div><div class="zone perfect"></div><div class="press"></div><div class="dot"></div></div></div>
    <div id="hud-help" class="panel">
      <table>${[0, 1, 2].map((r) => `<tr>${GRID.slice(r * 3, r * 3 + 3).map(([, k, n]) => `<td><span class="k">${k}</span> ${n}</td>`).join('')}</tr>`).join('')}</table>
      <div class="tab">Controls (H)</div>
      <div class="rows">hold arrows · <b>D</b> ground · <b>A</b> lofted · no key = leave<br><b>S</b> sweep · <b>S</b>+← reverse sweep · <b>S</b>+↑ scoop (tighter timing)<br>Space skip · R replay · B scorecard · C camera · G timing meter · M sound · T tuning · K controller · P pause · H hide</div>
    </div>
    <div id="hud-pad"><div class="grid">${GRID.map(([d, , n]) => `<button data-dir="${d}">${n}</button>`).join('')}${[['', 'Sweep'], ['L', 'Reverse'], ['U', 'Scoop']].map(([d, n]) => `<button data-dir="${d}" data-special="1">${n}</button>`).join('')}</div><button class="loft">LOFT</button></div>
    <div id="hud-card" class="panel"></div>`;
  document.body.appendChild(root);
  const $ = (id) => root.querySelector(id);
  const top = $('#hud-top');
  const call = $('#hud-call');
  const info = $('#hud-info');
  const planEl = $('#hud-plan');
  const next = $('#hud-next');
  let nextPv = null;
  const meter = $('#hud-meter');
  const help = $('#hud-help');
  const card = $('#hud-card');
  const pad = $('#hud-pad');
  const queue = [];
  const later = (t, fn) => queue.push({ t, fn });
  let guide = false;
  let meterBall = null;
  let lastT = 0;

  // Touch pad for phones and tablets.
  if (window.matchMedia?.('(pointer: coarse)').matches) pad.classList.add('on');
  const loftBtn = pad.querySelector('.loft');
  loftBtn.addEventListener('click', () => loftBtn.classList.toggle('on'));
  pad.querySelectorAll('[data-dir]').forEach((b) =>
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      onPad?.(b.dataset.dir, loftBtn.classList.contains('on'), e.timeStamp, !!b.dataset.special);
    })
  );
  help.addEventListener('click', () => help.classList.toggle('min'));

  function flash(text, cls, sub, t, dur = 1.8) {
    later(t, () => {
      call.className = `on ${cls}`;
      call.innerHTML = `${text}${sub ? `<small>${sub}</small>` : ''}`;
    });
    later(t + dur, () => (call.className = ''));
  }

  const hud = {
    get guide() { return guide; },
    set guide(v) { guide = v; if (!v) meter.classList.remove('on'); },
    update(t, ctl) {
      lastT = t;
      if (nextPv && t >= nextPv.t0 && t < nextPv.t1) {
        const bar = next.querySelector('.bar');
        if (bar) bar.style.transform = `scaleX(${Math.max(0, 1 - (t - nextPv.t0) / (nextPv.t1 - nextPv.t0)).toFixed(3)})`;
      }
      queue.sort((a, b) => a.t - b.t);
      while (queue.length && queue[0].t <= t) queue.shift().fn();
      // Timing meter: the ball's progress from release to the bat.
      if (guide && meterBall && t < meterBall.tR + meterBall.tC + 0.6) {
        meter.classList.add('on');
        const span = meterBall.tC + 0.2;
        const pc = (x) => `${Math.max(0, Math.min(100, (x / span) * 100))}%`;
        const ideal = meterBall.tC - 0.12;
        const z = meter.querySelectorAll('.zone');
        z[0].style.left = pc(ideal - meterBall.w.sigma);
        z[0].style.width = `calc(${pc(2 * meterBall.w.sigma)})`;
        z[1].style.left = pc(ideal - meterBall.w.perfect);
        z[1].style.width = `calc(${pc(2 * meterBall.w.perfect)})`;
        meter.querySelector('.dot').style.left = pc(t - meterBall.tR);
        const pr = meter.querySelector('.press');
        const inp = ctl?.cur?.input;
        pr.style.display = inp ? 'block' : 'none';
        if (inp) pr.style.left = pc(inp.pressT);
      } else meter.classList.remove('on');
    },
    ball({ spec, tR, del, diff }) {
      meterBall = { tR, tC: del.contactTime('front'), w: diff.window };
    },
    /** The read before the ball: type, aimed length and line, while the marker shows. */
    preview(pv) {
      const LEN = { yorker: 'yorker', full: 'full', good: 'good length', short: 'short', bouncer: 'bouncer' };
      const LINE = { wide: 'wide outside off', off: 'off stump', stumps: 'at the stumps', pads: 'at the pads' };
      later(pv.t0, () => {
        nextPv = pv;
        info.classList.remove('on');
        next.innerHTML = `<div class="k">THE READ · WATCH THE MARKER</div><span class="type">${pv.typeName.toUpperCase()}</span> · ${LEN[pv.length]} · ${LINE[pv.line]}<div class="bar"></div>`;
        next.classList.add('on');
      });
      later(pv.t1, () => next.classList.remove('on'));
    },
    result({ o, t, describe }) {
      const sh = o.shot;
      let line2 = 'No shot';
      if (sh) {
        const tl = sh.timing.toLowerCase().replace(' ', '-');
        const cls = sh.timing === 'PERFECT' ? 'perfect' : sh.timing.startsWith('VERY') ? 'very' : tl;
        const ms = Math.round(sh.err * 1000);
        line2 = `<span class="shot">${sh.shot}${sh.lofted ? ' (lofted)' : ''}</span> · <span class="${cls}">${sh.timing} ${ms > 0 ? '+' : ''}${ms} ms</span> · ${sh.call}`;
      } else if (o.kind === 'leave') line2 = o.out ? 'Left it' : o.pad ? 'Padded up' : 'Left alone';
      later(t, () => {
        info.innerHTML = `${describe}<br>${line2} · <b>R</b> replay`;
        info.classList.add('on');
      });
      if (o.out) {
        const how = o.out === 'caught' ? (o.fielding.by === 'keeper' ? 'Caught behind' : `Caught at ${o.fielding.name.replace('the ', '')}`) : o.kind === 'playedOn' ? 'Played on' : o.out === 'lbw' ? 'LBW' : 'Bowled';
        flash('OUT', 'out', how, t + 0.2, 2.2);
      } else if (o.runs === 6) flash('SIX', 'six', null, t + 0.5);
      else if (o.runs === 4) flash('FOUR', '', null, t + 0.6);
      else if (o.wide) flash('WIDE', '', '+1', t + 0.2, 1.2);
      else if (o.fielding?.type === 'drop') flash('DROPPED', '', o.fielding.name, t + 0.1, 1.4);
    },
    score(m, t = lastT) {
      later(t, () => {
        top.style.display = 'flex';
        if (m.nets) {
          const outs = m.log.filter((l) => l.out).length;
          top.innerHTML = `<b>NETS</b> <span class="dim">calibration</span> <span>${m.log.length} balls · ${m.runs} runs · ${outs} out</span><span id="hud-over">${m.thisOver.map((c) => `<span class="${c === 'W' ? 'w' : c === '4' ? 'b4' : c === '6' ? 'b6' : ''}">${c === '0' ? '•' : c}</span>`).join('')}</span>`;
          return;
        }
        const need = m.need();
        const bl = m.ballsLeft();
        const rrr = bl > 0 ? ((need / bl) * 6).toFixed(1) : '-';
        const chips = m.thisOver.map((c) => `<span class="${c === 'W' ? 'w' : c === '4' ? 'b4' : c === '6' ? 'b6' : ''}">${c === '0' ? '•' : c}</span>`).join('');
        top.innerHTML = `<span class="dim">TARGET</span> <b>${m.target}</b>
          <span><b>${m.runs}/${m.wkts}</b> <span class="dim">(${m.overText()} of ${GAME.overs})</span></span>
          ${m.result ? '' : `<span class="need">Need ${Math.max(0, need)} off ${bl}</span><span class="dim">RRR ${rrr}</span>`}
          <span id="hud-over">${chips}</span>`;
      });
    },
    over(m, plan, t = lastT) {
      const n = Math.floor(m.balls / 6) + 1;
      later(t, () => {
        planEl.innerHTML = `<div class="k">OVER ${n} OF ${GAME.overs} · THE BOWLER'S PLAN</div>${plan.name}<div class="k" style="margin-top:4px">FIELD · ${plan.field.toUpperCase()}</div>`;
        planEl.classList.add('on');
        hud.score(m, t);
      });
      later(t + 6, () => planEl.classList.remove('on'));
    },
    final(m, t = lastT) {
      later(t, () => {
        const ballsLeft = m.ballsLeft();
        let head, big;
        if (m.result === 'won') {
          head = 'Chase won';
          big = `by ${GAME.wickets - m.wkts} wicket${GAME.wickets - m.wkts === 1 ? '' : 's'}`;
        } else if (m.result === 'tied') {
          head = 'Tied';
          big = 'scores level';
        } else {
          const by = m.target - 1 - m.runs;
          head = 'Chase lost';
          big = `by ${by} run${by === 1 ? '' : 's'}`;
        }
        card.innerHTML = `<h1>${head}</h1><div class="big">${big}</div>
          <p>${m.runs}/${m.wkts} in ${m.overText()} overs, chasing ${m.target}${m.result === 'won' && ballsLeft ? ` · ${ballsLeft} ball${ballsLeft === 1 ? '' : 's'} to spare` : ''}</p>
          <p class="small">Fours ${m.fours} · Sixes ${m.sixes} · Extras ${m.extras} · ${DIFFICULTY[m.difficulty].label}</p>
          <div class="row"><button class="go" data-act="again">Play again (Enter)</button></div>
          <p class="small"><a href="?">Watch the diorama</a></p>`;
        card.classList.add('on');
        card.querySelector('[data-act=again]').onclick = () => onStart?.();
        call.className = '';
      });
    },
    intro({ target, difficulty, teams }) {
      const diffs = Object.entries(DIFFICULTY).map(([k, d], i) => `<button data-diff="${k}" class="${k === difficulty ? 'on' : ''}">${i + 1} · ${d.label}</button>`).join('');
      card.innerHTML = `<h1>THE CHASE</h1>
        ${teams ? `<p class="small" style="margin:2px 0 6px"><b>${teams.bat}</b> v <b>${teams.bowl}</b></p>` : ''}<p>The AI has set you <b>${target}</b> to win off <b>${GAME.overs} overs</b>, with <b>${GAME.wickets} wickets</b>.<br>You bat. It bowls, sets the field, and learns where you score.</p>
        <div class="row">${diffs}</div>
        <div class="keys">${GRID.map(([, k, n]) => `<div><b>${k}</b> ${n}</div>`).join('')}</div>
        <p class="small">During the run-up an amber marker shows where the ball is <i>aimed</i> to pitch, with its line and type. Read it, then watch the ball: bowlers miss their spot, and on harder levels the read comes later, vaguer, and sometimes lies.</p>
        <p class="small">Hold the arrows for a direction, press <b>D</b> to play along the ground or <b>A</b> to loft it. No key is a leave. <b>S</b> plays a special: sweep, <b>S</b>+← reverse sweep, <b>S</b>+↑ scoop. They pay well and need tighter timing.<br>Time it so the bat meets the ball: early drags it leg side, late finds the edge.</p>
        <div class="row"><button class="go" data-act="go">Bat (Enter)</button><button data-act="nets">Calibrate in the nets (N)</button><button data-act="tune">Tuning (T)</button><button data-act="controller">🎮 Controller (K)</button></div>
        <p class="small"><a href="?">Back to the diorama</a> · C camera · Space skip · G timing meter · M sound</p>`;
      card.classList.add('on');
      card.querySelectorAll('[data-diff]').forEach((b) => (b.onclick = () => onPick?.(b.dataset.diff)));
      card.querySelector('[data-act=go]').onclick = () => onStart?.();
      card.querySelector('[data-act=nets]').onclick = () => onNets?.();
      card.querySelector('[data-act=tune]').onclick = () => onTune?.();
      card.querySelector('[data-act=controller]').onclick = () => onController?.();
    },
    pause(on) {
      if (on) {
        card.innerHTML = `<h1>Paused</h1><p>P or Esc to carry on.</p><p class="small"><a href="?">Leave for the diorama</a></p>`;
        card.classList.add('on');
      } else card.classList.remove('on');
    },
    hideCard() {
      card.classList.remove('on');
      help.classList.add('min'); // the intro card showed the keys; H brings them back
    },
    reset() {
      queue.length = 0;
      call.className = '';
      info.classList.remove('on');
      planEl.classList.remove('on');
      meterBall = null;
      nextPv = null;
      next.classList.remove('on');
    },
    toggleHelp() { help.classList.toggle('min'); },
  };
  return hud;
}

export { SHOTS };
