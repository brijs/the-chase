import { createMatch } from '../src/game/match.js';
import { SHOTS, shotFit, shotFoot } from '../src/game/batting.js';
import { makeRng } from '../src/game/rules.js';
import { readFileSync } from 'node:fs';
import { tuning } from '../src/game/tuning.js';

// CAL=calibration.json runs with a calibration applied (default: code defaults).
if (process.env.CAL) {
  tuning.apply(JSON.parse(readFileSync(process.env.CAL, 'utf8')).params);
  console.log(`using calibration ${process.env.CAL}: ${Object.keys(tuning.overrides()).length} values differ from defaults`);
}

/**
 * Monte Carlo of the Chase outcome model, no browser. Plays whole matches with
 * bots of different skill and prints how the game balances: win rate, score,
 * wickets, and what happens per ball.
 *
 *   GAMES=400 node qa/game-sim.mjs
 *
 * Bots:
 *   good    picks the best-fitting shot, leaves balls missing the stumps when
 *           nothing fits, timing error ~ N(0, 28 ms), lofts the very best fits late on
 *   average same choices but timing ~ N(0, 50 ms) and the wrong shot 25% of the time
 *   slogger always plays, lofts everything, timing ~ N(0, 45 ms)
 */
const GAMES = +(process.env.GAMES || 300);
// COND='{"sky":"overcast","pitch":"green"}' plays every game in those conditions.
const COND = process.env.COND ? JSON.parse(process.env.COND) : null;
if (COND) console.log('conditions', JSON.stringify(COND));
// UMP=0.25 plays with an umpire who gets close calls wrong (and no reviews).
const UMP = process.env.UMP ? { bad: +process.env.UMP, drs: false } : null;
if (UMP) console.log('umpire error', UMP.bad);
const gauss = (r) => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());

function bot(kind, r) {
  const sd = { perfect: 0.0, good: 0.028, average: 0.05, slogger: 0.045 }[kind];
  return (m, ball) => {
    const { del } = ball;
    let best = null;
    for (const k of Object.keys(SHOTS).filter((k) => !SHOTS[k].special)) {
      const f = shotFit(SHOTS[k], del, shotFoot(SHOTS[k], del));
      const score = f * SHOTS[k].power * (k === 'defence' ? 0.45 : 1);
      if (!best || score > best.score) best = { k, f, score };
    }
    if (kind === 'average' && r() < 0.25) best.k = Object.keys(SHOTS)[Math.floor(r() * 9)];
    if (kind !== 'slogger' && best.f < 0.35 && !del.hitsStumps && !del.padImpact('stance')) return null;
    const shot = SHOTS[best.k];
    const tC = del.contactTime(shotFoot(shot, del));
    const pressT = tC - shot.swing + (shot.bias ?? 0) + gauss(r) * sd;
    const rr = m.need() / Math.max(1, m.ballsLeft() / 6);
    const lofted = kind === 'slogger' ? best.k !== 'defence' : best.f > 0.85 && best.k !== 'defence' && (rr > 10 || r() < 0.25);
    return { shotKey: best.k, lofted, pressT };
  };
}

function play(difficulty, kind, seed) {
  const m = createMatch({ difficulty, seed, conditions: COND, umpire: UMP });
  const r = makeRng(seed * 7 + 3);
  const b = bot(kind, r);
  const tally = {};
  m.startOver();
  while (!m.result) {
    const ball = m.nextDelivery();
    const o = m.resolve(ball, b(m, ball));
    const key = o.out ? `out:${o.out}${o.fielding?.by ? ':' + (o.fielding.by.startsWith('slip') || o.fielding.by === 'keeper' ? 'behind' : 'field') : ''}` : o.wide ? 'wide' : `r${o.runs}`;
    tally[key] = (tally[key] ?? 0) + 1;
    const { overEnd } = m.record(o);
    if (overEnd && !m.result) m.startOver();
  }
  return { m, tally };
}

for (const difficulty of ['easy', 'medium', 'hard']) {
  for (const kind of ['perfect', 'good', 'average', 'slogger']) {
    let wins = 0, runs = 0, wk = 0, balls = 0, target = 0;
    const tally = {};
    for (let g = 1; g <= GAMES; g++) {
      const { m, tally: t } = play(difficulty, kind, g);
      if (m.result === 'won') wins++;
      runs += m.runs; wk += m.wkts; balls += m.balls; target += m.target;
      for (const k in t) tally[k] = (tally[k] ?? 0) + t[k];
    }
    const nBalls = Object.values(tally).reduce((a, b) => a + b, 0);
    const pct = (k) => ((100 * (tally[k] ?? 0)) / nBalls).toFixed(1);
    const outs = Object.keys(tally).filter((k) => k.startsWith('out')).map((k) => `${k.slice(4)} ${pct(k)}`).join(', ');
    console.log(
      `${difficulty.padEnd(6)} ${kind.padEnd(8)} win ${((100 * wins) / GAMES).toFixed(0).padStart(3)}%  ` +
        `target ${(target / GAMES).toFixed(1)}  score ${(runs / GAMES).toFixed(1)}/${(wk / GAMES).toFixed(1)} in ${(balls / GAMES).toFixed(1)}b  | ` +
        `dot ${pct('r0')} 1s ${pct('r1')} 2s ${pct('r2')} 3s ${pct('r3')} 4s ${pct('r4')} 6s ${pct('r6')} wd ${pct('wide')} | out: ${outs}`
    );
  }
}
