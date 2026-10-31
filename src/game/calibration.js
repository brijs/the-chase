import { hash } from '../config.js';
import { TYPES } from './bowlerAI.js';
import { LENGTHS, HEIGHTS, LINES, LENGTH_NAMES, LINE_NAMES } from './delivery.js';
import { SHOTS, SPECIAL_KEYS, FLICK_MAX_LEN, K, EDGES } from './batting.js';
import { DIFFICULTY } from './rules.js';
import { nudges } from './tuner.js';

/**
 * Nets: the calibration session. No target, no result; the field stays put.
 * A picker chooses what is bowled (type / length / line, each Auto or fixed).
 * Play runs on; press F to pause and give feedback on the last ball (pressed
 * mid-delivery, the card opens once that ball is decided):
 *
 *   Timing felt   1 early · 2 right · 3 late
 *   Outcome felt  7 too harsh · 8 fair · 9 too kind
 *   Right shots   click a shot (or arrows + D / S): once = ideal, twice = OK,
 *                 three times = clear. Several can be ideal or OK.
 *                                                          Enter submit · Esc skip
 *
 * Each answer becomes a few bounded nudges (tuner.js), applied at once and
 * logged. Nothing is persisted until you press Save and confirm.
 */
const CSS = `
#nets-pick { position: absolute; left: 12px; top: 12px; padding: 8px 10px; width: 238px; pointer-events: auto; font-size: 11.5px; }
#nets-pick .k { color: #6f6a55; font-size: 10.5px; letter-spacing: 0.06em; margin: 6px 0 3px; }
#nets-pick .opts { display: flex; flex-wrap: wrap; gap: 3px; }
#nets-pick button, #nets-bar button, #nets-card button { font: inherit; color: inherit; background: #ebe4d0; border: 1px solid #c9bfa4; border-radius: 5px; padding: 3px 6px; cursor: pointer; }
#nets-pick button.on, #nets-card button.on { background: #283a63; border-color: #283a63; color: #f6f2e6; }
#nets-pick .note { color: #6f6a55; margin-top: 6px; }
#nets-bar { position: absolute; left: 50%; bottom: 12px; transform: translateX(-50%); padding: 6px 10px; display: flex; gap: 8px; align-items: center; pointer-events: auto; white-space: nowrap; font-size: 12px; }
#nets-bar .dirty { color: #9a2731; font-weight: bold; }
#nets-bar .save { background: #9a2731; border-color: #9a2731; color: #f6f2e6; }
#nets-card { position: absolute; left: 50%; top: 52%; transform: translate(-50%, -50%); width: min(560px, calc(100vw - 24px)); padding: 14px 18px; pointer-events: auto; display: none; }
#nets-card.on { display: block; }
#nets-card h2 { margin: 0 0 4px; font-size: 15px; color: #1c2847; }
#nets-card .what { margin-bottom: 8px; }
#nets-card .q { display: flex; align-items: center; gap: 6px; margin: 6px 0; flex-wrap: wrap; }
#nets-card .q .lbl { width: 108px; color: #6f6a55; }
#nets-card .grid { display: inline-grid; grid-template-columns: repeat(3, auto); gap: 3px; }
#nets-card .grid button.ideal { background: #2f8f86; border-color: #2f8f86; color: #f6f2e6; }
#nets-card .grid button.ok { background: #c9d86a; border-color: #9cc472; }
#nets-card .grid button.played { box-shadow: inset 0 0 0 2px #9a2731; }
#nets-card .legend { color: #6f6a55; font-size: 11px; }
#nets-card .grid button { min-width: 82px; }
#nets-card .foot { display: flex; justify-content: space-between; margin-top: 10px; color: #6f6a55; font-size: 11px; align-items: center; }
#nets-card .go { background: #9a2731; border-color: #9a2731; color: #f6f2e6; font-weight: bold; }
#nets-card .changes { margin: 6px 0 0; padding-left: 16px; }
#nets-card .changes li { margin: 2px 0; }
#nets-card .changes b { color: #1c2847; }
#nets-card .none { color: #6f6a55; }
`;
const PICK = {
  type: [['auto', 'Auto'], ...Object.entries(TYPES).map(([k, t]) => [k, t.name])],
  length: [['auto', 'Auto'], ...Object.keys(LENGTHS).map((k) => [k, LENGTH_NAMES[k]])],
  line: [['auto', 'Auto'], ...Object.keys(LINES).map((k) => [k, LINE_NAMES[k]])],
  field: [['attack', 'Attack'], ['balanced', 'Balanced'], ['death', 'Death']],
  level: Object.entries(DIFFICULTY).map(([k, d]) => [k, d.label]),
};
const GRID = [['UL', 'lateCut'], ['U', 'punch'], ['UR', 'glance'], ['L', 'cut'], ['', 'defence'], ['R', 'pull'], ['DL', 'cover'], ['D', 'straight'], ['DR', 'onDrive']];
const SPECIAL_GRID = [['', 'sweep'], ['L', 'reverseSweep'], ['U', 'scoop'], ['R', 'flick']];
const mid = (r, u = 0.5) => r[0] + (r[1] - r[0]) * u;

/**
 * The field from behind the bowler, as on screen: batter at the top, off side
 * on the left, straight down the ground at the bottom. az (radians from
 * straight toward the off side) maps to screen (-sin az, cos az).
 */
const BX = 110;
const BY = 52;
const ray = (az, len) => [BX - Math.sin(az) * len, BY + Math.cos(az) * len];
const AREAS = [[0, 'straight'], [0.35, 'mid-off'], [0.8, 'cover'], [1.55, 'point'], [2.3, 'third man'], [2.95, 'fine'], [-0.35, 'mid-on'], [-0.8, 'midwicket'], [-1.55, 'square leg'], [-2.4, 'fine leg']];
function dirName(az) {
  let best = AREAS[0];
  for (const a of AREAS) if (Math.abs(Math.atan2(Math.sin(az - a[0]), Math.cos(az - a[0]))) < Math.abs(Math.atan2(Math.sin(az - best[0]), Math.cos(az - best[0])))) best = a;
  return best[1];
}
/** Ray length to just inside the oval in that direction (shorter behind the batter). */
const R = (az) => 44 + 52 * (1 + Math.cos(az)) * 0.5 + 30 * Math.abs(Math.sin(az)) * 0.5;
function fieldMap(s, a) {
  const line = (az, len, col, dash = '') => { const [x, y] = ray(az, len); return `<line x1="${BX}" y1="${BY}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="${col}" stroke-width="2.5" ${dash ? `stroke-dasharray="${dash}"` : ''}/>`; };
  const dot = (az, len, col) => { const [x, y] = ray(az, len); return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="5" fill="${col}"/>`; };
  const labels = [[0.8, 'off'], [-0.8, 'leg'], [Math.PI, 'keeper'], [0, 'bowler']].map(([az, t]) => { const [x, y] = ray(az, az === 0 ? 118 : az === Math.PI ? 30 : 80); return `<text x="${x.toFixed(0)}" y="${(y + 4).toFixed(0)}" font-size="10" text-anchor="middle" fill="#6f6a55">${t}</text>`; }).join('');
  // Wedges round the line the shot takes for this timing (aim + drag): the
  // light one is how far timing inside the good window drags it, the dark one
  // the random scatter on top for this quality and pace.
  const wedge = (mid, half, col) => {
    const pts = [[BX, BY]];
    for (let i = 0; i <= 12; i++) { const az = mid - half + (2 * half * i) / 12; pts.push(ray(az, R(az))); }
    return `<polygon points="${pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')}" fill="${col}"/>`;
  };
  const line0 = s.aimAz + (s.driftAz ?? 0);
  const spreadWedges = s.spreadHalf ? wedge(s.aimAz, s.driftHalf + s.spreadHalf, 'rgba(246,242,230,0.35)') + wedge(line0, s.spreadHalf, 'rgba(40,58,99,0.35)') : '';
  return `<svg class="field" viewBox="0 0 220 186" width="220" height="186" style="cursor:crosshair;flex:none">
    <ellipse cx="110" cy="92" rx="104" ry="90" fill="#86b460" stroke="#f6f2e6" stroke-width="2"/>
    ${spreadWedges}
    <rect x="106" y="${BY - 6}" width="8" height="42" fill="#d8c592"/>${labels}
    ${line(s.aimAz, R(s.aimAz), '#2a211c', '5 4')}${line(s.az, R(s.az), '#c13a3c')}${dot(s.az, R(s.az), '#c13a3c')}
    ${a.dir !== null ? line(a.dir, R(a.dir), '#2f8f86') + dot(a.dir, R(a.dir), '#2f8f86') : ''}
    <circle cx="${BX}" cy="${BY}" r="4" fill="#741c26"/></svg>`;
}

export function createCalibration({ ctl, tuning, root, onTune, onExit }) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const pick = document.createElement('div');
  pick.id = 'nets-pick';
  pick.className = 'panel';
  const bar = document.createElement('div');
  bar.id = 'nets-bar';
  bar.className = 'panel';
  const card = document.createElement('div');
  card.id = 'nets-card';
  card.className = 'panel';
  for (const el of [pick, bar, card]) {
    el.style.display = 'none';
    root.appendChild(el);
  }
  card.style.display = '';

  const sel = { type: 'auto', length: 'auto', line: 'auto', field: 'balanced', level: 'medium' };
  const session = { balls: 0, answered: 0, changes: 0 };
  let open = null; // { sample, answers, phase: 'ask' | 'done' }
  let last = null; // the most recent ball's sample
  let wanted = false; // F pressed while a ball was live
  let confirm = null;

  // ---------------------------------------------------------------- picker
  function drawPick() {
    pick.innerHTML = `<div class="k" style="margin-top:0">NETS · WHAT TO BOWL NEXT</div>` + ['type', 'length', 'line', 'field', 'level'].map((g) =>
      `<div class="k">${{ type: 'TYPE', length: 'LENGTH', line: 'LINE', field: 'FIELD', level: 'LEVEL (TIMING WINDOWS, PACE)' }[g]}</div><div class="opts">${PICK[g].map(([k, n]) => `<button data-g="${g}" data-k="${k}" class="${sel[g] === k ? 'on' : ''}">${n}</button>`).join('')}</div>`
    ).join('') + `<div class="note">Applies from the next ball. Auto lets the AI choose.</div>`;
  }
  pick.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    sel[b.dataset.g] = b.dataset.k;
    if (b.dataset.g === 'field') ctl.setNetsField(sel.field);
    if (b.dataset.g === 'level' && ctl.m) {
      ctl.difficulty = sel.level;
      ctl.m.difficulty = sel.level;
      ctl.m.diff = DIFFICULTY[sel.level];
    }
    drawPick();
    b.blur();
  });

  /** The picker as a forced spec for the next ball (null when all Auto). */
  ctl.pickNext = () => {
    if (!ctl.nets) return null;
    const n = session.balls + 1;
    const h = (k) => hash(n * 7.13 + k * 1.91);
    const f = {};
    let length = sel.length;
    if (sel.type !== 'auto') {
      const T = TYPES[sel.type];
      Object.assign(f, { type: sel.type, kph: Math.round(mid(T.kph, h(3))), swing: mid(T.swing, h(4)), seam: mid(T.seam, h(5)) });
      if (T.length && length === 'auto') length = T.length;
    }
    if (length !== 'auto') {
      f.lenM = mid(LENGTHS[length], 0.25 + 0.5 * h(1));
      f.aimLenM = f.lenM;
      f.aimed = length;
      f.hStumps = mid(HEIGHTS[length], h(6));
    }
    if (sel.line !== 'auto') {
      f.lineZ = mid(LINES[sel.line], 0.25 + 0.5 * h(2));
      f.aimLineZ = f.lineZ;
      f.aimedLine = sel.line;
    }
    return Object.keys(f).length ? f : null;
  };

  // ---------------------------------------------------------------- bar
  function drawBar() {
    const dirty = tuning.state.dirty;
    bar.innerHTML = `<b>NETS</b><span>${session.balls} balls · ${session.answered} answered · ${session.changes} changes</span>
      <span>· <b>F</b> feedback on the last ball ·</span><span class="${dirty ? 'dirty' : ''}">${dirty ? '● unsaved' : `using: ${tuning.state.source}`}</span>
      <button data-act="tune">Tuning (T)</button><button data-act="save" class="save">Save calibration</button><button data-act="discard">Discard</button><button data-act="exit">Exit nets</button>`;
  }
  bar.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    b.blur();
    if (b.dataset.act === 'tune') onTune?.();
    else if (b.dataset.act === 'save') askSave();
    else if (b.dataset.act === 'discard') askDiscard();
    else if (b.dataset.act === 'exit') askExit();
  });
  tuning.onChange(() => bar.style.display !== 'none' && drawBar());

  // ---------------------------------------------------------------- confirm dialogs (reuse the card)
  function ask(title, body, buttons) {
    pause();
    confirm = buttons;
    card.innerHTML = `<h2>${title}</h2><div class="what">${body}</div><div class="foot"><span></span><span>${buttons.map((b, i) => `<button data-i="${i}" class="${b.go ? 'go' : ''}">${b.label}</button>`).join(' ')}</span></div>`;
    card.classList.add('on');
    card.querySelectorAll('[data-i]').forEach((el) => (el.onclick = () => choose(+el.dataset.i)));
  }
  function choose(i) {
    const b = confirm?.[i];
    confirm = null;
    card.classList.remove('on');
    if (!open) resume();
    b?.fn?.();
    if (open) drawCard();
  }
  const askSave = () => ask('Save calibration?', `Use these values in future games (saved in this browser).<br><span class="none">${Object.keys(tuning.overrides()).length} values differ from the defaults. Export from the Tuning panel to keep a file.</span>`, [
    { label: 'Save', go: true, fn: () => tuning.save() },
    { label: 'Cancel' },
  ]);
  const askDiscard = () => ask('Discard unsaved changes?', `Go back to: ${tuning.state.source}.`, [
    { label: 'Discard', go: true, fn: () => tuning.revert() },
    { label: 'Cancel' },
  ]);
  const askExit = () =>
    tuning.state.dirty
      ? ask('Leave the nets?', 'You have unsaved calibration.', [
          { label: 'Save and leave', go: true, fn: () => (tuning.save(), onExit?.()) },
          { label: 'Discard and leave', fn: () => (tuning.revert(), onExit?.()) },
          { label: 'Stay' },
        ])
      : onExit?.();

  // ---------------------------------------------------------------- feedback
  let prevPhase = 'live';
  function pause() {
    if (ctl.phase === 'live' || ctl.phase === 'ending') {
      prevPhase = ctl.phase;
      ctl.phase = 'feedback';
    }
  }
  function resume() {
    if (ctl.phase === 'feedback') ctl.phase = prevPhase;
  }

  function sampleOf(o, cur) {
    const sh = o.shot;
    const w = ctl.m.diff.window;
    const foot = !o.foot || o.foot === 'stance' ? 'front' : o.foot;
    return {
      ball: session.balls,
      rawErr: sh ? sh.err + (cur.input?.offset ?? 0) : null,
      err: sh ? sh.err : null,
      sigma: w.sigma,
      perfect: w.perfect,
      miss: w.miss,
      timing: sh?.timing ?? null,
      kind: o.kind,
      edge: sh?.edge ?? null,
      fit: sh?.fit ?? null,
      shotKey: sh?.shotKey ?? null,
      lofted: !!sh?.lofted,
      length: o.spec.length,
      lenM: o.spec.lenM,
      line: o.spec.line,
      type: o.spec.type,
      ballZ: cur.del.contactPos(foot).z,
      out: o.out,
      fieldType: o.fielding?.type ?? null,
      runs: o.runs,
      q: sh?.q ?? 0,
      az: sh && sh.kind === 'hit' ? sh.az : null,
      speed: sh?.speed ?? null,
      // How wide this shot could have gone: the scatter's full range at this
      // quality and pace, and the drag across the good timing window.
      // (For an edge: the range that kind of edge flies in.)
      spreadHalf: sh?.edge ? EDGES[sh.edge].azHalf : sh && sh.kind === 'hit' ? K.spread * (0.8 + 0.9 * (1 - sh.q)) * (cur.del.speed / 28) : 0,
      driftHalf: sh && sh.kind === 'hit' && !sh.edge ? w.sigma * (SHOTS[sh.shotKey].window ?? 1) * K.drift * (SHOTS[sh.shotKey].drift ?? 1) * (cur.del.speed / 28) : 0,
      elev: sh?.elev ?? null,
      aimAz: sh?.edge ? sh.edgeAim : sh?.aimAz ?? null,
      driftAz: sh?.edge ? 0 : sh?.driftAz ?? 0,
      scatter: sh?.edge ? sh.az - sh.edgeAim : sh?.scatter ?? 0,
      call: o.call,
      read: cur.preview ? `${cur.preview.typeName} · ${cur.preview.length} · ${cur.preview.line}` : null,
    };
  }

  function onOutcome({ o, tCall }) {
    if (!ctl.nets) return;
    const cur = ctl.cur;
    session.balls++;
    const sample = sampleOf(o, cur);
    drawBar();
    // The result shows first; the ball becomes "the last ball" just after.
    ctl.at(tCall + 0.6, () => {
      last = sample;
      if (wanted) {
        wanted = false;
        openCard();
      }
    });
  }
  function openCard() {
    if (!last) return;
    open = { sample: last, answers: { timing: null, outcome: null, ideal: [], good: [], dir: null, power: null, height: null, spread: null }, phase: 'ask' };
    pause();
    drawCard();
    card.classList.add('on');
  }
  /** F: feedback on the last ball, or on this one once it is decided. */
  function request() {
    if (!ctl.nets || open) return;
    const cur = ctl.cur;
    const live = cur && (!cur.resolved || (last && last.ball !== session.balls));
    if (live || !last) wanted = true;
    else openCard();
  }
  /** Cycle a shot: none -> ideal -> OK -> none. */
  function cycle(k) {
    const a = open.answers;
    if (a.ideal.includes(k)) {
      a.ideal = a.ideal.filter((x) => x !== k);
      a.good.push(k);
    } else if (a.good.includes(k)) a.good = a.good.filter((x) => x !== k);
    else a.ideal.push(k);
  }

  function drawCard() {
    const { sample: s, answers: a, phase } = open;
    const what = `${s.type ? TYPES[s.type].name : ''} · ${LENGTH_NAMES[s.length]}, ${LINE_NAMES[s.line]}<br>` +
      (s.shotKey ? `<b>${SHOTS[s.shotKey].name}${s.lofted ? ' (lofted)' : ''}</b> · ${s.timing} ${s.err > 0 ? '+' : ''}${Math.round(s.err * 1000)} ms · fit ${(s.fit * 100).toFixed(0)}% → <b>${s.call}</b>` : `No shot → <b>${s.call}</b>`) +
      (s.read ? `<br><span class="none">The read said: ${s.read}</span>` : '');
    if (phase === 'done') {
      const list = open.changes.length
        ? `<ul class="changes">${open.changes.map((c) => `<li><b>${tuning.byId[c.id].label}</b> ${fmt(c.id, c.from)} → ${fmt(c.id, c.to)} <span class="none">(${c.reason})</span></li>`).join('')}</ul>`
        : `<p class="none">Nothing to change from that answer.</p>`;
      card.innerHTML = `<h2>Tuned</h2><div class="what">${what}</div>${list}<div class="foot"><span>Enter or Esc to bowl the next one</span><button class="go" data-act="next">Next ball</button></div>`;
      card.querySelector('[data-act=next]').onclick = close;
      return;
    }
    const b = (q, v, label, key) => `<button data-q="${q}" data-v="${v}" class="${a[q] === v ? 'on' : ''}"><b>${key}</b> ${label}</button>`;
    card.innerHTML = `<h2>How was that?</h2><div class="what">${what}</div>
      <div class="q"><span class="lbl">Timing felt</span>${s.shotKey ? b('timing', -1, 'Early', 1) + b('timing', 0, 'Right', 2) + b('timing', 1, 'Late', 3) : '<span class="none">no shot played</span>'}</div>
      <div class="q"><span class="lbl">Outcome, next time</span>${b('outcome', -1, 'Be kinder', 7)}${b('outcome', 0, 'Fair', 8)}${b('outcome', 1, 'Be harsher', 9)}</div>
      ${s.az !== null ? `<div class="q"><span class="lbl">Power, next time<br><span class="legend">${s.speed.toFixed(0)} m/s off the bat</span></span>${b('power', -1, 'More power', 4)}${b('power', 0, 'Keep', 5)}${b('power', 1, 'Less power', 6)}</div>
      <div class="q"><span class="lbl">Trajectory, next time<br><span class="legend">left at ${Math.round((s.elev * 180) / Math.PI)}°${s.lofted ? ' (lofted)' : ''}</span></span>${b('height', -1, 'Higher', 'Q')}${b('height', 0, 'Keep', 'W')}${b('height', 1, 'Flatter', 'E')}</div>` : ''}
      ${s.az !== null ? `<div class="q"><span class="lbl">Should have gone<br><span class="legend">click the field</span></span>${fieldMap(s, a)}<span class="legend">${s.edge ? `<b>${EDGES[s.edge].name}</b>: your answers tune where ${EDGES[s.edge].name.toLowerCase()}s go<br><span style="color:#283a63">■</span> range ±${Math.round((s.spreadHalf * 180) / Math.PI)}°${EDGES[s.edge].mirror ? ' (either side)' : ''}<br>red: where it went<br>dashed: their usual line` : `<span style="color:#283a63">■</span> random scatter ±${Math.round((s.spreadHalf * 180) / Math.PI)}°<br><span style="color:#b0a68a">■</span> + timing drag (good window) ±${Math.round(((s.driftHalf + s.spreadHalf) * 180) / Math.PI)}°<br>red: where it went`}${s.edge ? '' : "<br>dashed: the shot's aim"}${a.dir !== null ? `<br><b style="color:#2f8f86">teal: yours (${dirName(a.dir)})</b><br><button data-act="nodir">clear</button>` : ''}
      ${s.az !== null ? `<div class="q"><span class="lbl">Spread, next time<br><span class="legend">how much shots vary</span></span>${b('spread', 1, 'Narrower', 'Z')}${b('spread', 0, 'Keep', 'X')}${b('spread', -1, 'Wider', 'C')}</div>` : ''}</span></div>` : ''}
      <div class="q"><span class="lbl">Right shots<br><span class="legend">click: ideal → OK → clear</span></span><span class="grid">${[...GRID, ...SPECIAL_GRID].map(([d, k]) => `<button data-q="shot" data-v="${k}" class="${a.ideal.includes(k) ? 'ideal' : a.good.includes(k) ? 'ok' : ''} ${s.shotKey === k ? 'played' : ''}" title="${s.shotKey === k ? 'the shot you played' : ''}">${SHOTS[k].name}</button>`).join('')}</span></div>
      <div class="foot"><span><span style="color:#2f8f86">■</span> ideal · <span style="color:#9cc472">■</span> OK · <span style="color:#9a2731">□</span> played · arrows + D / S mark too · Esc skips</span><button class="go" data-act="submit">Submit (Enter)</button></div>`;
    card.querySelectorAll('[data-q]').forEach((el) =>
      (el.onclick = () => {
        const q = el.dataset.q;
        if (q === 'shot') cycle(el.dataset.v);
        else {
          const v = +el.dataset.v;
          a[q] = a[q] === v ? null : v;
        }
        drawCard();
      })
    );
    card.querySelector('[data-act=submit]').onclick = submit;
    const map = card.querySelector('svg.field');
    if (map) {
      map.onclick = (e) => {
        const r = map.getBoundingClientRect();
        const sx = ((e.clientX - r.left) / r.width) * 220 - BX;
        const sy = ((e.clientY - r.top) / r.height) * 186 - BY;
        if (Math.hypot(sx, sy) < 6) return;
        a.dir = Math.atan2(-sx, sy); // screen left = off side (+Z), down = toward the bowler (+X)
        drawCard();
      };
      const nd = card.querySelector('[data-act=nodir]');
      if (nd) nd.onclick = () => ((a.dir = null), drawCard());
    }
  }
  const fmt = (id, v) => {
    const p = tuning.byId[id];
    return p.unit === 'ms' ? `${v.toFixed(0)} ms` : p.unit === 's' ? `${(v * 1000).toFixed(0)} ms` : v.toFixed(Math.abs(v) < 2 ? 3 : 1);
  };

  function submit() {
    if (!open || open.phase !== 'ask') return close();
    const { sample, answers } = open;
    const changes = [];
    for (const n of nudges(sample, answers, tuning.get)) {
      const r = tuning.set(n.id, n.to, { quiet: true });
      if (Math.abs(r.to - r.from) > 1e-6) changes.push({ ...r, reason: n.reason });
    }
    const answered = answers.timing !== null || answers.outcome !== null || answers.ideal.length > 0 || answers.good.length > 0 || answers.dir !== null || answers.power !== null || answers.height !== null || answers.spread !== null;
    if (answered) session.answered++;
    session.changes += changes.length;
    tuning.record({ at: new Date().toISOString(), level: ctl.difficulty, sample, answers, changes });
    open.changes = changes;
    open.phase = 'done';
    drawCard();
    drawBar();
  }
  function close() {
    open = null;
    card.classList.remove('on');
    resume();
  }

  return {
    get active() {
      return !!ctl.nets;
    },
    get cardOpen() {
      return !!open || !!confirm;
    },
    show(on) {
      pick.style.display = on ? '' : 'none';
      bar.style.display = on ? '' : 'none';
      if (on) {
        drawPick();
        drawBar();
      }
    },
    get field() {
      return sel.field;
    },
    get level() {
      return sel.level;
    },
    onOutcome,
    /** Keys while the card is open. Returns true when the key was used. */
    key(k) {
      if (k === 'camera') k = 'c'; // on the card, C answers "too narrow"
      if (confirm) {
        if (k === 'enter') choose(0);
        else if (k === 'pause') choose(confirm.length - 1);
        return true;
      }
      if (!open) return false;
      if (open.phase === 'done') {
        if (k === 'enter' || k === 'pause') close();
        return true;
      }
      if (k === 'enter') submit();
      else if (k === 'pause') close();
      else if (['1', '2', '3'].includes(k) && open.sample.shotKey) open.answers.timing = open.answers.timing === +k - 2 ? null : +k - 2;
      else if (['7', '8', '9'].includes(k)) open.answers.outcome = open.answers.outcome === +k - 8 ? null : +k - 8;
      else if (['4', '5', '6'].includes(k) && open.sample.az !== null) open.answers.power = open.answers.power === +k - 5 ? null : +k - 5;
      else if (['z', 'x', 'c'].includes(k) && open.sample.az !== null) open.answers.spread = open.answers.spread === 1 - 'zxc'.indexOf(k) ? null : 1 - 'zxc'.indexOf(k); // Z wide (+1), X right, C narrow (-1)
      else if (['q', 'w', 'e'].includes(k) && open.sample.az !== null) open.answers.height = open.answers.height === 'qwe'.indexOf(k) - 1 ? null : 'qwe'.indexOf(k) - 1;
      else return true;
      if (open?.phase === 'ask') drawCard();
      return true;
    },
    /** Arrows + D (or S for the specials) on the card: cycle that shot. */
    mark(dirKey, special = false) {
      if (!open || open.phase !== 'ask') return;
      let k = special ? SPECIAL_KEYS[dirKey] : GRID.find(([d]) => d === dirKey)?.[1];
      if (k === 'pull' && open.sample.lenM < FLICK_MAX_LEN) k = 'flick';
      if (k) cycle(k);
      drawCard();
    },
    request,
    submit,
    session,
  };
}
