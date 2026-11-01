import { STRIKER, OVAL, KEEPER_HOME, KEEPER_AT_STUMPS, ellipseK, rayToEllipse, insideRing } from './rules.js';

/**
 * Field settings and who gets to the ball.
 *
 * A preset is nine positions for slip1, slip2 and f1..f7 (the keeper and the
 * bowler are fixed), given as [name, azimuth deg, distance from the striker]
 * with 'deep' meaning 1.6 m inside the rope. Positions are clamped inside the
 * rope, so the same preset works for any oval.
 */
export const FIELDER_IDS = ['slip1', 'slip2', 'f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7'];

export const FIELD_PRESETS = {
  attack: [
    ['1st slip', 166, 8.5],
    ['2nd slip', 158, 8.7],
    ['Gully', 132, 9.6],
    ['Point', 92, 12.5],
    ['Cover', 52, 13.5],
    ['Mid-off', 16, 14.5],
    ['Mid-on', -16, 14.5],
    ['Square leg', -96, 12.5],
    ['Fine leg', -150, 'deep'],
  ],
  balanced: [
    ['1st slip', 166, 8.5],
    ['Third man', 140, 'deep'],
    ['Point', 96, 13.0],
    ['Cover', 50, 14.0],
    ['Mid-off', 14, 15.0],
    ['Mid-on', -14, 15.0],
    ['Midwicket', -56, 14.0],
    ['Square leg', -100, 13.0],
    ['Fine leg', -152, 'deep'],
  ],
  death: [
    ['Short third', 145, 11.0],
    ['Deep point', 98, 'deep'],
    ['Deep cover', 46, 'deep'],
    ['Long-off', 12, 'deep'],
    ['Long-on', -12, 'deep'],
    ['Deep midwicket', -52, 'deep'],
    ['Deep square', -98, 'deep'],
    ['Fine leg', -152, 'deep'],
    ['Cover', 60, 13.0],
  ],
};

/** Deep fielders brought up to save one when the restrictions bite, first to last, and what they become. */
const BRING_IN = [['Deep cover', 'Cover'], ['Deep point', 'Point'], ['Deep midwicket', 'Midwicket'], ['Long-on', 'Mid-on'], ['Long-off', 'Mid-off'], ['Deep square', 'Square leg'], ['Third man', 'Short third'], ['Fine leg', 'Short fine leg']];

/**
 * The field for a preset. opts.maxOut: how many may stand outside the circle
 * (the fielding restrictions); the rest of the deep ones come up to save one,
 * in BRING_IN order. Ring fielders always stand inside it. Each fielder
 * carries `out` (outside the circle).
 */
export function fieldPositions(preset, { maxOut = Infinity } = {}) {
  const deep = FIELD_PRESETS[preset].filter(([, , d]) => d === 'deep').map(([n]) => n);
  const bring = new Set(BRING_IN.map(([n]) => n).filter((n) => deep.includes(n)).slice(0, Math.max(0, deep.length - maxOut)));
  return FIELD_PRESETS[preset].map(([name0, azDeg, d0], i) => {
    const az = (azDeg * Math.PI) / 180;
    const maxD = rayToEllipse(STRIKER.x, STRIKER.z, az, OVAL.rope) - 1.6;
    // Just inside the circle along this line.
    const ringD = rayToEllipse(STRIKER.x, STRIKER.z, az, OVAL.ring) - 0.8;
    let name = name0;
    let d = d0;
    if (bring.has(name0)) {
      name = BRING_IN.find(([n]) => n === name0)[1];
      d = Math.min(14, ringD);
    }
    const dist = d === 'deep' ? maxD : Math.min(d, maxD, ringD);
    const x = STRIKER.x + Math.cos(az) * dist;
    const z = STRIKER.z + Math.sin(az) * dist;
    // Facing the batter.
    const yaw = Math.atan2(STRIKER.x - x, STRIKER.z - z);
    return { id: FIELDER_IDS[i], name, x, z, yaw, out: !insideRing(x, z) };
  });
}

/** Fielding and running constants. Tunable (src/game/tuning.js), read at use. */
export const FK = {
  reachStand: 0.85, // m: a catch without moving the feet
  reachDive: 2.4, // 1.4 m of glide + ~1.0 m of arms (measured on the dive pose)
  reachGround: 0.6,
  react: 0.32, // s before a fielder moves
  runTime: 1.95, // s per run between the wickets
  throwSpeed: 21, // m/s
};

function runTime(d, speed) {
  if (d <= 0.02) return 0;
  return d / speed + 0.3 * Math.min(1, d / 3);
}

/**
 * Who stops it and when. `fielders` is [{ id, name, x, z }]; the keeper is
 * added here. Times are seconds after contact.
 *
 * Returns { type, by, name, t, at, dive, tGather, tThrow, tArrive, runs,
 *           four, six, retrieve }   type: catch | drop | field | boundary | lost
 */
export function resolveFielding(sim, fielders, diff, rng, opts = {}) {
  const speed = diff.fielderSpeed;
  const all = [
    ...fielders.map((f) => ({ ...f, speed, react: FK.react, skill: diff.catchSkill * (f.id.startsWith('slip') ? 0.93 : 1) })),
    { id: 'keeper', name: 'the keeper', x: opts.keeperAt?.[0] ?? KEEPER_HOME.x, z: opts.keeperAt?.[1] ?? KEEPER_HOME.z, speed: speed * 0.75, react: 0.12, skill: Math.min(0.99, diff.catchSkill + 0.05) },
  ];
  // For each fielder, the earliest point he reaches the ball at each level of
  // effort; he takes the easiest one that is not much later than the hardest.
  //   set      there early, waiting (gather / long barrier / settle under it)
  //   run      takes it on the move
  //   stretch  a lunging catch, one step out          (catches)
  //   slide    a slide on the hip to cut it off       (along the ground)
  //   dive     full length
  const S = sim.samples;
  let best = null;
  const EFFORT_COST = { set: -0.05, run: 0, stretch: 0.3, slide: 0.35, dive: 0.6 };
  for (const f of all) {
    const first = {};
    for (let i = 1; i < S.length; i++) {
      const s = S[i];
      if (s.gone) break;
      if (ellipseK(s.x, s.z, OVAL.rope) >= 1) break; // past the rope: boundary
      const avail = s.t - f.react;
      if (avail <= 0) continue;
      const d = Math.hypot(s.x - f.x, s.z - f.z);
      const canCatch = s.air && s.y > 0.12 && s.y < 2.45;
      const low = !s.air || s.y < 0.7;
      // `extra`: time the animation needs after the run (the dive, slide or lunge,
      // or the last stride into a pick-up), so the run is never squeezed.
      const ok = (reach, extra = 0) => runTime(Math.max(0, d - reach), f.speed) + extra <= avail;
      const at = { i, t: s.t, at: { x: s.x, y: s.y, z: s.z }, speedAt: s.speed };
      if (canCatch) {
        if (!first.catch && ok(FK.reachStand)) first.catch = { ...at, kind: 'catch', effort: avail - runTime(Math.max(0, d - FK.reachStand), f.speed) > 0.6 ? 'set' : 'run' };
        if (!first.stretch && s.y < 2.0 && ok(FK.reachStand + 0.45, 0.22)) first.stretch = { ...at, kind: 'catch', effort: 'stretch' };
        if (!first.diveC && s.y < 1.6 && ok(FK.reachDive, 0.32)) first.diveC = { ...at, kind: 'catch', effort: 'dive' };
      }
      if (low) {
        if (!first.field && ok(FK.reachGround)) first.field = { ...at, kind: 'field', effort: avail - runTime(Math.max(0, d - FK.reachGround), f.speed) > 0.6 ? 'set' : 'run' };
        if (!first.slide && s.speed > 3 && ok(FK.reachGround + 1.6, 0.4)) first.slide = { ...at, kind: 'field', effort: 'slide' };
        if (!first.diveF && s.speed > 4 && ok(FK.reachDive, 0.32)) first.diveF = { ...at, kind: 'field', effort: 'dive' };
      }
      if (first.catch && first.field) break;
    }
    // Catch beats field when both are possible at about the same time; the
    // easier effort wins unless it comes much later than the desperate one.
    const opts = [first.catch, first.stretch, first.diveC, first.field, first.slide, first.diveF].filter(Boolean);
    if (!opts.length) continue;
    const tMin = Math.min(...opts.map((o) => o.t));
    const slack = { set: 0.9, run: 0.8, stretch: 0.5, slide: 0.55, dive: 0 };
    let pick = null;
    for (const o of opts) {
      if (o.t - tMin > slack[o.effort]) continue;
      const score = o.t + EFFORT_COST[o.effort] - (o.kind === 'catch' ? 0.25 : 0);
      if (!pick || score < pick.score) pick = { ...o, score };
    }
    // Better still: get in line a moment later and be waiting for it.
    if (pick.effort === 'run') {
      for (let j = pick.i + 1; j < S.length && S[j].t <= pick.t + 0.6; j++) {
        const s = S[j];
        if (s.gone || ellipseK(s.x, s.z, OVAL.rope) >= 1) break;
        const ok = pick.kind === 'catch' ? s.air && s.y > 0.12 && s.y < 2.45 : !s.air || s.y < 0.7;
        if (!ok) break;
        const reach = pick.kind === 'catch' ? FK.reachStand : FK.reachGround;
        const spare = s.t - f.react - runTime(Math.max(0, Math.hypot(s.x - f.x, s.z - f.z) - reach), f.speed);
        if (spare >= 0.45) {
          pick = { ...pick, i: j, t: s.t, at: { x: s.x, y: s.y, z: s.z }, speedAt: s.speed, effort: 'set' };
          break;
        }
      }
    }
    const cand = { f, ...pick, dive: pick.effort === 'dive' };
    if (!best || cand.t + EFFORT_COST[cand.effort] < best.t + EFFORT_COST[best.effort]) best = cand;
  }

  const runStart = 0.2;
  const runsBefore = (tArrive, start = runStart) => Math.max(0, Math.min(3, Math.floor((tArrive - start - 0.25) / FK.runTime)));
  const throwFrom = (f, at, tGather) => {
    if (f.id === 'keeper' && Math.hypot(at.x - KEEPER_AT_STUMPS.x, at.z - KEEPER_AT_STUMPS.z) < 3) return { tThrow: tGather, tArrive: tGather };
    const d = Math.hypot(at.x - KEEPER_AT_STUMPS.x, at.z - KEEPER_AT_STUMPS.z);
    const tThrow = tGather + 0.38;
    return { tThrow, tArrive: tThrow + d / FK.throwSpeed + 0.12, throwDist: d };
  };

  if (!best) {
    // Nobody stops it: boundary (or it dribbles to a stop and someone walks over).
    const last = S[S.length - 1];
    const retrieve = nearest(all, last);
    const tReach = last.t > 0 ? Math.max(last.t, retrieve.react + runTime(Math.hypot(last.x - retrieve.x, last.z - retrieve.z), retrieve.speed)) : 0;
    const tGather = tReach + 0.3;
    const thr = throwFrom(retrieve, last, tGather);
    if (sim.six || sim.four) {
      return { type: 'boundary', six: sim.six, four: sim.four, runs: sim.six ? 6 : 4, by: retrieve.id, name: retrieve.name, t: tReach, at: { x: last.x, y: last.y, z: last.z }, tGather, ...thr, lost: !!sim.gone };
    }
    return { type: 'field', by: retrieve.id, name: retrieve.name, t: tReach, at: { x: last.x, y: last.y, z: last.z }, dive: false, effort: 'run', tGather, ...thr, runs: runsBefore(thr.tArrive) };
  }

  const f = best.f;
  if (best.kind === 'catch') {
    let p = f.skill * { set: 0.98, run: 0.95, stretch: 0.8, dive: 0.6 }[best.effort];
    if (best.speedAt > 20) p *= 0.85;
    if (best.at.y > 2.0) p *= 0.85;
    if (rng() < p) return { type: 'catch', by: f.id, name: f.name, t: best.t, at: best.at, dive: best.dive, effort: best.effort, tGather: best.t, ...throwFrom(f, best.at, best.t + 1.2), runs: 0 };
    // Dropped: the ball falls at his feet; they scamper.
    const tGather = best.t + 0.9;
    const thr = throwFrom(f, best.at, tGather);
    return { type: 'drop', by: f.id, name: f.name, t: best.t, at: best.at, dive: best.dive, effort: best.effort, tGather, ...thr, runs: runsBefore(thr.tArrive, best.t) };
  }
  const tGather = best.t + { set: 0.4, run: 0.45, slide: 0.85, dive: 1.0 }[best.effort];
  const thr = throwFrom(f, best.at, tGather);
  const runs = opts.noRuns ? 0 : runsBefore(thr.tArrive);
  return { type: 'field', by: f.id, name: f.name, t: best.t, at: best.at, dive: best.dive, effort: best.effort, speedAt: best.speedAt, tGather, ...thr, runs };
}

function nearest(all, p) {
  let b = all[0];
  let bd = Infinity;
  for (const f of all) {
    const d = Math.hypot(p.x - f.x, p.z - f.z);
    if (d < bd) {
      bd = d;
      b = f;
    }
  }
  return b;
}
