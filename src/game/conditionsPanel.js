import { GROUPS, SKY, PITCH, OUTFIELD, WIND, randomConditions } from './conditions.js';

/**
 * The Conditions panel (O, or the button on the intro card): sky, wind and its
 * direction, pitch and outfield, each a row of choices with what it does to the
 * ball. 🎲 rolls a random day; "New random conditions every match" rolls one
 * for each match. The look of the ground (light, pitch colour) follows as you
 * choose. Conditions are fixed once a match starts; in the nets they change on
 * the next ball.
 */
const CSS = `
#condp { position: absolute; left: 50%; top: 6vh; transform: translateX(-50%); width: min(600px, calc(100vw - 20px)); max-height: 88vh; overflow: auto; padding: 12px 16px; pointer-events: auto; display: none; font-size: 12px; z-index: 6; }
#condp.on { display: block; }
#condp h2 { margin: 0 0 2px; font-size: 16px; color: #1c2847; }
#condp .st { color: #6f6a55; margin-bottom: 6px; }
#condp .k { color: #6f6a55; font-size: 11px; letter-spacing: 0.06em; margin: 9px 0 3px; }
#condp .opts { display: flex; flex-wrap: wrap; gap: 4px; }
#condp button { font: inherit; color: inherit; background: #ebe4d0; border: 1px solid #c9bfa4; border-radius: 5px; padding: 4px 8px; cursor: pointer; }
#condp button.on { background: #283a63; border-color: #283a63; color: #f6f2e6; }
#condp .what { color: #4a4f3c; margin-top: 3px; min-height: 1.3em; }
#condp .row { display: flex; gap: 8px; align-items: center; margin-top: 12px; flex-wrap: wrap; }
#condp label { display: flex; gap: 5px; align-items: center; cursor: pointer; }
#condp .go { background: #9a2731; border-color: #9a2731; color: #f6f2e6; font-weight: bold; }
`;

const pct = (k) => `${k >= 1 ? '+' : '−'}${Math.round(Math.abs(k - 1) * 100)}%`;
/** One line on what the current choice in a group does. */
function what(g, sel) {
  if (g === 'sky') {
    const s = SKY[sel.sky];
    return s.swing === 1 ? 'Normal swing.' : `Swing ${pct(s.swing)}: ${s.swing > 1 ? 'the shine holds and the ball moves late in the air' : 'dry air, the ball goes fairly straight'}. The bowlers know it.`;
  }
  if (g === 'wind' || g === 'windDir') {
    const w = WIND[sel.wind];
    if (!w.speed) return 'No wind.';
    const dir = {
      atBatter: 'Into the batter’s face: lofted drives hang and fall short; the bowler gets a touch more pace.',
      atBowler: 'At the batter’s back: drives carry further; the bowler runs into it and loses a little pace.',
      offSide: 'Toward the off side: deliveries drift away from the batter; hits on the off side carry, leg-side hits hold up.',
      legSide: 'Toward the leg side: deliveries drift in; hits to leg carry, off-side hits hold up.',
    }[sel.windDir];
    return `${Math.round(w.speed * 3.6)} km/h. ${dir}`;
  }
  if (g === 'pitch') {
    const p = PITCH[sel.pitch];
    const bits = [];
    if (p.seam !== 1) bits.push(`seam ${pct(p.seam)}`);
    if (p.bounce !== 1) bits.push(`bounce ${p.bounce > 1 ? 'higher' : 'lower'}`);
    if (p.uneven !== 1) bits.push(p.uneven > 1 ? `${p.uneven > 2 ? 'very ' : ''}uneven bounce (the odd shooter or one that rears)` : 'true bounce');
    if (p.keep !== 0.9) bits.push(p.keep > 0.9 ? 'skids on, quicker off the surface' : 'grips, slower off the surface');
    return bits.length ? `${bits.join(', ')}.` : 'True: the ball does what it should.';
  }
  const o = OUTFIELD[sel.outfield];
  return o.roll === 1 ? 'Normal pace along the ground.' : o.roll > 1 ? 'Thick grass slows the ball: fewer boundaries along the ground.' : 'Hard and quick: the ball races away to the rope.';
}

export function createConditionsPanel({ root, ctl, getChoice, setChoice, editable, onClose }) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const el = document.createElement('div');
  el.id = 'condp';
  el.className = 'panel';
  root.appendChild(el);
  let opened = false;
  let prevPhase = null;

  function draw() {
    const { sel, random, umpire = { bad: 0.25, drs: true } } = getChoice();
    const can = editable();
    el.innerHTML = `<h2>Conditions</h2>
      <div class="st">${can ? 'Fixed for the match once you start. In the nets they change from the next ball.' : 'Set for this match. Change them before the next one.'}</div>
      ${GROUPS.map(([g, label, table]) => `<div class="k">${label}</div><div class="opts">${Object.entries(table).map(([k, v]) => `<button data-g="${g}" data-k="${k}" class="${sel[g] === k ? 'on' : ''}" ${can ? '' : 'disabled'}>${v.icon ? `${v.icon} ` : ''}${v.name}</button>`).join('')}</div>${g === 'wind' ? '' : `<div class="what">${what(g, sel)}</div>`}`).join('')}
      <div class="k">UMPIRES</div>
      <div class="opts" style="align-items:center;gap:8px">
        <span>Close calls wrong</span><input type="range" min="0" max="0.6" step="0.05" value="${umpire.bad}" data-ump ${can ? '' : 'disabled'} style="flex:1;min-width:140px;accent-color:#9a2731"><b>${Math.round(umpire.bad * 100)}%</b>
        <label><input type="checkbox" data-act="drs" ${umpire.drs ? 'checked' : ''} ${can ? '' : 'disabled'}> DRS: 3 reviews (V)</label>
      </div>
      <div class="what">${umpire.bad === 0 ? 'Perfect umpires: every close call is right.' : `A plumb one is rarely missed; a near miss, a faint edge or a feather off the bat before the pad goes the wrong way up to ${Math.round(umpire.bad * 100)}% of the time.`}${umpire.drs ? ' Given out LBW or caught off a faint edge, you get 10 s to review; a review that ends on umpire\'s call is kept.' : ''}</div>
      <div class="row">
        <button data-act="roll" ${can ? '' : 'disabled'}>🎲 Random day</button>
        <button data-act="std" ${can ? '' : 'disabled'}>Standard</button>
        <label><input type="checkbox" data-act="random" ${random ? 'checked' : ''} ${can ? '' : 'disabled'}> New random conditions every match</label>
        <span style="flex:1"></span>
        <button class="go" data-act="close">Done (O)</button>
      </div>`;
  }

  el.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    b.blur();
    if (b.dataset.act === 'close') return close();
    if (!editable()) return;
    const choice = getChoice();
    if (b.dataset.g) setChoice({ ...choice, sel: { ...choice.sel, [b.dataset.g]: b.dataset.k } });
    else if (b.dataset.act === 'roll') setChoice({ ...choice, sel: randomConditions() });
    else if (b.dataset.act === 'std') setChoice({ ...choice, sel: { sky: 'cloudy', wind: 'calm', windDir: 'offSide', pitch: 'standard', outfield: 'standard' } });
    draw();
  });
  el.addEventListener('input', (e) => {
    if (e.target.dataset.ump === undefined || !editable()) return;
    const choice = getChoice();
    setChoice({ ...choice, umpire: { ...choice.umpire, bad: +e.target.value } });
    e.target.nextElementSibling.textContent = `${Math.round(+e.target.value * 100)}%`;
  });
  el.addEventListener('change', (e) => {
    if (e.target.dataset.ump !== undefined) return draw();
    if (e.target.dataset.act === 'drs' && editable()) {
      const choice = getChoice();
      setChoice({ ...choice, umpire: { ...choice.umpire, drs: e.target.checked } });
      return draw();
    }
    if (e.target.dataset.act !== 'random' || !editable()) return;
    const choice = getChoice();
    setChoice({ ...choice, random: e.target.checked, sel: e.target.checked ? randomConditions() : choice.sel });
    draw();
  });

  function open() {
    opened = true;
    // Play waits while it is open.
    if (['live', 'ending', 'paused'].includes(ctl.phase)) {
      prevPhase = ctl.phase;
      ctl.phase = 'tuning';
    }
    el.classList.add('on');
    draw();
  }
  function close() {
    if (!opened) return;
    opened = false;
    el.classList.remove('on');
    if (ctl.phase === 'tuning' && prevPhase) ctl.phase = prevPhase;
    prevPhase = null;
    onClose?.();
  }
  return {
    open,
    close,
    toggle: () => (opened ? close() : open()),
    get isOpen() {
      return opened;
    },
  };
}
