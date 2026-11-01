
/**
 * The scorecard: after every over, every wicket and at the end of the innings
 * (not in the nets), and any time on B. Play pauses, the camera flies to the
 * ground's scoreboard, and the full card zooms out of it: batting (how out,
 * R, B, 4s, 6s, SR), extras, total, fall of wickets, and the bowling figures.
 * Enter / Esc / B (or the controller's confirm / back) to carry on; it also
 * closes by itself after a while.
 */
const CSS = `
#scard { position: absolute; left: 50%; top: 50%; width: min(720px, calc(100vw - 20px)); max-height: 88vh; overflow: auto; padding: 14px 18px 12px; pointer-events: auto; z-index: 7;
  transform: translate(-50%, -50%) scale(0.08); transform-origin: 18% 22%; opacity: 0; transition: transform 0.45s cubic-bezier(.2,.8,.2,1), opacity 0.3s; display: none; background: #1d2c25; color: #f6f2e6; border: 3px solid #7c5d39; border-radius: 6px; box-shadow: 0 10px 40px rgba(23,26,24,0.45); font: 12.5px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; }
#scard.show { display: block; }
#scard.on { transform: translate(-50%, -50%) scale(1); opacity: 1; }
#scard h2 { margin: 0; font-size: 15px; color: #f3c94a; letter-spacing: 0.06em; }
#scard .sub { color: #b0a68a; margin: 2px 0 10px; }
#scard .big { font-size: 26px; color: #f3c94a; font-weight: bold; }
#scard table { width: 100%; border-collapse: collapse; margin: 4px 0 8px; }
#scard th { text-align: right; color: #b0a68a; font-weight: normal; border-bottom: 1px solid #3b4340; padding: 3px 5px; }
#scard th:first-child, #scard td:first-child, #scard th.l, #scard td.l { text-align: left; }
#scard td { text-align: right; padding: 3px 5px; border-bottom: 1px solid #26392f; }
#scard td.how { color: #b0a68a; text-align: left; }
#scard tr.in td:first-child { color: #f3c94a; }
#scard .row { display: flex; justify-content: space-between; gap: 10px; flex-wrap: wrap; color: #dcd3ba; margin: 4px 0; }
#scard .fow { color: #b0a68a; }
#scard .foot { display: flex; justify-content: space-between; align-items: center; margin-top: 8px; color: #b0a68a; font-size: 11px; }
#scard button { font: inherit; background: #f3c94a; color: #1d2c25; border: 0; border-radius: 4px; padding: 5px 12px; cursor: pointer; font-weight: bold; }
`;

const sr = (r, b) => (b ? ((100 * r) / b).toFixed(0) : '-');
const overs = (balls) => `${Math.floor(balls / 6)}.${balls % 6}`;

/** The result in words, for the side that chased (m) against the side that set the target. */
export function resultLine(m, chasing, setting) {
  if (m.result === 'won') {
    const w = m.wickets - m.wkts;
    const bl = m.ballsLeft();
    return `${chasing} won by ${w} wicket${w === 1 ? '' : 's'}${bl ? ` (${bl} ball${bl === 1 ? '' : 's'} left)` : ''}`;
  }
  if (m.result === 'tied') return 'Match tied';
  const by = m.target - 1 - m.runs;
  return `${setting} won by ${by} run${by === 1 ? '' : 's'}`;
}

/**
 * One innings' card as HTML: m (its match), bk (its scorebook), reason
 * ('view' | 'over' | 'wicket' | 'end' | 'innings'), who is in, the other
 * innings and the result in words.
 */
export function scorecardHtml({ m, bk, reason = 'view', onStrike = -1, atCrease = new Set(), other = null, resultText = null, button = false }) {
  const head = reason === 'end'
    ? resultText ?? (m.target == null ? 'END OF INNINGS' : resultLine(m, bk.teams.bat.name, bk.teams.bowl.name))
    : reason === 'innings' ? 'END OF INNINGS' : reason === 'wicket' ? 'WICKET' : reason === 'over' ? `END OF OVER ${Math.floor(m.balls / 6)}` : 'SCORECARD';
  const need = (m.target ?? 0) - m.runs;
  const left = m.overs * 6 - m.balls;
  const bat = bk.batters
    .map((b, i) => ({ ...b, i }))
    .filter((b) => b.batted)
    .map((b) => `<tr class="${atCrease.has(b.i) && !b.out ? 'in' : ''}"><td>${b.name}${atCrease.has(b.i) && !b.out ? (b.i === onStrike ? ' *' : ' ') : ''}</td><td class="how">${b.out ? b.how : 'not out'}</td><td>${b.runs}</td><td>${b.balls}</td><td>${b.fours}</td><td>${b.sixes}</td><td>${sr(b.runs, b.balls)}</td></tr>`)
    .join('');
  const yet = bk.batters.filter((b) => !b.batted).map((b) => b.name.split(' ').slice(1).join(' '));
  const bowl = bk.bowlers
    .filter((b) => b.balls > 0)
    .map((b) => `<tr><td>${b.name}${b.style && b.style !== 'pace' ? ` <span style="color:#6f6a55">${b.style === 'off' ? 'OB' : 'LB'}</span>` : ''}</td><td>${overs(b.balls)}</td><td>${b.maidens}</td><td>${b.runs}</td><td>${b.wkts}</td><td>${b.balls ? ((b.runs / b.balls) * 6).toFixed(1) : '-'}</td></tr>`)
    .join('');
  const chase = m.target != null;
  return `<h2>${head}</h2>
    <div class="sub">${bk.teams.bat.name} v ${bk.teams.bowl.name} · ${m.overs} overs · ${chase ? `target ${m.target}` : 'first innings'}${other ? ` · ${other}` : ''}</div>
    <div class="row"><span class="big">${bk.teams.bat.name.split(' ').pop().toUpperCase()} ${m.runs}/${m.wkts}</span><span>${m.overText()} of ${m.overs} overs${m.result ? '' : chase ? ` · need ${Math.max(0, need)} off ${left}${left ? ` · RRR ${((need / left) * 6).toFixed(1)}` : ''}` : ` · RR ${m.balls ? ((m.runs / m.balls) * 6).toFixed(1) : '-'}`}</span></div>
    <table><tr><th class="l">Batter</th><th class="l"></th><th>R</th><th>B</th><th>4s</th><th>6s</th><th>SR</th></tr>${bat}</table>
    <div class="row"><span>Extras ${bk.wides} (wd ${bk.wides})</span><span><b>Total ${m.runs}/${m.wkts}</b> (${m.overText()} ov)</span></div>
    ${yet.length ? `<div class="row fow"><span>Yet to bat: ${yet.slice(0, m.wickets + 1 - bk.next).join(', ') || '—'}</span></div>` : ''}
    ${bk.fow.length ? `<div class="row fow"><span>Fall of wickets: ${bk.fow.map((f) => `${f.score}-${f.wkts} (${f.name.split(' ').slice(1).join(' ')}, ${f.over} ov)`).join(' · ')}</span></div>` : ''}
    <table><tr><th class="l">${bk.teams.bowl.name} bowling</th><th>O</th><th>M</th><th>R</th><th>W</th><th>Econ</th></tr>${bowl || '<tr><td colspan="6" class="how">yet to bowl</td></tr>'}</table>
    ${button ? `<div class="foot"><span>Enter / Esc / B to carry on${reason === 'end' ? '' : ' · closes by itself'}</span><button data-act="close">${reason === 'end' ? 'Result' : 'Continue'}</button></div>` : ''}`;
}

export function createScorecard({ ctl, root }) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const el = document.createElement('div');
  el.id = 'scard';
  root.appendChild(el);
  let book = null;
  let open = false;
  let prevPhase = null;
  let timer = 0;
  let pending = 0;
  const S = { flying: false };

  function html(reason) {
    return scorecardHtml({ m: ctl.m, bk: book, reason, onStrike: book.actor[ctl.roles.striker], atCrease: new Set([book.actor[ctl.roles.striker], book.actor[ctl.roles.nonStriker]]), other, resultText, button: true });
  }
  let other = null; // the other innings, one line: "Northgate Mariners 54/3 (5 ov)"
  let resultText = null;
  /** Fly to the board, then zoom the card out of it. */
  function show(reason = 'view') {
    if (!book || ctl.nets || open) return;
    open = true;
    prevPhase = ctl.phase;
    if (['live', 'ending', 'paused'].includes(ctl.phase)) ctl.phase = 'scorecard';
    S.flying = true;
    el.innerHTML = html(reason);
    el.querySelector('[data-act=close]').onclick = close;
    el.classList.add('show');
    clearTimeout(pending);
    clearTimeout(timer);
    pending = setTimeout(() => el.classList.add('on'), 850);
    if (reason !== 'end') timer = setTimeout(close, 9500);
  }
  function close() {
    if (!open) return;
    open = false;
    S.flying = false;
    clearTimeout(timer);
    clearTimeout(pending);
    el.classList.remove('on');
    setTimeout(() => !open && el.classList.remove('show'), 300);
    if (ctl.phase === 'scorecard') ctl.phase = prevPhase === 'paused' ? 'paused' : prevPhase ?? 'live';
  }
  return {
    setBook(b) {
      book = b;
    },
    /** The other innings in one line, and the match result in words (both optional). */
    setContext({ other: o = null, result = null } = {}) {
      other = o;
      resultText = result;
    },
    get book() {
      return book;
    },
    show,
    close,
    toggle: (r) => (open ? close() : show(r)),
    get isOpen() {
      return open;
    },
    /** True while the camera should be on the ground's scoreboard. */
    get onBoard() {
      return S.flying;
    },
  };
}
