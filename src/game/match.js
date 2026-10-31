import { GAME, DIFFICULTY, makeRng } from './rules.js';
import { buildDelivery, LINE_NAMES, LENGTH_NAMES, lengthOf, lineOf } from './delivery.js';
import { SHOTS, resolveShot, lawsCheck, shotFoot } from './batting.js';
import { simulateBatted } from './ballSim.js';
import { fieldPositions, resolveFielding } from './fielding.js';
import { setTarget, planOver, chooseDelivery, newMemory, remember, TYPES } from './bowlerAI.js';
import { resolveConditions, NEUTRAL } from './conditions.js';

/**
 * The scorebook and one-ball resolution, independent of any rendering. The
 * game controller (index.js) and the Node simulator (qa/game-sim.mjs) both
 * drive this.
 *
 *   const m = createMatch({ difficulty: 'medium', seed: 7 })
 *   m.startOver()                         plan + field for the over
 *   const ball = m.nextDelivery()         AI's spec + solved path
 *   const out = m.resolve(ball, input)    input: { shotKey, lofted, pressT } | null (leave)
 *   m.record(out)                         scorebook, strike, result
 */
export function createMatch({ difficulty = 'medium', seed = 1, nets = false, conditions = null } = {}) {
  const diff = DIFFICULTY[difficulty];
  const rng = makeRng(seed);
  const m = {
    difficulty,
    diff,
    rng,
    seed,
    target: 0,
    runs: 0,
    wkts: 0,
    balls: 0,
    extras: 0,
    fours: 0,
    sixes: 0,
    thisOver: [],
    log: [],
    result: null,
    plan: null,
    field: fieldPositions('attack'),
    memory: newMemory(),
    strikerIdx: 0, // which of the two batters at the crease is on strike
    nets, // practice: no target, no result
    cond: conditions ? resolveConditions(conditions) : NEUTRAL, // sky, wind, pitch, outfield
  };
  m.target = setTarget(diff, rng);

  m.ballsLeft = () => GAME.overs * GAME.ballsPerOver - m.balls;
  m.need = () => m.target - m.runs;
  m.overText = () => `${Math.floor(m.balls / 6)}.${m.balls % 6}`;

  m.startOver = () => {
    m.plan = planOver(m, m.memory, rng);
    m.field = fieldPositions(m.plan.field);
    m.thisOver = [];
    return m.plan;
  };

  /** The AI's next ball; `force` (QA) overrides any spec fields. */
  m.nextDelivery = (force = null) => {
    let spec = chooseDelivery(m, m.plan, m.memory, rng);
    if (force) {
      spec = { ...spec, ...force };
      spec.length = lengthOf(spec.lenM);
      spec.line = lineOf(spec.lineZ);
      spec.typeName = TYPES[spec.type]?.name ?? spec.typeName;
    }
    const del = buildDelivery(spec, diff.pace);
    return { spec, del };
  };

  /**
   * Everything about one ball, decided at once. `input` is null for a leave
   * (no key pressed before the ball passed). Returns the outcome with the
   * batted path and the fielding resolution when the bat hit it.
   */
  m.resolve = ({ spec, del }, input) => {
    const o = { spec, wide: del.isWide, runs: 0, extras: 0, out: null, shot: null, sim: null, fielding: null, legal: true };
    if (del.isWide) {
      o.extras = 1;
      o.legal = false;
    }
    if (!input) {
      const law = lawsCheck(del, 'stance');
      o.kind = 'leave';
      o.foot = 'stance';
      o.out = del.isWide ? null : law.out;
      o.pad = law.pad;
      o.call = o.out ? (o.out === 'bowled' ? 'BOWLED' : 'LBW') : del.isWide ? 'WIDE' : law.pad ? law.call : 'Left alone';
      return o;
    }
    const shot = resolveShot({ del, shotKey: input.shotKey, lofted: input.lofted, pressT: input.pressT, diff, rng });
    o.shot = shot;
    o.foot = shot.foot;
    o.tContact = shot.tContact;
    if (shot.kind === 'miss') {
      const law = lawsCheck(del, shot.foot);
      o.kind = 'miss';
      o.out = del.isWide ? null : law.out;
      o.pad = law.pad;
      o.call = o.out ? (o.out === 'bowled' ? 'BOWLED' : 'LBW') : del.isWide ? 'WIDE' : shot.call;
      return o;
    }
    if (shot.kind === 'playedOn') {
      o.kind = 'playedOn';
      o.out = 'bowled';
      o.call = 'PLAYED ON';
      return o;
    }
    // Off the bat.
    o.kind = 'hit';
    const p0 = del.contactPos(shot.foot);
    const sim = simulateBatted(p0, shot, { wind: m.cond.wind, roll: m.cond.roll });
    o.sim = sim;
    o.contactPos = p0;
    // Where everyone actually is at contact (the controller fills m.live), not just their spots.
    const live = m.live ?? {};
    const field = m.field.map((f) => (live[f.id] ? { ...f, x: live[f.id][0], z: live[f.id][1] } : f));
    const fld = resolveFielding(sim, field, diff, rng, { noRuns: shot.shotKey === 'defence' && shot.q < 0.5, keeperAt: live.keeper });
    o.fielding = fld;
    if (fld.type === 'catch') {
      o.out = 'caught';
      o.call = fld.by === 'keeper' ? 'CAUGHT BEHIND' : `CAUGHT · ${fld.name}`;
    } else if (fld.type === 'boundary') {
      o.runs = fld.runs;
      o.call = fld.six ? 'SIX' : 'FOUR';
    } else {
      o.runs = fld.runs;
      o.call = fld.type === 'drop' ? `DROPPED · ${fld.name}` : o.runs === 0 ? 'No run' : o.runs === 1 ? '1 run' : `${o.runs} runs`;
    }
    return o;
  };

  m.record = (o) => {
    const total = o.runs + o.extras;
    m.runs += total;
    m.extras += o.extras;
    if (o.legal) m.balls++;
    if (o.out) m.wkts++;
    if (o.runs === 4 && o.fielding?.four) m.fours++;
    if (o.runs === 6) m.sixes++;
    const mark = o.out ? 'W' : o.wide ? 'wd' : String(total);
    m.thisOver.push(mark);
    m.log.push({ over: m.overText(), spec: o.spec, call: o.call, runs: total, out: o.out, shot: o.shot?.shotKey ?? null, timing: o.shot?.timing ?? null });
    remember(m.memory, o.spec, o.runs, !!o.out);
    // Strike: odd runs change ends; the new batter takes strike after a wicket.
    if (!o.out && o.runs % 2 === 1) m.strikerIdx ^= 1;
    const overEnd = o.legal && m.balls % GAME.ballsPerOver === 0;
    if (overEnd) m.strikerIdx ^= 1;
    if (m.nets) return { overEnd, result: null };
    if (m.runs >= m.target) m.result = 'won';
    else if (m.wkts >= GAME.wickets || m.balls >= GAME.overs * GAME.ballsPerOver) m.result = m.runs === m.target - 1 ? 'tied' : 'lost';
    return { overEnd, result: m.result };
  };

  return m;
}

/** HUD text for a delivery. */
export function describeDelivery(spec) {
  return `${spec.kph} km/h ${spec.typeName.toUpperCase()} · ${LENGTH_NAMES[spec.length]}, ${LINE_NAMES[spec.line]}`;
}

export { SHOTS, shotFoot };
