import { createMatch } from '../src/game/match.js';
import { SHOTS, shotFoot, shotFor } from '../src/game/batting.js';
import { buildDelivery } from '../src/game/delivery.js';
import { TYPES } from '../src/game/bowlerAI.js';
import { readFileSync } from 'node:fs';
import { tuning } from '../src/game/tuning.js';

// CAL=calibration.json runs with a calibration applied (default: code defaults).
if (process.env.CAL) {
  tuning.apply(JSON.parse(readFileSync(process.env.CAL, 'utf8')).params);
  console.log(`using calibration ${process.env.CAL}: ${Object.keys(tuning.overrides()).length} values differ from defaults`);
}

/**
 * Rule checks for the Chase outcome model (Node, no browser). Each case bowls
 * the same forced delivery many times with a scripted input and checks the
 * share of outcomes. Exit code 1 if any check fails.
 *
 *   node qa/game-rules.mjs
 */
const N = 300;
const base = { kph: 138, swing: 0, seam: 0, hStumps: 0.45 };
function trial(force, input, difficulty = 'medium') {
  const tally = {};
  const azs = [];
  for (let i = 1; i <= N; i++) {
    const m = createMatch({ difficulty, seed: 1000 + i });
    m.startOver();
    const ball = m.nextDelivery({ ...base, ...force });
    let inp = null;
    if (input) {
      const sh = SHOTS[input.shot];
      const tC = ball.del.contactTime(shotFoot(sh, ball.del));
      inp = { shotKey: input.shot, lofted: !!input.lofted, pressT: tC - sh.swing + (sh.bias ?? 0) + (input.err ?? 0) };
      azs.push(null);
    }
    const o = m.resolve(ball, inp);
    if (o.kind === 'hit' && !o.shot.edge) azs[azs.length - 1] = (o.shot.az * 180) / Math.PI;
    const k = o.out ? o.out : o.shot?.edge ? `edge:${o.shot.edge}` : o.kind === 'miss' ? 'beaten' : o.runs >= 4 ? 'boundary' : o.kind === 'hit' ? 'hit' : 'safe';
    tally[k] = (tally[k] ?? 0) + 1;
  }
  const p = (k) => (Array.isArray(k) ? k : [k]).reduce((a, x) => a + (tally[x] ?? 0), 0) / N;
  const az = azs.filter((x) => x !== null);
  p.az = { mean: az.reduce((a, b) => a + b, 0) / Math.max(1, az.length), sd: Math.sqrt(az.reduce((a, b) => a + b * b, 0) / Math.max(1, az.length) - (az.reduce((a, b) => a + b, 0) / Math.max(1, az.length)) ** 2) };
  return p;
}

const FULL_OFF = { type: 'outswinger', lenM: 2.8, lineZ: 0.24, hStumps: 0.42, swing: 0.05 };
let cases = [
  ['perfect cover drive, full outside off -> mostly hit, often a boundary', trial(FULL_OFF, { shot: 'cover' }), (p) => p(['hit', 'boundary']) > 0.75 && p('boundary') > 0.25],
  ['perfect lofted cover drive -> boundaries (incl. sixes) > 35%', trial(FULL_OFF, { shot: 'cover', lofted: true }), (p) => p('boundary') > 0.35],
  ['leave, straight full ball on off/middle -> bowled or LBW every time', trial({ type: 'inswinger', lenM: 3.0, lineZ: 0.05, hStumps: 0.4, swing: -0.1 }, null), (p) => p(['bowled', 'lbw']) === 1],
  ['leave, wide outswinger -> safe', trial({ type: 'outswinger', lenM: 5.2, lineZ: 0.55, hStumps: 0.7, swing: 0.25 }, null), (p) => p('safe') === 1],
  ['late drive (+90 ms) at a big outswinger -> edges/misses > 45%', trial({ type: 'outswinger', lenM: 5.0, lineZ: 0.28, hStumps: 0.7, swing: 0.3 }, { shot: 'cover', err: 0.09 }), (p) => p(['edge:outside', 'edge:inside', 'beaten', 'caught']) > 0.45],
  ['perfect pull to a bouncer -> mostly middled', trial({ type: 'bouncer', lenM: 10.0, lineZ: 0.02, hStumps: 1.6 }, { shot: 'pull' }), (p) => p(['hit', 'boundary']) > 0.6],
  ['pull to a yorker on the stumps -> beaten/out/edged > 60%', trial({ type: 'yorker', lenM: 1.0, lineZ: 0.0, hStumps: 0.12 }, { shot: 'pull' }), (p) => p(['beaten', 'bowled', 'lbw', 'edge:inside', 'edge:outside', 'edge:top', 'caught']) > 0.6],
  ['way early (-200 ms) straight drive -> beaten', trial({ type: 'outswinger', lenM: 3.0, lineZ: 0.3, hStumps: 0.45 }, { shot: 'straight', err: -0.2 }), (p) => p(['beaten', 'bowled', 'lbw']) === 1],
  ['forward defence to good length on the stumps -> rarely out (< 12%)', trial({ type: 'outswinger', lenM: 5.3, lineZ: 0.05, hStumps: 0.7, swing: 0.15 }, { shot: 'defence' }), (p) => p(['bowled', 'lbw', 'caught']) < 0.12],
  ['perfect cover drives scatter round the aim (sd 2-12 deg)', trial(FULL_OFF, { shot: 'cover' }), (p) => p.az.sd > 2 && p.az.sd < 12],
  ['early (-40 ms) cover drive is dragged leg-side of perfect', trial(FULL_OFF, { shot: 'cover', err: -0.04 }), (p) => p.az.mean < 32],
  ['perfect pull to a short ball stays square (mean -100..-75 deg)', trial({ type: 'bouncer', lenM: 8.3, lineZ: 0.0, hStumps: 1.15 }, { shot: 'pull' }), (p) => p.az.mean > -100 && p.az.mean < -75],
  ['late cut guides to third man (mean 140..175 deg)', trial({ type: 'legcutter', lenM: 7.5, lineZ: 0.4, hStumps: 1.0, seam: 0.05 }, { shot: 'lateCut' }), (p) => p.az.mean > 140 && p.az.mean < 175],
  ['perfect sweep to a full ball at the pads -> mostly hit', trial({ type: 'offcutter', lenM: 3.4, lineZ: -0.15, hStumps: 0.45 }, { shot: 'sweep' }), (p) => p(['hit', 'boundary']) > 0.6],
  ['sweep 45 ms late at the stumps -> beaten/out/edged > 45% (tight window)', trial({ type: 'offcutter', lenM: 3.4, lineZ: 0.0, hStumps: 0.45 }, { shot: 'sweep', err: 0.045 }), (p) => p(['beaten', 'bowled', 'lbw', 'caught', 'edge:top', 'edge:inside', 'edge:outside']) > 0.45],
  ['the same 45 ms late on a drive is forgiving (< 35% bad)', trial({ type: 'outswinger', lenM: 2.8, lineZ: 0.1, hStumps: 0.42 }, { shot: 'straight', err: 0.045 }), (p) => p(['beaten', 'bowled', 'lbw', 'caught', 'edge:top', 'edge:inside', 'edge:outside']) < 0.35],
  ['perfect scoop to a full straight ball -> over the keeper (|az| > 160)', trial({ type: 'yorker', lenM: 2.6, lineZ: 0.02, hStumps: 0.35 }, { shot: 'scoop' }), (p) => Math.abs(p.az.mean) > 160],
  ['reverse sweep goes to the off side behind square (mean 90..135 deg)', trial({ type: 'offcutter', lenM: 3.6, lineZ: 0.25, hStumps: 0.45 }, { shot: 'reverseSweep' }), (p) => p.az.mean > 90 && p.az.mean < 135],
  ['perfect flick to a full ball at the pads -> mostly hit, to midwicket (az -80..-45)', trial({ type: 'inswinger', lenM: 3.2, lineZ: -0.15, hStumps: 0.45, swing: -0.1 }, { shot: 'flick' }), (p) => p(['hit', 'boundary']) > 0.75 && p.az.mean > -80 && p.az.mean < -45],
  ['the pull to that same full ball mostly fails', trial({ type: 'inswinger', lenM: 3.2, lineZ: -0.15, hStumps: 0.45, swing: -0.1 }, { shot: 'pull' }), (p) => p(['hit', 'boundary']) < 0.4],
];
// The pull key: a flick to a fuller ball, a pull to a short one.
const delAt = (lenM) => buildDelivery({ type: 'outswinger', kph: 138, lenM, lineZ: 0, hStumps: 0.6, swing: 0, seam: 0, length: 'good' }, 0.72);
const keyCases = [[2.5, 'flick'], [5.5, 'flick'], [6.5, 'pull'], [9.0, 'pull']];
for (const [len, want] of keyCases) cases.push([`-> key on a ball pitching ${len} m out plays the ${want}`, () => 0, () => shotFor('R', false, delAt(len)) === want]);
cases.push(['S with -> is still the sweep', () => 0, () => shotFor('R', true, delAt(3)) === 'sweep']);
// The straight ball barely moves.
const T = TYPES.straight;
cases.push([`straight ball: swing ${T.swing.join('..')} m, seam ${T.seam.join('..')} m`, () => 0, () => Math.max(...T.swing.map(Math.abs), ...T.seam.map(Math.abs)) <= 0.03]);
let fail = 0;
for (const [name, p, ok] of cases) {
  const pass = ok(p);
  if (!pass) fail++;
  const show = !p.az ? '' : ['hit', 'boundary', 'caught', 'bowled', 'lbw', 'beaten', 'edge:outside', 'edge:inside', 'edge:top', 'safe'].map((k) => `${k} ${(p(k) * 100).toFixed(0)}`).filter((s) => !s.endsWith(' 0')).join(', ');
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}\n       ${show}${p.az && p.az.sd ? ` | az ${p.az.mean.toFixed(0)} deg sd ${p.az.sd.toFixed(1)}` : ''}`);
}
console.log(fail ? `${fail} rule check(s) failed` : 'all rule checks passed');
process.exit(fail ? 1 : 0);
