import { tuning } from '../src/game/tuning.js';
import { nudges } from '../src/game/tuner.js';
import { K, SHOTS, EDGES } from '../src/game/batting.js';
import { DIFFICULTY } from '../src/game/rules.js';

/**
 * Unit checks for the calibration core (Node). Exit 1 on failure.
 *   node qa/game-tuning.mjs
 */
let fail = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) fail++; };
const w = DIFFICULTY.medium.window;
const base = { rawErr: 0, err: 0, sigma: w.sigma, perfect: w.perfect, miss: w.miss, timing: 'PERFECT', kind: 'hit', edge: null, fit: 0.9, shotKey: 'cover', lofted: false, length: 'full', ballZ: 0.25, out: null, fieldType: 'field', runs: 1, q: 0.8 };
const run = (sample, answers) => { const ch = []; for (const n of nudges(sample, answers, tuning.get)) ch.push({ ...tuning.set(n.id, n.to, { quiet: true }), reason: n.reason }); return ch; };

// 1. "Felt right" at +40 ms raw, 8 times -> offset converges toward 40 ms.
tuning.apply({});
for (let i = 0; i < 8; i++) {
  const off = tuning.get('timing.offsetMs') / 1000;
  run({ ...base, rawErr: 0.04, err: 0.04 - off, timing: Math.abs(0.04 - off) <= w.perfect ? 'PERFECT' : 'LATE' }, { timing: 0, outcome: null, ideal: null });
}
const off = tuning.get('timing.offsetMs');
check(off > 30 && off <= 45, `8 x "right" at +40 ms -> offset ${off.toFixed(1)} ms (want 30..45)`);

// 2. Outcome feel on an edge moves the edge coefficients the right way.
tuning.apply({});
const e0 = [K.edgeTiming, K.edgeFit];
run({ ...base, edge: 'outside' }, { timing: null, outcome: -1, ideal: null });
check(K.edgeTiming < e0[0] && K.edgeFit < e0[1], `"too harsh" on an edge lowers edgeTiming ${e0[0]} -> ${K.edgeTiming.toFixed(4)}, edgeFit ${e0[1]} -> ${K.edgeFit.toFixed(4)}`);
tuning.apply({});
run({ ...base, edge: 'outside' }, { timing: null, outcome: 1, ideal: null });
check(K.edgeTiming > e0[0] && K.edgeFit > e0[1], '"too kind" on an edge raises them');

// 3. Ideal shot raises that cell and widens its line band toward the ball.
tuning.apply({});
const c0 = SHOTS.cut.len.full;
const a0 = SHOTS.cut.line[0];
run({ ...base, shotKey: 'cover', length: 'full', ballZ: 0.1 }, { timing: null, outcome: null, ideal: 'cut' });
check(SHOTS.cut.len.full > c0 && SHOTS.cut.line[0] < a0, `ideal "cut" for a full ball: cell ${c0} -> ${SHOTS.cut.len.full.toFixed(2)}, line from ${a0} -> ${SHOTS.cut.line[0].toFixed(2)}`);

// 3b. Direction: a clean cover drive that went 20° squarer than wanted moves the aim straighter;
// with "timing right" and the drag responsible, the drag shrinks too.
tuning.apply({});
const aim0 = SHOTS.cover.az;
const D20 = (20 * Math.PI) / 180;
run({ ...base, shotKey: 'cover', az: aim0, aimAz: aim0, driftAz: 0, scatter: 0 }, { timing: null, outcome: null, ideal: [], good: [], dir: aim0 - 2 * D20 });
check(SHOTS.cover.az < aim0 && aim0 - SHOTS.cover.az <= 0.14 + 1e-9, `aim moves toward where you said, capped (${((aim0 * 180) / Math.PI).toFixed(1)}° -> ${((SHOTS.cover.az * 180) / Math.PI).toFixed(1)}°)`);
tuning.apply({});
const sp0 = tuning.get('k.spread');
run({ ...base, shotKey: 'cover', az: aim0 + D20, aimAz: aim0, driftAz: 0, scatter: D20 }, { timing: null, outcome: null, ideal: [], good: [], dir: aim0 });
check(tuning.get('k.spread') < sp0 && SHOTS.cover.az === aim0, `scatter to blame -> spread ${sp0} -> ${tuning.get('k.spread').toFixed(3)}, aim unchanged`);
tuning.apply({});
const dr0 = SHOTS.cover.drift;
run({ ...base, shotKey: 'cover', az: aim0 - 0.2, aimAz: aim0, driftAz: -0.2, scatter: 0 }, { timing: 0, outcome: null, ideal: [], good: [], dir: aim0 });
check(SHOTS.cover.drift < dr0, `timing felt right + drag to blame -> drift ${dr0} -> ${SHOTS.cover.drift.toFixed(2)}`);
tuning.apply({});
run({ ...base, shotKey: 'cover', az: null, aimAz: aim0, driftAz: 0 }, { timing: null, outcome: null, ideal: [], good: [], dir: 0.2 });
check(SHOTS.cover.az === aim0, 'no direction change for edges and misses (no clean shot to learn from)');

// 3c. Power and trajectory on a clean hit; nothing from an edge.
tuning.apply({});
const pw0 = SHOTS.cover.power;
run({ ...base, shotKey: 'cover', az: 0.7, aimAz: 0.7 }, { timing: null, outcome: null, ideal: [], good: [], dir: null, power: -1, height: -1 });
check(SHOTS.cover.power > pw0 && SHOTS.cover.elev > 0, `"too soft" + "too flat" -> power ${pw0} -> ${SHOTS.cover.power.toFixed(3)}, launch ${((SHOTS.cover.elev * 180) / Math.PI).toFixed(1)}°`);
tuning.apply({});
run({ ...base, shotKey: 'cover', az: 0.7, aimAz: 0.7, lofted: true }, { timing: null, outcome: null, ideal: [], good: [], dir: null, power: 1, height: 1 });
check(SHOTS.cover.power < pw0 && SHOTS.cover.elev < -0.05, `"too hard" + "too high" (lofted) -> power ${SHOTS.cover.power.toFixed(3)}, launch ${((SHOTS.cover.elev * 180) / Math.PI).toFixed(1)}°`);
tuning.apply({});
run({ ...base, shotKey: 'cover', az: null, edge: 'outside' }, { timing: null, outcome: null, ideal: [], good: [], dir: null, power: 1, height: 1 });
check(SHOTS.cover.power === pw0 && SHOTS.cover.elev === 0, 'no power or trajectory change from an edge');

// 3d. Spread: too wide narrows the scatter (and this shot's drag); too narrow widens them.
tuning.apply({});
const sp1 = tuning.get('k.spread');
run({ ...base, shotKey: 'cover', az: 0.7, aimAz: 0.7 }, { timing: null, outcome: null, ideal: [], good: [], dir: null, spread: 1 });
check(tuning.get('k.spread') < sp1 && SHOTS.cover.drift < 1, `"too wide" -> scatter ${sp1} -> ${tuning.get('k.spread').toFixed(3)}, cover drag 1 -> ${SHOTS.cover.drift.toFixed(2)}`);
tuning.apply({});
run({ ...base, shotKey: 'cover', az: 0.7, aimAz: 0.7 }, { timing: null, outcome: null, ideal: [], good: [], dir: null, spread: -1 });
check(tuning.get('k.spread') > sp1 && SHOTS.cover.drift > 1, '"too narrow" widens them');

// 3e. Edges: the answers tune that kind of edge, not the shot.
tuning.apply({});
const E0 = { ...EDGES.outside };
const pwC = SHOTS.cover.power;
run({ ...base, shotKey: 'cover', edge: 'outside', az: E0.az, aimAz: E0.az, driftAz: 0, scatter: 0 }, { timing: null, outcome: null, ideal: [], good: [], dir: E0.az - 0.4, power: -1, height: 1, spread: 1 });
check(EDGES.outside.speed > E0.speed && EDGES.outside.elev < E0.elev && EDGES.outside.azHalf < E0.azHalf && EDGES.outside.az < E0.az && SHOTS.cover.power === pwC,
  `outside edge: speed ${E0.speed} -> ${EDGES.outside.speed.toFixed(3)}, angle ${((E0.elev * 180) / Math.PI).toFixed(1)}° -> ${((EDGES.outside.elev * 180) / Math.PI).toFixed(1)}°, range ±${((E0.azHalf * 180) / Math.PI).toFixed(1)}° -> ±${((EDGES.outside.azHalf * 180) / Math.PI).toFixed(1)}°, direction moved; cover drive untouched`);
tuning.apply({});
const T0 = EDGES.top.az;
run({ ...base, shotKey: 'pull', edge: 'top', az: -T0, aimAz: -T0, driftAz: 0, scatter: 0 }, { timing: null, outcome: null, ideal: [], good: [], dir: -(T0 + 0.5) });
check(EDGES.top.az > T0, `top edge (either side): asking for squarer moves its distance from straight ${((T0 * 180) / Math.PI).toFixed(0)}° -> ${((EDGES.top.az * 180) / Math.PI).toFixed(0)}°`);

// 4. Bounds: hammer one rule; values stay in range.
tuning.apply({});
for (let i = 0; i < 300; i++) run({ ...base, edge: 'outside' }, { timing: null, outcome: -1, ideal: 'pull' });
for (let i = 0; i < 300; i++) run({ ...base, rawErr: 0.5, err: 0.5 }, { timing: -1, outcome: null, ideal: null });
const outOfRange = tuning.PARAMS.filter((p) => p.get() < p.min - 1e-9 || p.get() > p.max + 1e-9).map((p) => p.id);
check(outOfRange.length === 0, `every value within its range after 600 nudges${outOfRange.length ? ': ' + outOfRange.join(', ') : ''}`);

// 5. Export -> import round trip; reset restores defaults exactly; apply is idempotent.
const snap = tuning.current();
const text = tuning.export();
tuning.apply({});
tuning.import(text);
const back = tuning.current();
check(Object.keys(snap).every((k) => Math.abs(snap[k] - back[k]) < 1e-5), 'export -> import round-trips every value');
tuning.reset();
const defs = tuning.current();
check(Object.keys(defs).every((k) => defs[k] === tuning.DEFAULTS[k]), 'reset restores the defaults exactly');
const o = { 'k.missCoef': 0.7, 'scale.pace': 1.1, 'timing.windowScale': 1.2 };
tuning.apply(o);
const once = JSON.stringify([tuning.current(), DIFFICULTY]);
tuning.apply(o);
check(once === JSON.stringify([tuning.current(), DIFFICULTY]), 'apply() twice equals apply() once (scales never compound)');
check(Math.abs(DIFFICULTY.medium.window.sigma - 0.048 * 1.2) < 1e-12, `window scale applies to the level table (sigma ${DIFFICULTY.medium.window.sigma.toFixed(4)})`);
tuning.apply({});
check(DIFFICULTY.medium.window.sigma === 0.048 && DIFFICULTY.medium.pace === 0.72, 'defaults restore the level table');

console.log(fail ? `${fail} check(s) failed` : 'all tuning checks passed');
process.exit(fail ? 1 : 0);
