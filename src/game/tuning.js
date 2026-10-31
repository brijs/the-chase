import { K, SHOTS, EDGES } from './batting.js';
import { FK } from './fielding.js';
import { DIFFICULTY } from './rules.js';

/**
 * Every value the Chase can be calibrated on, in one registry.
 *
 * The game's modules keep owning their numbers (K in batting.js, FK in
 * fielding.js, SHOTS, DIFFICULTY); this file reads and writes them in place,
 * so a calibration takes effect on the next ball. Difficulty-wide scales are
 * applied to a snapshot of DIFFICULTY, so they never compound.
 *
 * Layers: code defaults <- baked calibration.json (build define) <- the
 * browser's saved calibration (localStorage) <- unsaved edits from the panel
 * or nets feedback. A browser save records which baked file it was made on top
 * of; when a different file is baked in, the baked file wins and the older
 * browser save is set aside (kept under a backup key).
 *
 * Stored / exported shape: { version: 1, params: { id: value }, savedAt, log }
 * where params holds only the values that differ from the code defaults.
 */
export const VERSION = 1;
const STORE = 'chase-calibration-v1';

/** Global scales on top of the per-level DIFFICULTY table, and your timing offset. */
export const SCALES = {
  offsetMs: 0, // subtracted from every press: your input / perception latency
  windowScale: 1,
  paceScale: 1,
  fielderSpeedScale: 1,
  catchSkillScale: 1,
  readZoneScale: 1,
  readHideScale: 1,
};
const BASE_DIFF = JSON.parse(JSON.stringify(DIFFICULTY));
function recomputeDifficulty() {
  for (const [k, b] of Object.entries(BASE_DIFF)) {
    const d = DIFFICULTY[k];
    const w = SCALES.windowScale;
    d.window = { perfect: b.window.perfect * w, sigma: b.window.sigma * w, miss: b.window.miss * w };
    d.pace = b.pace * SCALES.paceScale;
    d.fielderSpeed = b.fielderSpeed * SCALES.fielderSpeedScale;
    d.catchSkill = Math.min(0.995, b.catchSkill * SCALES.catchSkillScale);
    d.preview = {
      ...b.preview,
      len: b.preview.len * SCALES.readZoneScale,
      line: b.preview.line * SCALES.readZoneScale,
      hideBefore: b.preview.hideBefore * SCALES.readHideScale,
    };
  }
}

export const LENGTH_KEYS = ['yorker', 'full', 'good', 'short', 'bouncer'];
export const SHOT_ORDER = ['straight', 'cover', 'onDrive', 'cut', 'lateCut', 'punch', 'glance', 'pull', 'flick', 'defence', 'sweep', 'reverseSweep', 'scoop'];

// ------------------------------------------------------------------ registry
const PARAMS = [];
const byId = {};
function param(p) {
  PARAMS.push(p);
  byId[p.id] = p;
}
const prop = (obj, key) => ({ get: () => obj[key], set: (v) => (obj[key] = v) });

param({ id: 'timing.offsetMs', group: 'Timing', label: 'Timing offset (your latency)', unit: 'ms', min: -150, max: 150, step: 1, ...prop(SCALES, 'offsetMs') });
param({ id: 'timing.windowScale', group: 'Timing', label: 'Timing window width', unit: '×', min: 0.5, max: 2, step: 0.01, ...prop(SCALES, 'windowScale') });
for (const k of SHOT_ORDER) {
  const s = SHOTS[k];
  param({ id: `shot.${k}.swing`, group: 'Timing', sub: 'Swing time', label: s.name, unit: 's', min: 0.05, max: 0.25, step: 0.005, ...prop(s, 'swing') });
}
for (const k of SHOT_ORDER) {
  const s = SHOTS[k];
  if (s.window === undefined) s.window = 1;
  param({ id: `shot.${k}.window`, group: 'Timing', sub: 'Window', label: s.name, unit: '×', min: 0.3, max: 2, step: 0.01, ...prop(s, 'window') });
}
for (const k of SHOT_ORDER) {
  const s = SHOTS[k];
  param({ id: `shot.${k}.az`, group: 'Shots', sub: 'aim', shot: k, label: `${s.name} · aim`, unit: 'deg', min: s.az - 0.6, max: s.az + 0.6, step: Math.PI / 360, ...prop(s, 'az') });
}
for (const k of SHOT_ORDER) {
  const s = SHOTS[k];
  if (s.elev === undefined) s.elev = 0;
  param({ id: `shot.${k}.elev`, group: 'Shots', sub: 'elev', shot: k, label: `${s.name} · launch angle`, unit: 'deg', min: -0.35, max: 0.35, step: Math.PI / 360, ...prop(s, 'elev') });
}
for (const k of SHOT_ORDER) {
  const s = SHOTS[k];
  if (s.drift === undefined) s.drift = 1;
  param({ id: `shot.${k}.drift`, group: 'Shots', sub: 'drift', shot: k, label: `${s.name} · timing drift`, unit: '×', min: 0, max: 3, step: 0.01, ...prop(s, 'drift') });
}
for (const k of SHOT_ORDER) {
  const s = SHOTS[k];
  for (const L of LENGTH_KEYS) param({ id: `shot.${k}.len.${L}`, group: 'Shots', sub: 'fit', shot: k, length: L, label: `${s.name} · ${L}`, unit: '', min: 0, max: 1, step: 0.01, ...prop(s.len, L) });
  param({ id: `shot.${k}.line0`, group: 'Shots', sub: 'line', shot: k, label: `${s.name} · line from`, unit: 'm', min: -0.8, max: 1.0, step: 0.01, ...prop(s.line, 0) });
  param({ id: `shot.${k}.line1`, group: 'Shots', sub: 'line', shot: k, label: `${s.name} · line to`, unit: 'm', min: -0.8, max: 1.0, step: 0.01, ...prop(s.line, 1) });
  param({ id: `shot.${k}.power`, group: 'Shots', sub: 'power', shot: k, label: `${s.name} · power`, unit: '×', min: 0.1, max: 1.5, step: 0.01, ...prop(s, 'power') });
}
for (const [k, e] of Object.entries(EDGES)) {
  const spd = e.pace ? ['×pace', 0.05, 1.2] : ['m/s', 2, 25];
  param({ id: `edge.${k}.az`, group: 'Edges', edge: k, label: `${e.name} · direction`, unit: 'deg', min: e.mirror ? 0 : -Math.PI, max: Math.PI, step: Math.PI / 360, ...prop(e, 'az') });
  param({ id: `edge.${k}.azHalf`, group: 'Edges', edge: k, label: `${e.name} · direction ±`, unit: 'deg', min: 0, max: 1.6, step: Math.PI / 360, ...prop(e, 'azHalf') });
  param({ id: `edge.${k}.speed`, group: 'Edges', edge: k, label: `${e.name} · speed`, unit: spd[0], min: spd[1], max: spd[2], step: (spd[2] - spd[1]) / 200, ...prop(e, 'speed') });
  param({ id: `edge.${k}.speedHalf`, group: 'Edges', edge: k, label: `${e.name} · speed ±`, unit: spd[0], min: 0, max: spd[2] / 2, step: spd[2] / 400, ...prop(e, 'speedHalf') });
  param({ id: `edge.${k}.elev`, group: 'Edges', edge: k, label: `${e.name} · launch angle`, unit: 'deg', min: -0.4, max: 1.4, step: Math.PI / 360, ...prop(e, 'elev') });
  param({ id: `edge.${k}.elevHalf`, group: 'Edges', edge: k, label: `${e.name} · launch angle ±`, unit: 'deg', min: 0, max: 0.6, step: Math.PI / 360, ...prop(e, 'elevHalf') });
}
const OUT = [
  ['missCoef', 'Poor fit → play and miss', 0, 2],
  ['missTimingRelief', 'Good timing saves a poor fit', 0, 1],
  ['missMove', 'Movement → miss (per m)', 0, 1],
  ['missFloor', 'Miss floor (subtracted)', 0, 0.3],
  ['wrongShotFit', 'Wrong-shape threshold (fit)', 0, 0.4],
  ['wrongShotMiss', 'Wrong shape → miss', 0, 1],
  ['edgeBase', 'Edge: base', 0, 0.2],
  ['edgeFit', 'Edge: poor fit', 0, 1.5],
  ['edgeMove', 'Edge: movement (per m)', 0, 1.5],
  ['edgeTiming', 'Edge: poor timing', 0, 1],
  ['defenceEdge', 'Edge: defence multiplier', 0, 1.5],
  ['loftEdge', 'Edge: lofted extra', 0, 0.3],
  ['drift', 'Timing drift (rad / s)', 0, 15],
  ['groundBase', 'Ground shot: base speed', 3, 20],
  ['groundQ', 'Ground shot: speed from quality', 0, 30],
  ['loftBase', 'Lofted: base speed', 3, 15],
  ['loftQ', 'Lofted: speed from quality', 0, 25],
  ['spread', 'Direction scatter (rad)', 0, 0.6],
  ['specialMiss', 'Specials: mistiming → miss', 0, 1],
  ['specialEdge', 'Specials: edge multiplier', 0.5, 3],
];
for (const [k, label, min, max] of OUT) param({ id: `k.${k}`, group: 'Outcomes', label, unit: '', min, max, step: (max - min) / 200, ...prop(K, k) });
const FLD = [
  ['reachStand', 'Catch reach, standing', 'm', 0.3, 1.6],
  ['reachDive', 'Reach, diving', 'm', 0.5, 3.5],
  ['reachGround', 'Pick-up reach', 'm', 0.2, 1.5],
  ['react', 'Fielder reaction', 's', 0, 1],
  ['runTime', 'Time per run', 's', 1.2, 3.5],
  ['throwSpeed', 'Throw speed', 'm/s', 10, 35],
];
for (const [k, label, unit, min, max] of FLD) param({ id: `fk.${k}`, group: 'Fielding & running', label, unit, min, max, step: (max - min) / 200, ...prop(FK, k) });
param({ id: 'scale.fielderSpeed', group: 'Fielding & running', label: 'Fielder speed', unit: '×', min: 0.5, max: 1.6, step: 0.01, ...prop(SCALES, 'fielderSpeedScale') });
param({ id: 'scale.catchSkill', group: 'Fielding & running', label: 'Catching skill', unit: '×', min: 0.5, max: 1.2, step: 0.01, ...prop(SCALES, 'catchSkillScale') });
param({ id: 'scale.pace', group: 'Bowling & read', label: 'Bowling pace', unit: '×', min: 0.6, max: 1.4, step: 0.01, ...prop(SCALES, 'paceScale') });
param({ id: 'scale.readZone', group: 'Bowling & read', label: 'Read: marker vagueness', unit: '×', min: 0, max: 3, step: 0.01, ...prop(SCALES, 'readZoneScale') });
param({ id: 'scale.readHide', group: 'Bowling & read', label: 'Read: hidden earlier', unit: '×', min: 0, max: 3, step: 0.01, ...prop(SCALES, 'readHideScale') });

const DEFAULTS = Object.fromEntries(PARAMS.map((p) => [p.id, p.get()]));
const EPS = 1e-9;
const clampP = (p, v) => Math.min(p.max, Math.max(p.min, +v));

// ------------------------------------------------------------------ state
const baked = typeof __CHASE_CALIBRATION__ !== 'undefined' ? __CHASE_CALIBRATION__ : null; // eslint-disable-line no-undef
const listeners = new Set();
const state = { dirty: false, log: [], savedAt: null, source: 'defaults' };
const emit = () => listeners.forEach((f) => f());

function readStore() {
  try {
    const raw = localStorage.getItem(STORE);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export const tuning = {
  PARAMS,
  byId,
  DEFAULTS,
  state,
  /** Code defaults, then these overrides. Idempotent. Unknown ids are ignored. */
  apply(params = {}) {
    for (const p of PARAMS) p.set(DEFAULTS[p.id]);
    for (const [id, v] of Object.entries(params)) if (byId[id] && Number.isFinite(+v)) byId[id].set(clampP(byId[id], v));
    recomputeDifficulty();
    emit();
  },
  get: (id) => byId[id].get(),
  /** Set one value (clamped). Returns { id, from, to }. */
  set(id, v, { quiet = false } = {}) {
    const p = byId[id];
    const from = p.get();
    const to = clampP(p, v);
    p.set(to);
    // Keep a shot's line band ordered.
    if (p.sub === 'line') {
      const s = SHOTS[p.shot];
      if (s.line[0] > s.line[1]) [s.line[0], s.line[1]] = [s.line[1], s.line[0]];
    }
    recomputeDifficulty();
    state.dirty = true;
    if (!quiet) emit();
    return { id, from, to };
  },
  reset(id) {
    if (id) return tuning.set(id, DEFAULTS[id]);
    tuning.apply({});
    state.dirty = true;
    emit();
  },
  current: () => Object.fromEntries(PARAMS.map((p) => [p.id, p.get()])),
  /** Only what differs from the code defaults. */
  overrides() {
    const o = {};
    for (const p of PARAMS) {
      const v = p.get();
      if (Math.abs(v - DEFAULTS[p.id]) > EPS) o[p.id] = +v.toFixed(6);
    }
    return o;
  },
  isChanged: (id) => Math.abs(byId[id].get() - DEFAULTS[id]) > EPS,
  /** Load what the next game should use: the browser's save, else the baked file. */
  init() {
    let stored = readStore();
    if (stored && stored.version !== VERSION) stored = null;
    // A save made before this baked file existed (or on an older one) gives way to it.
    if (stored && baked && stored.bakedHash !== baked.hash) {
      try {
        localStorage.setItem(STORE + '-superseded', JSON.stringify(stored));
        localStorage.removeItem(STORE);
      } catch {}
      state.superseded = true;
      stored = null;
    }
    const src = stored ?? baked;
    tuning.apply(src?.params ?? {});
    state.log = stored?.log ?? [];
    state.savedAt = stored?.savedAt ?? null;
    state.source = stored ? 'saved in this browser' : baked ? 'baked calibration.json' : 'defaults';
    state.dirty = false;
    emit();
  },
  save() {
    const doc = { version: VERSION, params: tuning.overrides(), savedAt: new Date().toISOString(), bakedHash: baked?.hash ?? null, log: state.log.slice(-500) };
    try {
      localStorage.setItem(STORE, JSON.stringify(doc));
    } catch {
      return false;
    }
    state.dirty = false;
    state.savedAt = doc.savedAt;
    state.source = 'saved in this browser';
    emit();
    return true;
  },
  /** Back to what is saved (or baked), dropping unsaved edits. */
  revert: () => tuning.init(),
  /** Forget the browser's save (the baked file, if any, applies again). */
  forget() {
    try {
      localStorage.removeItem(STORE);
    } catch {}
    tuning.init();
  },
  export: () => JSON.stringify({ version: VERSION, params: tuning.overrides(), exportedAt: new Date().toISOString(), log: state.log }, null, 2),
  import(text) {
    const doc = JSON.parse(text);
    if (doc.version !== VERSION || typeof doc.params !== 'object') throw new Error('not a Chase calibration file');
    tuning.apply(doc.params);
    if (Array.isArray(doc.log)) state.log = doc.log;
    state.dirty = true;
    emit();
  },
  /** Feedback and nudges, newest last (kept with the save, capped). */
  record(entry) {
    state.log.push(entry);
    emit();
  },
  onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  baked,
};
