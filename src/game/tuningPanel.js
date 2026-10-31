import { SHOT_ORDER, LENGTH_KEYS } from './tuning.js';
import { SHOTS } from './batting.js';
import { DIFFICULTY } from './rules.js';

/**
 * The tuning panel (T): every calibratable value, visible and editable, live.
 *
 *   Timing      a histogram of your recent presses (raw and corrected) over the
 *               perfect / good / miss bands; offset, window width, swing times
 *   Shots       the 9 x 5 fit heatmap (shot x length; click a cell to edit),
 *               each shot's line band (pads ... wide) and power
 *   Outcomes, Fielding & running, Bowling & read   sliders with defaults
 *   History     every nudge from the nets, newest first, each with undo
 *
 * Footer: Save (confirm), Revert to saved, Reset to defaults, Export / Import.
 * Changed values are marked; each row resets on its own.
 */
const CSS = `
#tune { position: absolute; inset: 5vh 50% auto auto; transform: translateX(50%); width: min(820px, calc(100vw - 20px)); max-height: 90vh; display: none; flex-direction: column; pointer-events: auto; font-size: 12px; z-index: 6; }
#tune.on { display: flex; }
#tune header { display: flex; align-items: center; gap: 10px; padding: 10px 14px 0; }
#tune header h2 { margin: 0; font-size: 16px; color: #1c2847; }
#tune header .src { color: #6f6a55; }
#tune header .dirty { color: #9a2731; font-weight: bold; }
#tune header .x { margin-left: auto; }
#tune nav { display: flex; gap: 4px; padding: 8px 14px; border-bottom: 1px solid #c9bfa4; flex-wrap: wrap; }
#tune button { font: inherit; color: inherit; background: #ebe4d0; border: 1px solid #c9bfa4; border-radius: 5px; padding: 4px 8px; cursor: pointer; }
#tune nav button.on { background: #283a63; border-color: #283a63; color: #f6f2e6; }
#tune .body { overflow: auto; padding: 10px 14px; flex: 1; }
#tune footer { display: flex; gap: 6px; padding: 8px 14px 10px; border-top: 1px solid #c9bfa4; flex-wrap: wrap; align-items: center; }
#tune footer .save { background: #9a2731; border-color: #9a2731; color: #f6f2e6; font-weight: bold; }
#tune footer .note { color: #6f6a55; font-size: 11px; margin-left: auto; }
#tune .row { display: grid; grid-template-columns: 270px 1fr 74px 24px; gap: 8px; align-items: center; padding: 3px 0; }
#tune .row label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#tune .row.changed label { color: #9a2731; font-weight: bold; }
#tune .row input[type=number] { width: 70px; font: inherit; }
#tune .row input[type=range] { width: 100%; accent-color: #283a63; }
#tune .def { color: #6f6a55; font-size: 10.5px; }
#tune .rs { padding: 1px 4px; }
#tune h3 { margin: 10px 0 4px; font-size: 12px; color: #1c2847; letter-spacing: 0.04em; }
#tune table.heat { border-collapse: separate; border-spacing: 3px; }
#tune table.heat th { font-weight: normal; color: #6f6a55; padding: 0 4px; text-align: right; }
#tune table.heat td { width: 62px; height: 26px; text-align: center; border-radius: 4px; cursor: pointer; border: 2px solid transparent; }
#tune table.heat td.changed { border-color: #9a2731; }
#tune table.heat td.sel { outline: 2px solid #1c2847; }
#tune .lines .ln { display: grid; grid-template-columns: 110px 1fr; gap: 8px; align-items: center; margin: 4px 0; }
#tune .lines svg { width: 100%; height: 26px; }
#tune canvas { width: 100%; height: 150px; background: #f6f2e6; border: 1px solid #c9bfa4; border-radius: 6px; }
#tune .hist { color: #6f6a55; margin: 4px 0 8px; }
#tune .log li { margin: 3px 0; }
#tune .log .why { color: #6f6a55; }
#tune .help { color: #6f6a55; margin: 2px 0 8px; }
`;
const TABS = ['Timing', 'Shots', 'Edges', 'Outcomes', 'Fielding & running', 'Bowling & read', 'History'];
const LEN_NAMES = { yorker: 'Yorker', full: 'Full', good: 'Good', short: 'Short', bouncer: 'Bouncer' };

export function createTuningPanel({ tuning, ctl, root, onClose }) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const el = document.createElement('div');
  el.id = 'tune';
  el.className = 'panel';
  root.appendChild(el);
  let tab = 'Timing';
  let cell = null; // selected heatmap cell id
  let prevPhase = null;
  let opened = false;
  const file = document.createElement('input');
  file.type = 'file';
  file.accept = 'application/json,.json';
  file.style.display = 'none';
  root.appendChild(file);

  const DEG = 180 / Math.PI;
  const fmt = (p, v) => (p.unit === 's' ? (v * 1000).toFixed(0) : p.unit === 'deg' ? (v * DEG).toFixed(1) : v.toFixed(p.step < 0.01 ? 3 : 2));
  const toUi = (p, v) => (p.unit === 's' ? v * 1000 : p.unit === 'deg' ? v * DEG : v);
  const fromUi = (p, v) => (p.unit === 's' ? v / 1000 : p.unit === 'deg' ? v / DEG : v);
  const unitUi = (p) => (p.unit === 's' ? 'ms' : p.unit === 'deg' ? (/\.az$/.test(p.id) ? '° (0 straight, + off side)' : '°') : p.unit);

  function row(p, label = p.label) {
    const v = p.get();
    const changed = tuning.isChanged(p.id);
    const min = toUi(p, p.min), max = toUi(p, p.max), step = p.unit === 's' ? 1 : p.unit === 'deg' ? 0.5 : p.step;
    return `<div class="row ${changed ? 'changed' : ''}" data-id="${p.id}">
      <label title="${p.id}">${label} <span class="def">${unitUi(p)} · default ${fmt(p, tuning.DEFAULTS[p.id])}</span></label>
      <input type="range" min="${min}" max="${max}" step="${step}" value="${toUi(p, v)}">
      <input type="number" min="${min}" max="${max}" step="${step}" value="${fmt(p, v)}">
      <button class="rs" title="reset to default" ${changed ? '' : 'disabled'}>↺</button></div>`;
  }
  const group = (g, sub) => tuning.PARAMS.filter((p) => p.group === g && (sub === undefined || p.sub === sub));

  function heat() {
    const head = `<tr><th></th>${LENGTH_KEYS.map((L) => `<th style="text-align:center">${LEN_NAMES[L]}</th>`).join('')}</tr>`;
    const rows = SHOT_ORDER.map((k) => `<tr><th>${SHOTS[k].name}</th>${LENGTH_KEYS.map((L) => {
      const id = `shot.${k}.len.${L}`;
      const v = tuning.get(id);
      const bg = `rgb(${Math.round(235 - 188 * v)},${Math.round(228 - 85 * v)},${Math.round(208 - 74 * v)})`;
      return `<td data-cell="${id}" class="${tuning.isChanged(id) ? 'changed' : ''} ${cell === id ? 'sel' : ''}" style="background:${bg};color:${v > 0.55 ? '#f6f2e6' : '#2a211c'}">${v.toFixed(2)}</td>`;
    }).join('')}</tr>`).join('');
    return `<table class="heat">${head}${rows}</table>`;
  }
  function lineBars() {
    const X = (z) => ((z + 0.8) / 1.8) * 100;
    const ticks = [[-0.144, 'leg stump'], [0, 'middle'], [0.144, 'off stump'], [0.5, 'wide']];
    return SHOT_ORDER.map((k) => {
      const [a, b] = SHOTS[k].line;
      return `<div class="ln"><span>${SHOTS[k].name}</span><svg viewBox="0 0 100 10" preserveAspectRatio="none">
        <rect x="0" y="3" width="100" height="4" fill="#ebe4d0"/><rect x="${X(a)}" y="1.5" width="${Math.max(0.6, X(b) - X(a))}" height="7" fill="#2f8f86"/>
        ${ticks.map(([z]) => `<rect x="${X(z) - 0.15}" y="0" width="0.3" height="10" fill="#6f6a55"/>`).join('')}</svg></div>`;
    }).join('') + `<div class="help">Bars run from 0.8 m down the leg side (left) to 1.0 m outside off (right). Ticks: leg stump, middle, off stump, 0.5 m wide.</div>`;
  }

  function body() {
    if (tab === 'Timing') {
      return `<div class="help">The offset is your latency: every press counts as that much earlier. The nets set it from "timing felt" answers.</div>
        <canvas width="760" height="150"></canvas><div class="hist"></div>
        ${group('Timing').filter((p) => !p.sub).map((p) => row(p)).join('')}
        <h3>SWING TIME (PRESS TO BAT ON BALL)</h3>${group('Timing', 'Swing time').map((p) => row(p)).join('')}
        <h3>TIMING WINDOW PER SHOT (× THE LEVEL'S WINDOW; THE SPECIALS ARE TIGHTER)</h3>${group('Timing', 'Window').map((p) => row(p)).join('')}`;
    }
    if (tab === 'Shots') {
      const sp = cell ? tuning.byId[cell] : null;
      return `<div class="help">How well each shot suits each length, 0–1 (scaled by the line band below). Low fit edges or misses; under the wrong-shape threshold it hardly ever connects. Click a cell to edit it.</div>
        ${heat()}${sp ? row(sp) : '<div class="help">No cell selected.</div>'}
        <h3>LINE BANDS (WHERE EACH SHOT WANTS THE BALL)</h3><div class="lines">${lineBars()}</div>
        ${SHOT_ORDER.map((k) => row(tuning.byId[`shot.${k}.line0`]) + row(tuning.byId[`shot.${k}.line1`])).join('')}
        <h3>POWER</h3>${group('Shots', 'power').map((p) => row(p)).join('')}
        <h3>LAUNCH ANGLE (ADDED TO EACH SHOT'S TRAJECTORY; + IS HIGHER)</h3>${group('Shots', 'elev').map((p) => row(p)).join('')}
        <h3>AIM (WHERE A WELL-TIMED SHOT GOES)</h3>${group('Shots', 'aim').map((p) => row(p)).join('')}
        <h3>TIMING DRIFT (HOW FAR EARLY / LATE DRAGS THE DIRECTION)</h3>${group('Shots', 'drift').map((p) => row(p)).join('')}`;
    }
    if (tab === 'History') {
      const entries = tuning.state.log.slice().reverse().filter((e) => e.changes?.length);
      if (!entries.length) return `<div class="help">No nudges yet. Play in the nets (N on the intro card) and answer the questions after each ball.</div>`;
      let i = tuning.state.log.length;
      return `<ul class="log">${tuning.state.log.slice().reverse().map((e) => {
        i--;
        if (!e.changes?.length) return '';
        const s = e.sample;
        return `<li><b>Ball ${s.ball}</b> · ${s.shotKey ?? 'no shot'} → ${s.call} · answers: ${['early', 'right', 'late'][e.answers.timing + 1] ?? '–'} / ${['be kinder', 'fair', 'be harsher'][e.answers.outcome + 1] ?? '–'}${e.answers.ideal ? ' / ideal ' + e.answers.ideal : ''}
          <ul>${e.changes.map((c, j) => `<li>${tuning.byId[c.id]?.label ?? c.id}: ${(+c.from).toFixed(3)} → ${(+c.to).toFixed(3)} <span class="why">(${c.reason})</span> <button data-undo="${i}:${j}" class="rs" title="set back to ${(+c.from).toFixed(3)}">undo</button></li>`).join('')}</ul></li>`;
      }).join('')}</ul>`;
    }
    return group(tab).map((p) => row(p)).join('');
  }

  function drawHist() {
    const cv = el.querySelector('canvas');
    if (!cv) return;
    const g = cv.getContext('2d');
    const W = cv.width, H = cv.height;
    const w = DIFFICULTY[ctl.difficulty ?? 'medium'].window;
    const R = 0.2; // +-200 ms
    const X = (e) => ((e + R) / (2 * R)) * W;
    g.clearRect(0, 0, W, H);
    for (const [half, col] of [[w.miss, '#ebe4d0'], [w.sigma * 1.25, '#c9d86a'], [w.perfect, '#9cc472']]) {
      g.fillStyle = col;
      g.fillRect(X(-half), 0, X(half) - X(-half), H - 16);
    }
    const samples = tuning.state.log.map((e) => e.sample).filter((s) => s && s.rawErr !== null && s.rawErr !== undefined).slice(-60);
    const bins = (key) => {
      const b = new Array(40).fill(0);
      for (const s of samples) {
        const i = Math.floor(((s[key] + R) / (2 * R)) * 40);
        if (i >= 0 && i < 40) b[i]++;
      }
      return b;
    };
    const raw = bins('rawErr'), cor = bins('err');
    const mx = Math.max(1, ...raw, ...cor);
    const bw = W / 40;
    raw.forEach((n, i) => { g.fillStyle = 'rgba(193,58,60,0.55)'; g.fillRect(i * bw + 1, H - 16 - (n / mx) * (H - 24), bw * 0.45, (n / mx) * (H - 24)); });
    cor.forEach((n, i) => { g.fillStyle = '#283a63'; g.fillRect(i * bw + bw * 0.5, H - 16 - (n / mx) * (H - 24), bw * 0.45, (n / mx) * (H - 24)); });
    g.fillStyle = '#2a211c';
    g.font = '11px ui-monospace, Menlo, monospace';
    g.textAlign = 'center';
    for (const ms of [-200, -100, 0, 100, 200]) g.fillText(`${ms > 0 ? '+' : ''}${ms} ms`, Math.min(W - 26, Math.max(26, X(ms / 1000))), H - 3);
    const med = (k) => { const v = samples.map((s) => s[k]).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] * 1000 : null; };
    const mr = med('rawErr');
    el.querySelector('.hist').innerHTML = samples.length
      ? `<span style="color:#c13a3c">■ raw presses</span> · <span style="color:#283a63">■ after offset</span> · ${samples.length} shots · median raw ${mr > 0 ? '+' : ''}${mr.toFixed(0)} ms, after offset ${med('err').toFixed(0)} ms · bands: perfect / good / miss at ${DIFFICULTY[ctl.difficulty ?? 'medium'].label}`
      : 'No shots recorded yet: the histogram fills as you play in the nets.';
  }

  function draw() {
    if (!opened) return;
    const st = tuning.state;
    el.innerHTML = `<header><h2>Tuning</h2><span class="src">using: ${st.source}${st.savedAt ? ` · saved ${st.savedAt.slice(0, 16).replace('T', ' ')}` : ''}</span>${st.dirty ? '<span class="dirty">● unsaved changes</span>' : ''}<button class="x" data-act="close">Close (T)</button></header>
      <nav>${TABS.map((t) => `<button data-tab="${t}" class="${t === tab ? 'on' : ''}">${t}</button>`).join('')}</nav>
      <div class="body">${body()}</div>
      <footer><button class="save" data-act="save">Save…</button><button data-act="revert">Revert to saved</button><button data-act="forget" title="Delete this browser's saved calibration (the baked calibration.json, if any, then applies)">Forget browser save</button><button data-act="reset">Reset all to defaults</button><button data-act="export">Export JSON</button><button data-act="import">Import JSON</button>
      <span class="note">${Object.keys(tuning.overrides()).length} values differ from defaults · save an export as short-ball/calibration.json to bake it into the build</span></footer>`;
    drawHist();
  }

  // Live edits: sliders and numbers.
  el.addEventListener('input', (e) => {
    const r = e.target.closest('.row');
    if (!r) return;
    const p = tuning.byId[r.dataset.id];
    const v = fromUi(p, +e.target.value);
    if (!Number.isFinite(v)) return;
    tuning.set(p.id, v, { quiet: true });
    const other = r.querySelector(e.target.type === 'range' ? 'input[type=number]' : 'input[type=range]');
    other.value = e.target.type === 'range' ? fmt(p, p.get()) : toUi(p, p.get());
    r.classList.toggle('changed', tuning.isChanged(p.id));
    r.querySelector('.rs').disabled = !tuning.isChanged(p.id);
  });
  el.addEventListener('change', () => draw());
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button, td[data-cell]');
    if (!b) return;
    if (b.dataset.tab) tab = b.dataset.tab;
    else if (b.dataset.cell) cell = b.dataset.cell;
    else if (b.classList.contains('rs') && b.closest('.row')) tuning.reset(b.closest('.row').dataset.id);
    else if (b.dataset.undo) {
      const [i, j] = b.dataset.undo.split(':').map(Number);
      const c = tuning.state.log[i].changes[j];
      tuning.set(c.id, c.from);
    } else if (b.dataset.act === 'close') return close();
    else if (b.dataset.act === 'save') {
      if (window.confirm('Use these calibrated values in future games? They will be saved in this browser.')) tuning.save();
    } else if (b.dataset.act === 'revert') tuning.revert();
    else if (b.dataset.act === 'forget') {
      if (window.confirm("Delete this browser's saved calibration? The baked calibration.json (if any) or the defaults apply instead.")) tuning.forget();
    }
    else if (b.dataset.act === 'reset') {
      if (window.confirm('Reset every value to the code defaults? (Nothing is saved until you press Save.)')) tuning.reset();
    } else if (b.dataset.act === 'export') {
      const blob = new Blob([tuning.export()], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'calibration.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } else if (b.dataset.act === 'import') file.click();
    draw();
  });
  file.addEventListener('change', async () => {
    const f = file.files[0];
    if (!f) return;
    try {
      tuning.import(await f.text());
    } catch (err) {
      window.alert(`Could not import: ${err.message}`);
    }
    file.value = '';
    draw();
  });
  tuning.onChange(() => opened && draw());

  function open() {
    opened = true;
    if (!['feedback', 'tuning'].includes(ctl.phase)) {
      prevPhase = ctl.phase;
      if (ctl.phase === 'live' || ctl.phase === 'ending' || ctl.phase === 'paused') ctl.phase = 'tuning';
    }
    el.classList.add('on');
    draw();
  }
  function close() {
    opened = false;
    el.classList.remove('on');
    if (ctl.phase === 'tuning') ctl.phase = prevPhase === 'paused' ? 'paused' : prevPhase ?? 'live';
    onClose?.();
  }
  return {
    open,
    close,
    toggle: () => (opened ? close() : open()),
    get isOpen() {
      return opened;
    },
    setTab(t) {
      tab = t;
      draw();
    },
  };
}
