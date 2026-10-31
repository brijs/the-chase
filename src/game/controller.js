import * as THREE from 'three';
import { clamp, lerp, smooth, win, hash, BALL_R } from '../config.js';
import { bowlerAt, R as SCRIPT_R } from '../scene/stage.js';
import { MARK } from '../scene/ground.js';
import { poseAt, batAt, scalarAt, walkLeg, breathe, lerpAngle, solveFlight } from '../scene/motion.js';
import {
  STAND, mixPose, STANCE, BACKLIFT, PUSH, DRIVE_END, LOOK_BACK, GUARD, BATS,
  HANDS_ON_HEAD, HANDS_ON_HIPS, CELEBRATE, CATCH_CHEST, KEEPER_SQUAT, KEEPER_UP, KEEPER_HIGH, SLIP_SET, DIVE,
  THROW_WIND, THROW_REL, UMP_IDLE, UMP_WATCH, UMP_OUT,
  BACK_DEFENCE, CUT_IMPACT, CUT_END, PULL_IMPACT, PULL_END, GLANCE, LEAVE, DUCK, LOFT_END,
  FIELD_READY, PICKUP, CATCH_HIGH, CATCH_LOW, FIELD_GATHER, LONG_BARRIER, SLIDE, LUNGE_CATCH, UMP_FOUR, UMP_SIX, UMP_WIDE,
  PULL_WIND, PULL_HIT, PULL_THROUGH, CUT_HIGH, CUT_HIT, CUT_THROUGH, GUIDE,
  FLICK_HIT, FLICK_THROUGH, FLICK_END,
  SWEEP_DOWN, SWEEP_HIT, SWEEP_END, RSWEEP_DOWN, RSWEEP_HIT, RSWEEP_END, SCOOP_DOWN, SCOOP_HIT, SCOOP_END,
} from '../scene/cricketPoses.js';
import { Plan } from './plan.js';
import { createMatch, describeDelivery } from './match.js';
import { SHOTS, shotFor } from './batting.js';
import { simulateBatted, sampleAt } from './ballSim.js';
import { STRIKER, NON_STRIKER, NS_BACKED_UP, KEEPER_HOME, KEEPER_AT_STUMPS, GATE_PT, GATE_OUT, GAME } from './rules.js';
import { fieldPositions, FK } from './fielding.js';
import { TYPES, DISGUISE } from './bowlerAI.js';
import { lineOf } from './delivery.js';
import { STUMPS_X } from './rules.js';
import { SCALES } from './tuning.js';

/**
 * The Chase, live. Owns the game clock, the match, and a Plan per actor and for
 * the ball. A delivery is scheduled when it starts (run-up, release, flight).
 * The outcome is decided the moment you commit to a shot (or the ball has
 * passed), and everything that follows (the shot, the chase, the throw, the
 * runs, the signal, the walk back) is scheduled then, as segments of game time
 * ending in rests. Rendering evaluates every plan at the current time, so
 * pausing and fast-forwarding never desynchronise anything, and every flight is
 * aimed at where a hand will be when it lands.
 */
const PI = Math.PI;
const SCRIPT_REL = SCRIPT_R[0];
const BAT_BASE = [STRIKER.x, STRIKER.z];
const NS_BASE = [NON_STRIKER.x, NON_STRIKER.z];
const NS_UP = [NS_BACKED_UP.x, NS_BACKED_UP.z];
const UMP_BASE = [12.75, -0.28];
const KEEP = [KEEPER_HOME.x, KEEPER_HOME.z];
const KEEP_ST = [KEEPER_AT_STUMPS.x, KEEPER_AT_STUMPS.z];
const FT_END = [5.4, 1.9];
const FT_YAW = Math.atan2(FT_END[0] - 10.05, FT_END[1] - 0.52);
const BOWL_YAW_RUN = -PI / 2;
const YAW_FIELD = 1.62;
const RUN_UP = 2.45;
const READY = 0.45; // pause at the mark before the run-up
/** Running between the wickets: crease ends and lanes either side of the strip. */
const END_S = -7.95;
const END_N = 10.1;
const LANE = { batterA: 0.95, nonStriker: -1.45, batterB: 0.95 };

const yawTo = (from, to) => Math.atan2(to[0] - from[0], to[1] - from[1]);
const xz = (p) => [p.x, p.z];
const dist2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const v3 = (p) => new THREE.Vector3(p.x, p.y, p.z);

/** Shot visuals: impact and finish poses, root yaw and step at impact. */
const VIS = {
  straight: { impact: PUSH, end: DRIVE_END, yaw: 0.38, dx: 0.34, dz: 0.02 },
  cover: { impact: PUSH, end: DRIVE_END, yaw: 0.18, dx: 0.3, dz: 0.14 },
  onDrive: { impact: PUSH, end: DRIVE_END, yaw: 0.75, dx: 0.3, dz: -0.06 },
  cut: { impact: CUT_IMPACT, end: CUT_END, yaw: 0.05, dx: -0.12, dz: 0.22, bat: 'CUT_IMPACT', endBat: 'CUT_END' },
  lateCut: { impact: CUT_IMPACT, end: CUT_END, yaw: -0.2, dx: -0.2, dz: 0.12, bat: 'CUT_IMPACT', endBat: 'CUT_END' },
  punch: { impact: BACK_DEFENCE, end: BACK_DEFENCE, yaw: 0.32, dx: -0.18, dz: 0.06, bat: 'BACK_DEFENCE', endBat: 'BACK_DEFENCE' },
  pull: { impact: PULL_IMPACT, end: PULL_END, yaw: 0.85, dx: -0.2, dz: -0.08, bat: 'PULL_IMPACT', endBat: 'PULL_END' },
  glance: { impact: GLANCE, end: GLANCE, yaw: 0.85, dx: 0.28, dz: 0.0, endBat: 'GLANCE' },
  defenceF: { impact: PUSH, end: PUSH, yaw: 0.45, dx: 0.32, dz: 0.0, endBat: 'PUSH' },
  defenceB: { impact: BACK_DEFENCE, end: BACK_DEFENCE, yaw: 0.3, dx: -0.18, dz: 0.05, bat: 'BACK_DEFENCE', endBat: 'BACK_DEFENCE' },
};

/**
 * Keyed shots: [dt from impact, pose, bat, root yaw, step x, step z]. A bat is
 * { w: [dir], f: [face] } in WORLD space (interpolated there, so a slap's arc
 * stays flat), or { l: BATS entry } in the batter's frame. The pull and cut
 * are horizontal slaps; the late cut is a guide; the specials go down on a knee.
 */
const n3 = (v) => { const L = Math.hypot(...v) || 1; return v.map((x) => x / L); };
const azFace = (deg) => [Math.cos((deg * PI) / 180), 0, Math.sin((deg * PI) / 180)];
const W = (dir, face) => ({ w: n3(dir), f: n3(face) });
const SEQ = {
  pull: [
    [-0.05, PULL_WIND, W([-0.25, 0.35, 0.9], [0.95, 0.1, 0.25]), 0.35, -0.12, -0.03],
    [0, PULL_HIT, W([0.95, -0.08, 0.3], [0.3, 0, -0.95]), 0.75, -0.2, -0.06],
    [0.09, PULL_THROUGH, W([0.35, 0.05, -0.95], [-0.95, 0, -0.35]), 1.05, -0.2, -0.08],
    [0.3, PULL_END, W([-0.7, 0.6, -0.35], [-0.3, 0.2, -0.95]), 1.15, -0.2, -0.08],
  ],
  cut: [
    [-0.05, CUT_HIGH, W([-0.3, 0.85, 0.45], [0.2, 0.4, 0.9]), -0.05, -0.08, 0.12],
    [0, CUT_HIT, W([0.95, -0.22, 0.18], [-0.15, -0.3, 0.95]), -0.1, -0.12, 0.22],
    [0.1, CUT_THROUGH, W([0.25, -0.6, -0.75], [0.55, -0.6, 0.6]), -0.2, -0.12, 0.22],
    [0.32, CUT_END, W([-0.45, -0.35, -0.8], [0.6, -0.3, 0.6]), -0.25, -0.12, 0.22],
  ],
  flick: [
    [0, FLICK_HIT, W([0.25, -1, -0.1], azFace(-62)), 0.6, 0.3, -0.02],
    [0.12, FLICK_THROUGH, W([0.35, -0.35, -0.85], azFace(-115)), 0.8, 0.3, -0.02],
    [0.32, FLICK_END, W([-0.25, 0.6, -0.75], [0.5, 0.3, -0.6]), 0.9, 0.3, -0.02],
  ],
  lateCut: [
    [0, GUIDE, W([0.15, -1, 0.25], azFace(158)), 0.0, -0.18, 0.15],
    [0.3, GUIDE, W([0.05, -1, 0.32], azFace(166)), -0.05, -0.18, 0.15],
  ],
  sweep: [
    [-0.07, SWEEP_DOWN, W([-0.35, 0.35, 0.85], [0.9, 0.2, 0.3]), 0.35, 0.3, 0.05],
    [0, SWEEP_HIT, W([0.9, -0.35, 0.25], [0.25, 0, -0.95]), 0.55, 0.38, 0.06],
    [0.15, SWEEP_END, W([0.15, -0.25, -0.95], [-0.95, 0, -0.15]), 0.75, 0.38, 0.06],
  ],
  reverseSweep: [
    [-0.07, RSWEEP_DOWN, W([-0.3, 0.35, -0.85], [0.9, 0.2, -0.3]), 0.45, 0.3, 0.0],
    [0, RSWEEP_HIT, W([0.9, -0.35, -0.25], [0.25, 0, 0.95]), 0.4, 0.38, 0.02],
    [0.15, RSWEEP_END, W([0.15, -0.25, 0.95], [-0.95, 0, 0.15]), 0.2, 0.38, 0.02],
  ],
  scoop: [
    [-0.06, SCOOP_DOWN, W([0.7, -0.7, 0.1], [0.4, 0.5, -0.1]), 0.45, 0.3, 0.0],
    [0, SCOOP_HIT, W([0.9, -0.4, 0.0], [0.4, 0.9, 0.0]), 0.45, 0.38, 0.0],
    [0.16, SCOOP_END, W([0.1, 0.95, 0.0], [-0.95, 0.1, 0.0]), 0.45, 0.38, 0.0],
  ],
};
const toWorld = (v, yaw) => [v[0] * Math.cos(yaw) + v[2] * Math.sin(yaw), v[1], -v[0] * Math.sin(yaw) + v[2] * Math.cos(yaw)];
const toLocal = (v, yaw) => [v[0] * Math.cos(yaw) - v[2] * Math.sin(yaw), v[1], v[0] * Math.sin(yaw) + v[2] * Math.cos(yaw)];

const KEEPER_RELAXED = { ...KEEPER_UP, torso: [0.18, 0, 0], hipL: [-0.2, 0, -0.18], hipR: [-0.2, 0, 0.18], kneeL: [0.3, 0, 0], kneeR: [0.3, 0, 0], ankleL: [-0.1, 0, 0], ankleR: [-0.1, 0, 0], shoulderL: [-0.4, 0, 0.1], shoulderR: [-0.4, 0, -0.1] };
const SLIP_STAND = { ...STAND, shoulderL: [-0.25, 0, -0.1], shoulderR: [-0.25, 0, 0.1], elbowL: [-0.5, 0, 0], elbowR: [-0.5, 0, 0] };
const NS_HOLD = { ...STAND, shoulderR: [-0.35, 0, 0.08], elbowR: [-0.2, 0, 0] };

export function createController({ scene, cast, fx, board, ground, hud, onEvent = () => {} }) {
  const ctl = { t: 0, phase: 'intro', m: null, cur: null, events: [], difficulty: 'medium', seed: 1, ff: false };
  const plans = {};
  const homes = {}; // name -> { x, z, yaw, role?, slip? } where the actor will be once its plan settles
  const roles = { striker: 'batterA', nonStriker: 'nonStriker', spare: 'batterB' };
  const FIELDERS = ['slip1', 'slip2', 'f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7'];
  const BATTERS = ['batterA', 'nonStriker', 'batterB'];
  const bails = ground.wickets[0].userData.bails;
  const bailRest = bails.map((b) => b.position.clone());
  const wicketGroup = ground.wickets[0];
  let bailHit = null;

  // ---------------------------------------------------------------- events
  const at = (t, fn) => {
    ctl.events.push({ t, fn });
    ctl.events.sort((a, b) => a.t - b.t);
  };
  /** A sound at game time t; `when` (optional) is checked as it fires. */
  const sfx = (t, name, opts, when) => at(t, () => (!when || when()) && onEvent('sfx', { name, opts }));
  function runEvents() {
    while (ctl.events.length && ctl.events[0].t <= ctl.t) {
      const e = ctl.events.shift();
      e.fn(e.t);
    }
  }

  // ---------------------------------------------------------------- rests
  /**
   * The release that time t belongs to (the latest one at most a second ahead
   * of t), so idles evaluated in the past, for a replay, crouch at the right ball.
   */
  const releases = [];
  function releaseNear(t) {
    let r = null;
    for (const x of releases) if (x <= t + 1.0) r = x;
    return r ?? ctl.cur?.tR ?? null;
  }
  /** 0..1 crouch weight around the nearest release. */
  const ready = (t) => {
    const tR = releaseNear(t);
    if (tR == null) return 0;
    return smooth(win(t, tR - 0.9, tR - 0.45)) * (1 - smooth(win(t, tR + 0.8, tR + 1.3)));
  };
  function restFn(name, s) {
    if (name === 'bowler') return (t) => ({ x: s.x, z: s.z, yaw: s.yaw, pose: breathe(STAND, t, 11, 0.2) });
    if (name === 'umpire') {
      return (t) => {
        const tR = releaseNear(t);
        const pose = tR == null ? UMP_IDLE : poseAt(t, [[tR - 1.0, UMP_IDLE], [tR - 0.5, UMP_WATCH], [tR + 0.8, UMP_WATCH], [tR + 1.3, UMP_IDLE]]);
        return { x: UMP_BASE[0], z: UMP_BASE[1], yaw: -PI / 2, pose: breathe(pose, t, 6, 3.3) };
      };
    }
    if (name === 'keeper') {
      const home = dist2([s.x, s.z], KEEP) < 0.3;
      return (t) => {
        const tR = releaseNear(t);
        let pose = KEEPER_RELAXED;
        if (home && tR != null) pose = poseAt(t, [[tR - 1.0, KEEPER_RELAXED], [tR - 0.6, KEEPER_SQUAT], [tR + 0.15, KEEPER_SQUAT], [tR + 0.6, KEEPER_UP], [tR + 1.6, KEEPER_RELAXED]]);
        return { x: s.x, z: s.z, yaw: s.yaw, pose: breathe(pose, t, 8, 2.2) };
      };
    }
    if (BATTERS.includes(name)) {
      if (s.role === 'off') return () => ({ visible: false, x: GATE_OUT.x, z: GATE_OUT.z, yaw: 0, pose: STAND, bat: null });
      if (s.role === 'striker') {
        return (t) => {
          const tR = releaseNear(t);
          let pose = STANCE;
          let bat = BATS.STANCE;
          if (tR != null && t > tR - 0.2 && t < tR + 1.5) {
            pose = poseAt(t, [[tR - 0.1, STANCE], [tR + 0.3, BACKLIFT], [tR + 1.0, BACKLIFT], [tR + 1.5, STANCE]]);
            bat = batAt(t, [[tR - 0.1, 'STANCE'], [tR + 0.3, 'BACKLIFT'], [tR + 1.0, 'BACKLIFT'], [tR + 1.5, 'STANCE']]);
          }
          return { x: BAT_BASE[0], z: BAT_BASE[1], yaw: 0, pose: breathe(pose, t, 9, 1.1), bat, ik: true };
        };
      }
      return (t) => ({ x: s.x, z: s.z, yaw: s.yaw, pose: breathe(NS_HOLD, t, 10, 0.7), bat: BATS.WALK, ik: false });
    }
    // Fielders: on their spot, walking-in crouch as the ball is bowled.
    return (t) => ({ x: s.x, z: s.z, yaw: s.yaw, pose: breathe(mixPose(s.slip ? SLIP_STAND : STAND, s.slip ? SLIP_SET : FIELD_READY, ready(t)), t, 7 + (name.charCodeAt(1) % 5), name.length * 1.3) });
  }
  function rest(name, t0, spot) {
    homes[name] = { ...homes[name], ...spot };
    plans[name].rest(t0, restFn(name, { ...homes[name] }));
  }
  const homeXZ = (name) => [homes[name].x, homes[name].z];
  /** A walk from wherever `name` will be at t0 to `to`, then a rest there. */
  function walkTo(name, t0, to, opts = {}) {
    // From where he actually is at t0 (a plan may still be moving him).
    // (Just before t0: at t0 itself a move that ends then has already handed over.)
    const st = stateOf(name, t0 - 1e-4);
    const from = st ? [st.x, st.z] : [homes[name].x, homes[name].z];
    const fromYaw = st?.yaw ?? homes[name].yaw;
    const d = dist2(from, to);
    const speed = opts.speed ?? 3.2;
    const dur = Math.max(opts.min ?? 1.0, d / speed);
    if (d > 0.05) plans[name].add(t0, t0 + dur, (t) => ({ ...walkLeg(t, t0, t0 + dur, from, to, { fromYaw, toYaw: opts.yaw, turn: 0.25, easeK: opts.easeK }), ...(opts.extra ?? {}) }));
    rest(name, t0 + dur, { x: to[0], z: to[1], yaw: opts.yaw ?? fromYaw, ...(opts.spot ?? {}) });
    return t0 + dur;
  }

  const ballPlan = new Plan(() => ({ hold: ['bowler', 'L'] }));
  function initPlans(t) {
    for (const name of ['bowler', 'keeper', 'umpire', ...BATTERS, ...FIELDERS]) plans[name] = new Plan(() => null);
    homes.bowler = { x: MARK.x, z: MARK.z, yaw: BOWL_YAW_RUN };
    homes.keeper = { x: KEEP[0], z: KEEP[1], yaw: YAW_FIELD };
    homes.umpire = { x: UMP_BASE[0], z: UMP_BASE[1], yaw: -PI / 2 };
    homes.batterA = { x: BAT_BASE[0], z: BAT_BASE[1], yaw: 0, role: 'striker' };
    homes.nonStriker = { x: NS_BASE[0], z: NS_BASE[1], yaw: -PI / 2, role: 'nonStriker' };
    homes.batterB = { x: GATE_OUT.x, z: GATE_OUT.z, yaw: 0, role: 'off' };
    Object.assign(roles, { striker: 'batterA', nonStriker: 'nonStriker', spare: 'batterB' });
    for (const name of ['bowler', 'keeper', 'umpire', ...BATTERS]) rest(name, t - 1, {});
    ballPlan.segs = [];
    ballPlan.rest(t - 1, () => hold('bowler', 'L'));
  }
  function setField(field, t0, walk) {
    for (const f of field) {
      const spot = { yaw: f.yaw, slip: f.name.includes('slip'), label: f.name };
      if (walk && homes[f.id]) walkTo(f.id, t0, [f.x, f.z], { speed: 3.6, min: 1.2, yaw: f.yaw, spot });
      else rest(f.id, t0, { x: f.x, z: f.z, ...spot });
    }
  }

  // ---------------------------------------------------------------- evaluation
  const stateOf = (name, t) => plans[name].at(t);
  const _a = new THREE.Vector3();
  const _b = new THREE.Vector3();
  function palmsOf(name, side) {
    const a = cast[name];
    if (side === 'both') return a.palm('L', _a).add(a.palm('R', _b)).multiplyScalar(0.5).clone();
    return a.palm(side, new THREE.Vector3());
  }
  /** World palm(s) of an actor at time t, from its plan. */
  function palmAt(name, side, t) {
    cast[name].apply(stateOf(name, t));
    return palmsOf(name, side);
  }
  /** Palm offset from the root for this state: [dx, dz, y]. */
  function handOffset(name, st, side) {
    cast[name].apply(st);
    const p = palmsOf(name, side);
    return [p.x - st.x, p.z - st.z, p.y];
  }

  // ---------------------------------------------------------------- the ball
  const hold = (name, side) => ({ hold: [name, side] });
  /** A thrown ball, from a palm at t0 into a palm at t1 (both read from the plans). */
  function scheduleThrow(fromName, fromSide, t0, toName, toSide, t1) {
    const p0 = palmAt(fromName, fromSide, t0);
    const p1 = palmAt(toName, toSide, t1);
    const fn = solveFlight(p0, p1, t1 - t0);
    ballPlan.add(t0, t1, (t) => ({ pos: fn(t - t0), flying: true }), 'throw' + t0);
  }

  // ---------------------------------------------------------------- a delivery
  function startBall(T0) {
    const m = ctl.m;
    const ball = m.nextDelivery(ctl.forceNext ?? ctl.pickNext?.() ?? null);
    ctl.forceNext = null;
    const { del } = ball;
    const tR = T0 + READY + RUN_UP;
    const cur = (ctl.cur = { ...ball, T0, tR, input: null, outcome: null, resolved: false, tBounce: tR + del.T1 });
    releases.push(tR);
    if (releases.length > 12) releases.shift();
    // A positive timing offset (a player who presses late) keeps the window open longer.
    cur.deadline = tR + del.contactTime('back') + m.diff.window.miss + Math.max(0, SCALES.offsetMs / 1000);

    // Bowler: the authored delivery, retimed so its release is at tR.
    plans.bowler.add(T0, tR + 1.3, (t) => bowlerAt(SCRIPT_REL + (t - tR)));
    rest('bowler', tR + 1.3, { x: FT_END[0], z: FT_END[1], yaw: FT_YAW });
    ballPlan.add(tR, tR + 3, (t) => ({ pos: del.pos(t - tR), flying: true }), 'delivery');

    // Non-striker backs up.
    const ns = roles.nonStriker;
    plans[ns].add(tR - 0.5, tR + 0.45, (t) => {
      const w = walkLeg(t, tR - 0.5, tR + 0.45, NS_BASE, NS_UP);
      return { ...w, yaw: -PI / 2, bat: BATS.WALK, ik: false, pose: { ...w.pose, shoulderR: [-0.35, 0, 0.08] } };
    });
    rest(ns, tR + 0.45, { x: NS_UP[0], z: NS_UP[1], yaw: -PI / 2 });

    // A leave starts to show before the ball arrives; the deadline decides it.
    at(tR + del.contactTime('front') - 0.17, () => {
      if (!cur.input && !cur.resolved) leaveVisual(cur, tR + del.contactTime('front') - 0.17);
    });
    at(cur.deadline, () => {
      if (!cur.resolved) resolve(null, cur.deadline);
    });
    // The read: where it is aimed to pitch, the line and the type, shown during
    // the run-up. It is the aim, not the ball (the bowler misses his spot), with
    // an error zone and a lead that grow with difficulty; harder bowlers disguise.
    const spec = ball.spec;
    const pv = m.diff.preview;
    const hs = (k) => hash(ctl.seed * 13.7 + m.log.length * 3.1 + k);
    const aimLen = spec.aimLenM ?? spec.lenM;
    const aimLine = spec.aimLineZ ?? spec.lineZ;
    const fake = hs(3) < pv.disguise && DISGUISE[spec.type];
    cur.preview = {
      x: STUMPS_X + aimLen + (hs(1) - 0.5) * 2 * pv.len * 0.6,
      z: aimLine - spec.seam + (hs(2) - 0.5) * 2 * pv.line * 0.6,
      rx: Math.max(0.3, pv.len),
      rz: Math.max(0.12, pv.line * 1.8),
      typeName: fake ? TYPES[fake].name : spec.typeName,
      length: spec.aimed ?? spec.length,
      line: spec.aimedLine ?? lineOf(aimLine),
      t0: T0 + 0.25,
      t1: tR - pv.hideBefore,
    };
    hud.preview(cur.preview, tR);
    hud.ball({ m, spec, tR, del, diff: m.diff });

    // Sound: the run-up footfalls quicken, the bound, the grunt, the pitch.
    let ts = T0 + READY + 0.15;
    for (let k = 0, gap = 0.4; ts < tR - 0.5; k++, gap = Math.max(0.21, gap * 0.9)) {
      sfx(ts, 'step', { peak: 0.06 + 0.012 * k });
      ts += gap;
    }
    sfx(tR - 0.18, 'step', { peak: 0.2 });
    sfx(tR - 0.04, 'step', { peak: 0.3 });
    sfx(tR - 0.03, 'grunt', { big: spec.kph > 143 || spec.type === 'bouncer' || spec.type === 'yorker' });
    if (del.T1 < del.tStumps) sfx(tR + del.T1, 'bounce');
    // If nothing is pressed, the ball meets pad or stumps before the deadline decides.
    const pad0 = del.padImpact('stance');
    if (pad0) sfx(tR + pad0.t, 'pad', null, () => !cur.resolved);
    else if (del.hitsStumps) sfx(tR + del.tStumps, 'stumps', null, () => !cur.resolved);
    onEvent('release', { spec, tR });
  }

  function leaveVisual(cur, t0) {
    const s = roles.striker;
    const high = cur.del.contactPos('back').y > 1.25;
    const P = high ? DUCK : LEAVE;
    const B = high ? 'DUCK' : 'LEAVE';
    cur.leaveT = t0;
    plans[s].add(t0, t0 + 1.6, (t) => ({
      x: BAT_BASE[0] + scalarAt(t, [[t0, 0], [t0 + 0.2, high ? -0.1 : -0.05], [t0 + 1.0, 0]]),
      z: BAT_BASE[1],
      yaw: scalarAt(t, [[t0, 0], [t0 + 0.2, high ? -0.4 : 0.15], [t0 + 1.2, 0]]),
      pose: poseAt(t, [[t0, BACKLIFT], [t0 + 0.18, P], [t0 + 0.8, P], [t0 + 1.5, STANCE]]),
      bat: batAt(t, [[t0, 'BACKLIFT'], [t0 + 0.18, B], [t0 + 0.8, B], [t0 + 1.5, 'STANCE']]),
      ik: true,
    }), 'leave');
  }

  /** Player input: the arrows held plus D (ground) or A (lofted), at game time tp. */
  ctl.press = (dirKey, lofted, tp = ctl.t, special = false) => {
    const cur = ctl.cur;
    if (ctl.phase !== 'live' || !cur || cur.resolved || cur.input) return false;
    if (tp < cur.tR - 0.05) return false;
    const shotKey = shotFor(dirKey, special, cur.del);
    // Calibrated latency: the press is taken as having happened offset earlier.
    const off = SCALES.offsetMs / 1000;
    cur.input = { shotKey, lofted: lofted && shotKey !== 'defence' && !special, pressT: tp - off - cur.tR, rawPressT: tp - cur.tR, offset: off, dirKey };
    resolve(cur.input, tp);
    return true;
  };

  // ---------------------------------------------------------------- outcome
  function resolve(input, tNow) {
    const cur = ctl.cur;
    cur.resolved = true;
    const m = ctl.m;
    // The fielding model starts from where each fielder will be at contact.
    const tCe = cur.tR + cur.del.contactTime('front');
    m.live = Object.fromEntries([...FIELDERS, 'keeper'].map((n) => { const st = stateOf(n, tCe); return [n, [st.x, st.z]]; }));
    const o = m.resolve(cur, input);
    cur.outcome = o;
    const { del, tR } = cur;
    const s = roles.striker;

    if (input) scheduleShot(s, input, o, tR + input.pressT, cur);
    ballPlan.cutFrom(tR);
    cur.nextReady = 0;

    let r;
    if (o.kind === 'hit') {
      const tc = tR + o.tContact;
      cur.tContact = tc;
      if (o.shot.edge) cur.edgeFx = { t: tc, p: v3(o.contactPos) };
      ballPlan.add(tR, tc, (t) => ({ pos: del.pos(t - tR), flying: true }), 'delivery');
      r = scheduleHit(o, tc, cur);
    } else {
      r = scheduleNoContact(o, cur);
    }
    const { tDead, holder, side } = r;
    sounds(o, cur, r, tNow);

    // Umpire.
    const tCall = cur.tContact ?? tR + del.tStumps;
    // When the outcome can be seen: a catch taken or put down, the ball at the
    // rope. Nothing announces it before then.
    const fl = o.kind === 'hit' ? o.fielding : null;
    const tReveal = !fl ? tCall : fl.type === 'catch' || fl.type === 'drop' ? tCall + fl.t + 0.1 : fl.type === 'boundary' ? tCall + (o.sim?.tRope ?? 1) : tCall;
    if (o.wide) umpireSignal(UMP_WIDE, tR + 1.2, 2.0);
    else if (o.out === 'lbw' || o.out === 'caught') umpireSignal(UMP_OUT, (r.tOut ?? tCall) + 1.0, 2.0);
    else if (o.runs === 6) umpireSignal(UMP_SIX, tCall + (o.sim?.tRope ?? 1) + 0.4, 2.0);
    else if (o.runs === 4) umpireSignal(UMP_FOUR, tCall + (o.sim?.tRope ?? 1) + 0.4, 2.0, true);

    // Bowler: reaction at the end of his follow-through, then straight back to
    // his mark; the ball is returned to him on the way (aimed at his hand then).
    const spot = { x: FT_END[0], z: FT_END[1], yaw: FT_YAW };
    const stand = (t, pose, lift = 0) => ({ x: spot.x, z: spot.z, yaw: spot.yaw, pose, lift });
    const tB0 = Math.max(tR + 1.3, (r.tOut ?? tCall) + 0.1);
    let tReact = tR + 1.6;
    if (o.out) {
      plans.bowler.add(tB0, tB0 + 2.4, (t) => stand(t, poseAt(t, [[tB0, STAND], [tB0 + 0.25, CELEBRATE], [tB0 + 1.8, CELEBRATE], [tB0 + 2.4, STAND]]), 0.22 * Math.max(0, Math.sin(PI * win(t, tB0 + 0.3, tB0 + 0.7)))));
      tReact = tB0 + 2.4;
    } else if (o.kind === 'miss' && !o.wide && Math.abs(del.atStumps.z) < 0.5) {
      plans.bowler.add(tB0, tB0 + 1.8, (t) => stand(t, poseAt(t, [[tB0, STAND], [tB0 + 0.3, HANDS_ON_HEAD], [tB0 + 1.4, HANDS_ON_HEAD], [tB0 + 1.8, STAND]])));
      tReact = tB0 + 1.8;
    }
    const tMark = walkTo('bowler', tReact, [MARK.x, MARK.z], { yaw: BOWL_YAW_RUN, speed: 4.8, min: 2.4, easeK: 0.5 });

    const tThrowBack = Math.max(tDead + 0.5, tR + 1.8);
    let tHas;
    if (holder === 'gone') {
      // Lost in the crowd: a new ball out of the umpire's pocket, tossed over.
      ballPlan.rest(tDead, () => ({ hidden: true }));
      const tu = tThrowBack;
      ballPlan.add(tu, tu + 0.6, () => hold('umpire', 'L'));
      tHas = tu + 1.35;
      const bAt = xz(stateOf('bowler', tHas));
      const uy = yawTo(UMP_BASE, bAt);
      plans.umpire.add(tu - 0.1, tu + 1.2, (t) => ({ x: UMP_BASE[0], z: UMP_BASE[1], yaw: lerpAngle(-PI / 2, uy, smooth(win(t, tu - 0.1, tu + 0.2))), pose: poseAt(t, [[tu - 0.1, UMP_IDLE], [tu + 0.35, THROW_WIND], [tu + 0.6, THROW_REL, 'lin'], [tu + 1.2, UMP_IDLE]]) }));
      bowlerCatch(tHas);
      scheduleThrow('umpire', 'L', tu + 0.6, 'bowler', 'L', tHas);
    } else {
      const from = xz(stateOf(holder, tThrowBack - 0.4));
      const guess = xz(stateOf('bowler', tThrowBack + 1));
      const flight = clamp(dist2(from, guess) / 20 + 0.25, 0.6, 1.7);
      tHas = tThrowBack + flight;
      throwPose(holder, tThrowBack, xz(stateOf('bowler', tHas)));
      bowlerCatch(tHas);
      ballPlan.add(tDead, tThrowBack, () => hold(holder, side));
      scheduleThrow(holder, 'L', tThrowBack, 'bowler', 'L', tHas);
      if (holder === 'keeper' && dist2(homeXZ('keeper'), KEEP) > 0.3) walkTo('keeper', tThrowBack + 0.6, KEEP, { yaw: YAW_FIELD, speed: 3.0, min: 1.2 });
      else if (holder !== 'keeper') goHome(holder, tThrowBack + 0.6);
    }
    ballPlan.rest(tHas, () => hold('bowler', 'L'));
    sfx(tHas, 'glove', { peak: 0.15 });

    // Score it.
    const rec = m.record(o);
    let nextT0 = Math.max(tMark + 0.25, tHas + 0.5, cur.battersReady ?? 0);
    hud.result({ m, o, cur, t: Math.max(tCall + 0.3, tReveal), describe: describeDelivery(o.spec) });
    at(Math.max(tCall + 0.6, tReveal + 0.3), (t) => {
      if (ctl.nets) board.show(['NETS', `${m.log.length} BALLS`], boardVerdict(o), t);
      else board.show([`TARGET ${m.target}   ${m.overText()} OV`, `${m.runs}-${m.wkts}`], boardVerdict(o), t);
      hud.score(m, t);
    });
    // Who was on strike, and (after a wicket) who came in: for the scorebook.
    onEvent('outcome', { o, tCall, tReveal, striker: s, incoming: o.out ? roles.striker : null, overEnd: rec.overEnd, field: m.field });

    if (rec.result) {
      ctl.phase = 'ending';
      if (m.result === 'won') sfx(tCall + 0.8, 'roar');
      else sfx(tCall + 1.5, 'applause', { size: 0.4 });
      at(Math.max(tCall + 2.6, tDead + 1.2), (t) => {
        ctl.phase = 'result';
        hud.final(m, t);
        board.show([`TARGET ${m.target}`, `${m.runs}-${m.wkts}`], m.result === 'won' ? 'CHASE WON' : m.result === 'tied' ? 'TIED' : 'CHASE LOST', t);
        onEvent('result', { m });
      });
      return;
    }
    if (rec.overEnd && !o.out && o.runs < 4) sfx(tCall + 1.4, 'applause', { size: 0.15 });
    if (rec.overEnd && ctl.nets) m.startOver(); // new AI plan, same nets field
    else if (rec.overEnd) {
      const plan = m.startOver();
      const tf = Math.max(tCall + 2.0, nextT0 - 2.0);
      at(tf, (t) => {
        setField(m.field, t, true);
        hud.over(m, plan, t);
      });
      nextT0 = Math.max(nextT0, tf + 4.2);
    }
    ctl.nextT0 = nextT0;
    at(nextT0, (t) => startBall(t));
  }

  /** Sound for one outcome: contact, the laws, the crowd. Times in the past are skipped. */
  function sounds(o, cur, r, tNow) {
    const { del, tR } = cur;
    const S = (t, name, opts) => t >= tNow - 0.01 && sfx(t, name, opts);
    if (o.kind === 'hit') {
      const tc = cur.tContact;
      const sh = o.shot;
      if (sh.edge) S(tc, 'edge');
      else S(tc, 'bat', { q: sh.shotKey === 'defence' ? 0.15 : Math.max(0.2, sh.q) });
      const f = o.fielding;
      const tI = tc + f.t;
      if (f.type === 'catch') {
        if (f.by === 'keeper' || f.by.startsWith('slip')) S(tc + 0.08, 'appeal');
        S(tI, 'glove', { peak: 0.5 });
        S(tI + 0.12, 'roar');
      } else if (f.type === 'drop') {
        S(tI, 'glove', { peak: 0.3 });
        S(tI + 0.1, 'ooh', { size: 1 });
      } else if (f.type === 'boundary') {
        S(tc + (o.sim.tRope ?? 1), 'cheer', { size: f.six ? 1 : 0.65 });
      } else {
        if (sh.edge) S(tc + 0.15, 'ooh', { size: 0.5 });
        if (o.runs >= 2) S(tc + 0.2 + o.runs * FK.runTime, 'applause', { size: 0.2 });
        if (f.dive) S(tI + 0.1, 'applause', { size: 0.25 });
        S(tc + f.tArrive, 'glove', { peak: 0.2 });
      }
      return;
    }
    if (o.kind === 'playedOn') {
      S(tR + o.tContact, 'edge');
      S(tR + del.tStumps, 'stumps');
      S(tR + del.tStumps + 0.1, 'roar');
      return;
    }
    // Beaten or left.
    const pad = o.pad ? del.padImpact(o.foot ?? 'stance') : null;
    if (pad) S(tR + pad.t, 'pad');
    if (o.out === 'bowled') {
      S(tR + del.tStumps, 'stumps');
      S(tR + del.tStumps + 0.1, 'roar');
    } else if (o.out === 'lbw') {
      sfx(Math.max(tNow, tR + pad.t + 0.12), 'appeal');
      sfx((r.tOut ?? tR + del.tStumps) + 1.05, 'roar');
    } else {
      if (pad) sfx(Math.max(tNow, tR + pad.t + 0.15), 'appeal');
      if (!pad) sfx(tR + del.tKeeper, 'glove', { peak: 0.45 });
      if (!o.wide && o.kind === 'miss' && Math.abs(del.atStumps.z) < 0.45) sfx(Math.max(tNow, tR + del.tStumps + 0.1), 'ooh', { size: 0.7 });
    }
  }

  function boardVerdict(o) {
    if (o.out) return `OUT  ${o.out === 'caught' ? (o.fielding.by === 'keeper' ? 'c KEEPER' : 'CAUGHT') : o.out === 'lbw' ? 'LBW' : 'BOWLED'}`;
    if (o.wide) return 'WIDE';
    if (o.runs === 6) return 'SIX';
    if (o.runs === 4) return 'FOUR';
    return `${o.spec.kph} KM/H`;
  }

  // ---------------------------------------------------------------- shots
  function scheduleShot(s, input, o, tP, cur) {
    const key = input.shotKey;
    const sh = SHOTS[key];
    const foot = o.foot === 'stance' ? 'front' : o.foot;
    const tI = tP + sh.swing;
    let seq = SEQ[key];
    if (!seq) {
      // Drives, punch, glance, defence: impact and finish from VIS.
      const vis = key === 'defence' ? (foot === 'back' ? VIS.defenceB : VIS.defenceF) : VIS[key];
      const impactBat = vis.bat ? { l: BATS[vis.bat] } : { l: { dir: BATS.PUSH.dir, face: [Math.cos(sh.az + vis.yaw), 0, Math.sin(sh.az + vis.yaw)] } };
      const lofted = input.lofted && vis.end === DRIVE_END;
      const end = lofted ? LOFT_END : vis.end;
      const endBat = { l: lofted ? BATS.LOFT_END : vis.endBat ? BATS[vis.endBat] : BATS.DRIVE_END };
      seq = [[0, vis.impact, impactBat, vis.yaw, vis.dx, vis.dz], [0.32, end, endBat, vis.yaw + 0.05, vis.dx, vis.dz]];
    }
    // Absolute keys, every bat in world space at its key's yaw.
    const kneel = !!sh.special;
    const t0 = Math.min(tP - 0.04, cur.tR + 0.3);
    const K0 = [t0, BACKLIFT, { l: BATS.BACKLIFT }, 0, 0, 0];
    const K1 = [tP, BACKLIFT, { l: BATS.BACKLIFT }, 0, 0, 0];
    const mid = seq.map(([dt, ...r]) => [Math.max(tP + 0.005, tI + dt), ...r]);
    const last = mid[mid.length - 1];
    const tHold = last[0] + (kneel ? 0.9 : 0.7);
    const tBack = tHold + (kneel ? 1.0 : 0.8);
    const keys = [K0, K1, ...mid, [tHold, ...last.slice(1)], [tBack, STANCE, { l: BATS.STANCE }, 0, 0, 0]].map(([t, pose, bat, yaw, dx, dz]) => {
      const wd = bat.w ?? toWorld(bat.l.dir, yaw);
      const wf = bat.f ?? toWorld(bat.l.face, yaw);
      return { t, pose, wd: n3(wd), wf: n3(wf), yaw, dx, dz };
    });
    const segAt = (t) => {
      let i = 1;
      while (i < keys.length - 1 && t > keys[i].t) i++;
      const a = keys[i - 1], b = keys[i];
      const u = clamp((t - a.t) / Math.max(1e-6, b.t - a.t), 0, 1);
      // Into impact the swing is linear (it is fast); everything else eases.
      return { a, b, k: b.t <= tI + 1e-6 && a.t >= tP - 1e-6 ? u : smooth(u) };
    };
    const lerp3 = (p, q, k) => n3([p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k, p[2] + (q[2] - p[2]) * k]);
    plans[s].add(t0, tBack, (t) => {
      const { a, b, k } = segAt(t);
      const yaw = lerp(a.yaw, b.yaw, k);
      return {
        x: BAT_BASE[0] + lerp(a.dx, b.dx, k),
        z: BAT_BASE[1] + lerp(a.dz, b.dz, k),
        yaw,
        pose: breathe(mixPose(a.pose, b.pose, k), t, 9, 1.1),
        bat: { dir: toLocal(lerp3(a.wd, b.wd, k), yaw), face: toLocal(lerp3(a.wf, b.wf, k), yaw) },
        ik: true,
      };
    }, 'shot');
    return tBack;
  }

  // ---------------------------------------------------------------- off the bat
  function scheduleHit(o, tc, cur) {
    const { sim, fielding: fld } = o;
    const tI = tc + fld.t;
    const by = fld.by;
    const out = o.out === 'caught';
    const last = sim.samples[sim.samples.length - 1];
    const tStop = tc + sim.tStop;
    const batted = (t) => {
      const q = sampleAt(sim, t - tc);
      return { pos: new THREE.Vector3(q.x, q.y, q.z), flying: q.y > BALL_R + 0.02 || q.speed > 1.5 };
    };

    if (fld.type === 'boundary' && fld.six) {
      // Six: gone over the boards. The nearest fielder trots to the rope and watches.
      ballPlan.add(tc, tStop, batted, 'batted');
      const lookAt = xz(last);
      const near = fieldSpotToward(by, lookAt);
      watch(by, near, lookAt, tc + 0.35, tc + Math.min(2.4, Math.max(1.3, sim.tStop)));
      runBatters(0, tc, cur);
      return { tDead: tStop + 0.4, holder: 'gone', side: 'L' };
    }

    ballPlan.add(tc, tI, batted, 'batted');
    ballPlan.rest(tStop, () => ({ pos: new THREE.Vector3(last.x, BALL_R, last.z), flying: false }));

    const isKeeper = by === 'keeper';
    const kind = fld.type === 'catch' ? 'catch' : 'pickup';
    const ballAt = v3(fld.at);
    const side = kind === 'catch' ? 'both' : 'L';
    const tGather = tc + fld.tGather;
    const tThrow = tc + fld.tThrow;
    const tArrive = tc + fld.tArrive;
    const four = fld.type === 'boundary';
    field(by, xz(ballAt), tc + 0.3, tI, kind, { ballAt, dive: fld.dive, effort: fld.effort, speedAt: fld.speedAt ?? fld.at?.speed, tGather, tThrow, celebrate: out, drop: fld.type === 'drop', noThrow: isKeeper || four });
    // From the path into the hands over 0.08 s (a drop falls to his feet).
    ballPlan.add(tI, tGather, (t) => {
      if (fld.type === 'drop' && t > tI + 0.12) return { pos: new THREE.Vector3(ballAt.x, BALL_R, ballAt.z), flying: false };
      return { blendFrom: ballAt, k: smooth(win(t, tI, tI + 0.08)), hold: [by, side] };
    });

    let holder = by;
    let hside = side;
    let tDead;
    if (isKeeper) {
      ballPlan.rest(tGather, () => hold('keeper', side));
      tDead = tGather + 0.4;
    } else if (four) {
      // Fetched from the boards and thrown straight back to the bowler.
      ballPlan.rest(tGather, () => hold(by, 'L'));
      tDead = tGather + 0.2;
      hside = 'L';
    } else {
      ballPlan.add(tGather, tThrow, () => hold(by, out ? 'both' : 'L'));
      // The keeper comes up to the stumps for the throw.
      keeperToStumps(tc + 0.15, Math.min(tc + 2.2, tArrive - 0.35), tArrive, xz(ballAt));
      scheduleThrow(by, 'L', tThrow, 'keeper', 'both', tArrive);
      ballPlan.rest(tArrive, () => hold('keeper', 'both'));
      holder = 'keeper';
      hside = 'both';
      tDead = tArrive;
    }
    const runsEnd = runBatters(out || four ? 0 : o.runs, tc, cur);
    if (out && !ctl.nets) wicketFall(roles.striker, tI + 0.4, cur);
    return { tDead: Math.max(tDead, runsEnd), holder, side: hside, tOut: out ? tI : null };
  }

  /** A spot 2 m inside the rope toward `p`, for whoever goes to watch a six. */
  function fieldSpotToward(name, p) {
    const h = [homes[name].x, homes[name].z];
    const d = dist2(h, p);
    const k = Math.max(0, (d - 2.5) / d);
    return [h[0] + (p[0] - h[0]) * k * 0.6, h[1] + (p[1] - h[1]) * k * 0.6];
  }
  function watch(name, to, lookAt, t0, t1) {
    const st = stateOf(name, t0 - 1e-4);
    const home = [st.x, st.z];
    const hy = st.yaw ?? homes[name].yaw;
    const spot = { ...homes[name] };
    t1 = Math.max(t1, t0 + dist2(home, to) / 4.5 + 0.3);
    plans[name].add(t0, t1, (t) => walkLeg(t, t0, t1, home, to, { easeK: 0.4, fromYaw: hy, toYaw: yawTo(to, lookAt) }));
    plans[name].add(t1, t1 + 2.0, (t) => ({ x: to[0], z: to[1], yaw: yawTo(to, lookAt), pose: breathe(HANDS_ON_HIPS, t, 7, 0.3) }));
    homes[name] = { ...spot, x: to[0], z: to[1], yaw: yawTo(to, lookAt) };
    walkTo(name, t1 + 2.0, [spot.x, spot.z], { yaw: spot.yaw, spot: { ...spot } });
  }

  /**
   * A fielder (or the keeper) runs to the ball, arriving at tArrive, takes it
   * (catch, pickup, dive), and throws it to the keeper at tThrow; then walks home.
   */
  function field(name, to, tStart, tArrive, kind, opts) {
    const p = plans[name];
    // From wherever he actually is when he sets off (he may still be walking back).
    const st0 = stateOf(name, tStart - 1e-4);
    const from = [st0.x, st0.z];
    const fromYaw = st0.yaw ?? homes[name].yaw;
    const home = { ...homes[name] };
    const faceYaw = yawTo(to, BAT_BASE);
    const y = opts.ballAt.y;
    // What he does depends on how he gets there (fielding.js decides the effort):
    //   set: waiting (gather, or the long barrier for a hard one; settled under a catch)
    //   run: on the move (one-handed pick-up, or a catch at whatever height)
    //   stretch: a lunging catch · slide: a slide on the hip · dive: full length
    const effort = opts.effort ?? (opts.dive ? 'dive' : 'run');
    const fwd = [Math.sin(faceYaw), Math.cos(faceYaw)];
    const rel = [to[0] - from[0], to[1] - from[1]];
    const sgn = fwd[0] * rel[1] - fwd[1] * rel[0] > 0 ? -1 : 1;
    let take, roll = 0, glide = 0, moveDur = 0, getUp = 0;
    if (effort === 'dive') [take, roll, glide, moveDur, getUp] = [DIVE, 1.42 * sgn, 1.4, 0.32, 1.3];
    else if (effort === 'slide') [take, roll, glide, moveDur, getUp] = [SLIDE, 0.5 * sgn, 1.7, 0.4, 0.9];
    else if (effort === 'stretch') [take, roll, glide, moveDur, getUp] = [LUNGE_CATCH, 0.3 * sgn, 0.6, 0.22, 0.5];
    else if (kind === 'catch') take = y > 1.55 ? CATCH_HIGH : y > 0.75 ? CATCH_CHEST : CATCH_LOW;
    else if (effort === 'set') take = (opts.speedAt ?? 0) > 11 ? LONG_BARRIER : FIELD_GATHER;
    else take = PICKUP;
    const side = kind === 'catch' ? 'both' : 'L';
    // Stand (or land) so the hands meet the ball. Diving, sliding or lunging,
    // he goes down on whichever side puts his hands toward the ball (the shorter
    // trip for his body).
    let [ox, oz, oy] = handOffset(name, { x: 0, z: 0, yaw: faceYaw, pose: take, roll }, side);
    if (roll) {
      const alt = handOffset(name, { x: 0, z: 0, yaw: faceYaw, pose: take, roll: -roll }, side);
      if (dist2(from, [to[0] - alt[0], to[1] - alt[1]]) < dist2(from, [to[0] - ox, to[1] - oz])) {
        [ox, oz, oy] = alt;
        roll = -roll;
      }
    }
    const stop = [to[0] - ox, to[1] - oz];
    const lift = clamp(y - oy, 0, kind === 'catch' && !moveDur ? 0.45 : 0.15);
    const speed = ctl.m.diff.fielderSpeed * (name === 'keeper' ? 0.75 : 1);
    let runTo = stop;
    if (glide) {
      const dir = [stop[0] - from[0], stop[1] - from[1]];
      const L = Math.hypot(dir[0], dir[1]) || 1;
      const back = Math.min(L, glide);
      runTo = [stop[0] - (dir[0] / L) * back, stop[1] - (dir[1] / L) * back];
    }
    const d = dist2(from, runTo);
    const runDur = d / speed + 0.3 * Math.min(1, d / 3);
    let tRun0, tRun1;
    if (effort === 'set') {
      // In line early, then waiting for it.
      tRun0 = tStart;
      tRun1 = Math.min(tArrive - 0.3, tRun0 + runDur);
    } else {
      // Arrive a beat early to crouch into the take, unless the run needs that beat.
      tRun1 = tArrive - moveDur - (moveDur ? 0 : Math.max(0, Math.min(0.12, tArrive - tStart - runDur)));
      tRun0 = Math.max(tStart, tRun1 - runDur);
    }
    // Never faster than a fielder can run: if the run before a dive, slide or
    // lunge cannot be covered in time, he sets off into it sooner and further out.
    const maxRun = speed * 1.05 * Math.max(0, tRun1 - tRun0 - 0.1);
    if (moveDur && dist2(from, runTo) > maxRun) {
      const L = dist2(from, runTo) || 1;
      runTo = [from[0] + ((runTo[0] - from[0]) / L) * maxRun, from[1] + ((runTo[1] - from[1]) / L) * maxRun];
    }
    const dRun = dist2(from, runTo);
    // Kept for QA (qa/game-speeds.mjs): the plan each fielder was given.
    (ctl.fieldLog ??= []).push({ name, effort, kind, tStart, tArrive, tRun0, tRun1, moveDur, run: +dRun.toFixed(2), total: +dist2(from, stop).toFixed(2), glide: +dist2(runTo, stop).toFixed(2), speed });
    if (ctl.fieldLog.length > 200) ctl.fieldLog.shift();
    if (dRun > 0.05 && tRun1 > tRun0 + 0.05) p.add(tRun0, tRun1, (t) => walkLeg(t, tRun0, tRun1, from, runTo, { easeK: 0.12, fromYaw, toYaw: faceYaw, turn: 0.3 }));
    else if (dRun <= 0.05) tRun1 = Math.min(tRun1, tArrive - 0.12);
    else {
      runTo = from;
      tRun1 = Math.min(tRun1, tArrive - 0.12);
    }

    const tG = opts.tGather;
    const tT = opts.tThrow;
    const throwYaw = yawTo(stop, KEEP_ST);
    let tUp = tArrive; // standing again, ball in hand
    if (moveDur) {
      // Dive, slide or lunge: the body travels the last metre or so into the take.
      const a = runTo;
      tUp = tArrive + getUp;
      const hold = effort === 'stretch' ? 0.15 : 0.45;
      p.add(tRun1, tUp, (t) => ({
        x: lerp(a[0], stop[0], smooth(win(t, tRun1, tArrive))),
        z: lerp(a[1], stop[1], smooth(win(t, tRun1, tArrive))),
        yaw: faceYaw,
        pose: poseAt(t, [[tRun1, effort === 'slide' ? STAND : FIELD_READY], [tArrive, take], [tArrive + hold, take], [tUp, STAND]]),
        roll: scalarAt(t, [[tRun1, 0], [tArrive - 0.03, roll], [tArrive + hold + 0.1, roll], [tUp, 0]]),
        lift:
          (effort === 'dive' ? 0.22 * Math.sin(PI * win(t, tRun1, tArrive + 0.06)) : 0) +
          lift * smooth(win(t, tRun1, tArrive)) * (1 - win(t, tArrive + 0.08, tArrive + 0.35)),
      }));
    } else {
      const ready = effort === 'set' ? [[tRun1, FIELD_READY], [Math.max(tRun1 + 0.01, tArrive - 0.3), FIELD_READY]] : [[tRun1, FIELD_READY]];
      tUp = tArrive + (take === LONG_BARRIER ? 0.5 : 0.25);
      p.add(tRun1, tUp, (t) => ({
        x: lerp(runTo[0], stop[0], smooth(win(t, tRun1, tArrive))),
        z: lerp(runTo[1], stop[1], smooth(win(t, tRun1, tArrive))),
        yaw: faceYaw,
        pose: poseAt(t, [...ready, [tArrive, take], [tUp, take]]),
        lift: lift * Math.sin(PI * 0.5 * win(t, tArrive - 0.2, tArrive)) * (1 - win(t, tArrive + 0.05, tArrive + 0.25)),
      }));
    }
    const after = moveDur ? STAND : take;
    let keys;
    let tEnd;
    if (opts.noThrow) {
      keys = [[tUp, after], [tUp + 0.5, opts.celebrate ? CELEBRATE : STAND], [tUp + 1.6, STAND]];
      tEnd = tUp + 1.6;
    } else if (opts.celebrate) {
      keys = [[tUp, after], [tUp + 0.3, CELEBRATE], [tT - 0.6, CELEBRATE], [tT - 0.32, THROW_WIND], [tT, THROW_REL, 'lin'], [tT + 0.5, STAND]];
      tEnd = tT + 0.5;
    } else {
      keys = [[tUp, after], [Math.max(tUp + 0.05, tG), after], [Math.max(tUp + 0.1, tT - 0.32), THROW_WIND], [tT, THROW_REL, 'lin'], [tT + 0.5, STAND]];
      tEnd = tT + 0.5;
    }
    p.add(tUp, tEnd, (t) => ({
      x: stop[0],
      z: stop[1],
      yaw: opts.noThrow ? faceYaw : lerpAngle(faceYaw, throwYaw, smooth(win(t, Math.max(tUp, tT - 0.7), tT - 0.3))),
      pose: poseAt(t, keys),
    }));
    homes[name] = { ...home, x: stop[0], z: stop[1], yaw: opts.noThrow ? faceYaw : throwYaw, back: home };
    rest(name, tEnd, {});
    if (name !== 'keeper' && !opts.noThrow) goHome(name, tEnd + 0.4);
  }

  function goHome(name, t0) {
    const back = homes[name].back;
    if (!back) return;
    walkTo(name, t0, [back.x, back.z], { yaw: back.yaw, spot: { ...back, back: null } });
  }

  /**
   * The keeper comes up to the stumps for a throw at his running pace. If the
   * throw comes in before he can get there, he takes it where he has got to.
   */
  function keeperToStumps(t0, t1, tTake, from) {
    const start = xz(stateOf('keeper', t0));
    const pace = Math.min(4.2, ctl.m.diff.fielderSpeed * 0.75);
    const full = dist2(start, KEEP_ST) / pace + 0.3;
    const tStop = Math.min(t0 + full, tTake - 0.25);
    const frac = clamp((tStop - t0) / full, 0, 1);
    const end = [lerp(start[0], KEEP_ST[0], frac), lerp(start[1], KEEP_ST[1], frac)];
    const faceYaw = yawTo(end, from);
    if (tStop - t0 > 0.3 && dist2(start, end) > 0.1) plans.keeper.add(t0, tStop, (t) => walkLeg(t, t0, tStop, start, end, { easeK: 0.5, fromYaw: YAW_FIELD, toYaw: faceYaw }));
    const t2 = Math.max(t0, tStop);
    plans.keeper.add(t2, tTake + 0.6, (t) => ({ x: end[0], z: end[1], yaw: faceYaw, pose: poseAt(t, [[t2, KEEPER_UP], [tTake - 0.25, CATCH_CHEST], [tTake + 0.6, KEEPER_RELAXED]]) }));
    rest('keeper', tTake + 0.6, { x: end[0], z: end[1], yaw: faceYaw });
  }

  /** Whoever returns the ball turns to the bowler and throws. */
  function throwPose(name, tT, target) {
    const s = stateOf(name, tT - 0.4);
    const pos = [s.x, s.z];
    const y = yawTo(pos, target);
    plans[name].add(tT - 0.4, tT + 0.5, (t) => ({ ...s, x: pos[0], z: pos[1], yaw: lerpAngle(s.yaw, y, smooth(win(t, tT - 0.4, tT - 0.2))), pose: poseAt(t, [[tT - 0.4, STAND], [tT - 0.2, THROW_WIND], [tT, THROW_REL, 'lin'], [tT + 0.5, STAND]]), lift: 0, roll: 0 }));
  }
  /** Arms up to take the return, layered over whatever he is doing then. */
  function bowlerCatch(tB) {
    const base = plans.bowler.snapshot();
    plans.bowler.add(tB - 0.45, tB + 0.35, (t) => {
      const st = base(t);
      const c = smooth(Math.max(0, 1 - Math.abs(t - tB) / 0.45));
      const p = { ...st.pose };
      for (const j of ['shoulderL', 'shoulderR', 'elbowL', 'elbowR']) p[j] = [lerp(p[j][0], CATCH_CHEST[j][0], c), 0, lerp(p[j][2], CATCH_CHEST[j][2], c)];
      return { ...st, pose: p };
    });
  }

  // ---------------------------------------------------------------- no contact
  function scheduleNoContact(o, cur) {
    const { del, tR } = cur;
    const s = roles.striker;
    if (o.out === 'bowled') {
      // Bails off; the ball deflects off the stumps and dribbles toward the keeper.
      const tH = tR + del.tStumps;
      const p = del.atStumps;
      bailHit = { t: tH, seed: hash(ctl.m.balls + 1) };
      cur.stumpFx = { t: tH, p: v3(p) };
      ballPlan.add(tR, tH, (t) => ({ pos: del.pos(t - tR), flying: true }), 'delivery');
      const sim = simulateBatted(p, { az: Math.PI - 0.25 + hash(tH) * 0.5, speed: del.speed * 0.16, elev: 0.25 });
      return collect(sim, tH, cur, s);
    }
    const pad = o.pad ? del.padImpact(o.foot ?? 'stance') : null;
    if (pad) {
      const tH = tR + pad.t;
      ballPlan.add(tR, tH, (t) => ({ pos: del.pos(t - tR), flying: true }), 'delivery');
      const sim = simulateBatted(pad.p, { az: 0.6 + hash(tH * 3) * 1.2, speed: 2.6, elev: 0.1 });
      return collect(sim, tH, cur, s);
    }
    // Through to the keeper.
    const tK = tR + del.tKeeper;
    const bp = del.atKeeper;
    const y = bp.y;
    const takePose = y > 1.35 ? KEEPER_HIGH : y < 0.45 ? KEEPER_SQUAT : KEEPER_UP;
    const [ox, oz, oy] = handOffset('keeper', { x: 0, z: 0, yaw: YAW_FIELD, pose: takePose }, 'both');
    const kx = bp.x - ox;
    const kz = bp.z - oz;
    const lift = clamp(y - oy, 0, 0.5);
    plans.keeper.add(tR - 1.0, tK + 1.2, (t) => ({
      x: scalarAt(t, [[tR + 0.15, KEEP[0]], [tK - 0.05, kx], [tK + 0.8, kx], [tK + 1.2, KEEP[0]]]),
      z: scalarAt(t, [[tR + 0.15, KEEP[1]], [tK - 0.05, kz], [tK + 0.8, kz], [tK + 1.2, KEEP[1]]]),
      yaw: YAW_FIELD,
      pose: poseAt(t, [[tR - 1.0, KEEPER_RELAXED], [tR - 0.6, KEEPER_SQUAT], [tR + 0.15, KEEPER_SQUAT], [tK - 0.12, takePose], [tK + 0.6, takePose], [tK + 1.2, KEEPER_RELAXED]]),
      lift: lift * Math.sin(PI * win(t, tK - 0.3, tK + 0.3)),
    }));
    ballPlan.add(tR, tK, (t) => ({ pos: del.pos(t - tR), flying: true }), 'delivery');
    ballPlan.rest(tK, () => hold('keeper', 'both'));
    if (o.out && !ctl.nets) wicketFall(s, tK + 0.6, cur);
    else runBatters(0, tR + 0.6, cur);
    return { tDead: tK + 0.4, holder: 'keeper', side: 'both', tOut: tR + del.tStumps };
  }

  /** Off the stumps or the pad it dribbles away; the keeper walks up for it. */
  function collect(sim, tH, cur, s) {
    const last = sim.samples[sim.samples.length - 1];
    const tStop = tH + sim.tStop;
    ballPlan.add(tH, tStop, (t) => {
      const q = sampleAt(sim, t - tH);
      return { pos: new THREE.Vector3(q.x, q.y, q.z), flying: true };
    }, 'deflect');
    ballPlan.rest(tStop, () => ({ pos: new THREE.Vector3(last.x, BALL_R, last.z), flying: false }));
    // He walks up for it at a keeper's pace, from wherever he is.
    const kFrom = xz(stateOf('keeper', tH + 0.3));
    const kRun = dist2(kFrom, [last.x, last.z]) / Math.min(4.2, ctl.m.diff.fielderSpeed * 0.75) + 0.4;
    const tK = Math.max(tStop + 0.4, tH + 0.3 + kRun, tH + 1.2);
    field('keeper', [last.x, last.z], tH + 0.3, tK, 'pickup', { ballAt: new THREE.Vector3(last.x, BALL_R, last.z), tGather: tK + 0.2, tThrow: tK + 0.9, noThrow: true });
    ballPlan.add(tK, tK + 0.08, (t) => ({ blendFrom: new THREE.Vector3(last.x, BALL_R, last.z), k: smooth(win(t, tK, tK + 0.08)), hold: ['keeper', 'L'] }));
    ballPlan.rest(tK + 0.08, () => hold('keeper', 'L'));
    if (cur.outcome.out && !ctl.nets) wicketFall(s, tH + 0.8, cur);
    else runBatters(0, tH, cur);
    return { tDead: tK + 0.4, holder: 'keeper', side: 'L', tOut: tH };
  }

  // ---------------------------------------------------------------- batters
  /** Both batters run n runs from tc; returns when the last run is complete. */
  function runBatters(n, tc, cur) {
    const S = roles.striker;
    const N = roles.nonStriker;
    const t0 = tc + 0.2;
    if (n === 0) {
      const tb = Math.max(t0 + 0.6, cur.tR + 1.4);
      plans[N].add(tb, tb + 1.6, (t) => {
        const w = walkLeg(t, tb, tb + 1.6, NS_UP, NS_BASE);
        const turn = smooth(win(t, tb + 1.2, tb + 1.6));
        return { ...w, yaw: lerpAngle(PI / 2, -PI / 2, turn), bat: BATS.WALK, ik: false, pose: { ...w.pose, shoulderR: [-0.3, 0, 0.08] } };
      });
      rest(N, tb + 1.6, { x: NS_BASE[0], z: NS_BASE[1], yaw: -PI / 2 });
      cur.battersReady = Math.max(cur.battersReady ?? 0, tb + 1.6);
      return t0;
    }
    const endX = (k, fromS) => ((k % 2 === 0) === fromS ? END_S : END_N);
    const runOne = (name, fromS) => {
      const lane = LANE[name];
      const start = fromS ? [BAT_BASE[0] + 0.2, BAT_BASE[1]] : NS_UP;
      for (let k = 0; k < n; k++) {
        const a = k === 0 ? start : [endX(k, fromS), lane];
        const b = [endX(k + 1, fromS), lane];
        const ta = t0 + k * FK.runTime;
        const tb = ta + FK.runTime;
        const yaw = b[0] > a[0] ? PI / 2 : -PI / 2;
        const fy = k === 0 ? (fromS ? 0 : -PI / 2) : -yaw;
        plans[name].add(ta, tb, (t) => ({ ...walkLeg(t, ta, tb, a, b, { easeK: 0.45, fromYaw: fy, toYaw: yaw, turn: 0.15 }), bat: BATS.WALK, ik: false }));
      }
      const ex = endX(n, fromS);
      const atS = ex === END_S;
      const to = atS ? BAT_BASE : NS_BASE;
      const tA = t0 + n * FK.runTime;
      const from = [ex, lane];
      const toYaw = atS ? 0 : -PI / 2;
      plans[name].add(tA, tA + 1.4, (t) => ({ ...walkLeg(t, tA, tA + 1.4, from, to, { toYaw, turn: 0.4 }), bat: BATS.WALK, ik: false }));
      rest(name, tA + 1.4, { x: to[0], z: to[1], yaw: toYaw, role: atS ? 'striker' : 'nonStriker' });
      return tA + 1.4;
    };
    const e1 = runOne(S, true);
    const e2 = runOne(N, false);
    if (n % 2 === 1) Object.assign(roles, { striker: N, nonStriker: S });
    cur.battersReady = Math.max(cur.battersReady ?? 0, Math.max(e1, e2) + 0.8);
    return t0 + n * FK.runTime;
  }

  function wicketFall(out, tW, cur) {
    // He looks back, walks off through the gate; the spare comes in and takes guard.
    const inc = roles.spare;
    const gate = [GATE_PT.x, GATE_PT.z];
    const tOff = tW + 1.0;
    const d1 = dist2(BAT_BASE, gate);
    const tGate = tOff + d1 / 2.4;
    const tGone = tGate + 1.0;
    plans[out].add(tW, tOff, (t) => ({ x: BAT_BASE[0], z: BAT_BASE[1], yaw: scalarAt(t, [[tW, 0], [tOff, -0.6]]), pose: poseAt(t, [[tW, STANCE], [tW + 0.4, LOOK_BACK], [tOff, STAND]]), bat: batAt(t, [[tW, 'STANCE'], [tW + 0.4, 'LOOK_BACK'], [tOff, 'TUCK']]), ik: false }));
    plans[out].add(tOff, tGate, (t) => {
      const w = walkLeg(t, tOff, tGate, BAT_BASE, gate, { fromYaw: -0.6 });
      return { ...w, pose: { ...w.pose, head: [0.35, 0, 0], shoulderR: [0.15, 0, 0.32], elbowR: [-0.5, 0, 0] }, bat: BATS.TUCK, ik: false };
    });
    plans[out].add(tGate, tGone, (t) => ({ ...walkLeg(t, tGate, tGone, gate, [GATE_OUT.x, GATE_OUT.z], { linear: true }), bat: BATS.TUCK, ik: false }));
    rest(out, tGone, { x: GATE_OUT.x, z: GATE_OUT.z, yaw: 0, role: 'off' });

    const tIn0 = tW + 2.2;
    sfx(tIn0 + 0.5, 'applause', { size: 0.3 });
    const tIn1 = tIn0 + 0.8;
    const inGate = [GATE_PT.x + 0.7, GATE_PT.z + 0.2];
    const tCrease = tIn1 + d1 / 2.6;
    plans[inc].add(tIn0, tIn1, (t) => ({ ...walkLeg(t, tIn0, tIn1, [GATE_OUT.x, GATE_OUT.z], inGate, { linear: true }), bat: BATS.WALK, ik: false }));
    plans[inc].add(tIn1, tCrease, (t) => ({ ...walkLeg(t, tIn1, tCrease, inGate, BAT_BASE, { toYaw: 0, turn: 0.15 }), bat: BATS.WALK, ik: false }));
    const g = tCrease;
    plans[inc].add(g, g + 2.4, (t) => ({
      x: BAT_BASE[0], z: BAT_BASE[1], yaw: 0,
      pose: poseAt(t, [[g, STAND], [g + 0.5, GUARD], [g + 0.8, mixPose(GUARD, STANCE, 0.5)], [g + 1.1, GUARD], [g + 1.4, mixPose(GUARD, STANCE, 0.5)], [g + 1.7, GUARD], [g + 2.4, STANCE]]),
      bat: batAt(t, [[g, 'WALK'], [g + 0.5, 'GUARD'], [g + 1.8, 'GUARD'], [g + 2.4, 'STANCE']]),
      ik: t > g + 0.5,
    }));
    rest(inc, g + 2.4, { x: BAT_BASE[0], z: BAT_BASE[1], yaw: 0, role: 'striker' });
    Object.assign(roles, { striker: inc, spare: out });
    // The non-striker walks back to his crease.
    const N = roles.nonStriker;
    if (homes[N].x !== NS_BASE[0]) {
      const tb = cur.tR + 1.4;
      plans[N].add(tb, tb + 1.6, (t) => {
        const w = walkLeg(t, tb, tb + 1.6, NS_UP, NS_BASE);
        return { ...w, yaw: lerpAngle(PI / 2, -PI / 2, smooth(win(t, tb + 1.2, tb + 1.6))), bat: BATS.WALK, ik: false };
      });
      rest(N, tb + 1.6, { x: NS_BASE[0], z: NS_BASE[1], yaw: -PI / 2 });
    }
    cur.battersReady = Math.max(cur.battersReady ?? 0, g + 2.6);
  }

  function umpireSignal(pose, t0, dur, wave = false) {
    plans.umpire.add(t0, t0 + dur + 0.5, (t) => {
      let p = poseAt(t, [[t0, UMP_IDLE], [t0 + 0.3, pose], [t0 + dur, pose], [t0 + dur + 0.5, UMP_IDLE]]);
      if (wave && t > t0 + 0.3 && t < t0 + dur) p = { ...p, shoulderL: [p.shoulderL[0], 0, -0.2 + 0.55 * Math.sin((t - t0) * 9)] };
      return { x: UMP_BASE[0], z: UMP_BASE[1], yaw: lerpAngle(-PI / 2, PI / 2 + 0.4, smooth(win(t, t0, t0 + 0.3)) * (1 - smooth(win(t, t0 + dur, t0 + dur + 0.5)))), pose: p };
    });
  }

  // ---------------------------------------------------------------- render
  const marks = [0, 1, 2, 3].map(() => fx.addMark(0, 0));
  const markLog = [];
  const dustPitch = fx.dustPool(7, fx.dustMat ?? null);
  const starEdge = fx.starPool(7);
  const starStump = fx.starPool(8);

  // The read's marker on the pitch: a maroon ring (the zone) and an amber spot,
  // bold enough to read end-on from behind the bowler.
  const marker = new THREE.Group();
  const markMat = new THREE.MeshBasicMaterial({ color: 0x9a2731 });
  const spotMat = new THREE.MeshBasicMaterial({ color: 0xf3c94a });
  const ringGeo = new THREE.RingGeometry(0.66, 1, 40);
  ringGeo.rotateX(-Math.PI / 2);
  const ring = new THREE.Mesh(ringGeo, markMat);
  const spotGeo = new THREE.CircleGeometry(0.13, 16);
  spotGeo.rotateX(-Math.PI / 2);
  const spot = new THREE.Mesh(spotGeo, spotMat);
  marker.add(ring, spot);
  marker.visible = false;
  scene.add(marker);

  function ballAt(t) {
    const s = ballPlan.at(t);
    if (!s || s.hidden) return { pos: null, flying: false, hidden: true };
    if (s.pos) return { pos: s.pos, flying: !!s.flying };
    const [name, side] = s.hold;
    let p = palmsOf(name, side);
    if (s.blendFrom) p = s.blendFrom.clone().lerp(p, s.k);
    return { pos: p, flying: false };
  }

  /** The ball's world position at any time, past or future (applies the holder's pose at t). */
  function ballPosAt(t) {
    const s = ballPlan.at(t);
    if (!s || s.hidden) return null;
    if (s.pos) return new THREE.Vector3(s.pos.x, s.pos.y, s.pos.z);
    const [name, side] = s.hold;
    let p = palmAt(name, side, t);
    if (s.blendFrom) p = s.blendFrom.clone().lerp(p, s.k);
    return p;
  }

  /** opts.trail: false hides the ball's motion trail (slow-motion replays). */
  function render(t, opts = {}) {
    for (const name in plans) {
      const st = stateOf(name, t);
      if (st) cast[name].apply(st);
    }
    const b = ballAt(t);
    fx.ball.visible = !b.hidden;
    fx.ballShadow.visible = !b.hidden;
    if (!b.hidden) {
      fx.ball.position.copy(b.pos);
      fx.ball.rotation.set(t * 31, t * 7, 0);
      const hgt = Math.max(0, b.pos.y - BALL_R);
      fx.ballShadow.position.set(b.pos.x, 0.02, b.pos.z);
      const ss = 1 / (1 + hgt * 0.9);
      fx.ballShadow.scale.set(ss, ss, 1);
      fx.ballShadow.material.opacity = 0.55 * ss;
    }
    const segNow = ballPlan.seg(t);
    for (let i = 0; i < fx.trail.length; i++) {
      const tt = t - (i + 1) * 0.022;
      const s = ballPlan.seg(tt);
      const ok = opts.trail !== false && b.flying && segNow?.tag && s && s.tag === segNow.tag;
      fx.trail[i].visible = !!ok;
      if (ok) fx.trail[i].position.copy(s.fn(tt).pos);
    }

    // The read: in with a pop, out with a shrink (no fades).
    const cur = ctl.cur;
    const pv = cur?.preview;
    if (pv && t >= pv.t0 && t < pv.t1) {
      const k = smooth(win(t, pv.t0, pv.t0 + 0.18)) * (1 - smooth(win(t, pv.t1 - 0.18, pv.t1)));
      marker.visible = k > 0.01;
      marker.position.set(pv.x, 0.022, pv.z);
      ring.scale.set(pv.rx * k, 1, pv.rz * k);
      spot.scale.setScalar(k);
    } else marker.visible = false;

    // Bounce dust and marks that fade over a few overs.
    let dusting = false;
    if (cur && t >= cur.tBounce && t < cur.tBounce + 0.5) {
      const p = cur.del.bounce;
      fx.drive(dustPitch, t, cur.tBounce, p.x, 0.02, p.z, { seed: (ctl.m?.balls ?? 0) + 1, spread: 0.35, rise: 0.22, size: 0.055, dur: 0.5, bias: [-0.8, 0] });
      dusting = true;
      if (!markLog.some((e) => e.t === cur.tBounce)) {
        markLog.push({ x: p.x, z: p.z, t: cur.tBounce });
        if (markLog.length > marks.length) markLog.shift();
      }
    }
    if (!dusting) dustPitch.forEach((m) => (m.visible = false));
    marks.forEach((mk, i) => {
      const e = markLog[i];
      if (!e) return void (mk.visible = false);
      const s = 1 - win(t - e.t, 30, 60);
      mk.visible = s > 0.02;
      mk.position.set(e.x, 0.014, e.z);
      mk.scale.setScalar(Math.max(0.01, s));
    });
    fx.star(starEdge, t, cur?.edgeFx?.t ?? -10, cur?.edgeFx?.p ?? fx.ball.position, { size: 0.08, dur: 0.14 });
    fx.star(starStump, t, cur?.stumpFx?.t ?? -10, cur?.stumpFx?.p ?? fx.ball.position, { size: 0.1, dur: 0.16 });

    // Bails fly and the wicket rocks back.
    if (bailHit && t >= bailHit.t && (!ctl.cur || ctl.cur.T0 <= bailHit.t)) {
      const u = t - bailHit.t;
      bails.forEach((bl, i) => {
        const vx = -2.2 - i * 0.8;
        const vz = (i ? 1 : -1) * (0.6 + bailHit.seed);
        const vy = 2.6 + i * 0.5;
        const tl = (vy + Math.sqrt(vy * vy + 2 * 9.81 * bailRest[i].y)) / 9.81;
        const uu = Math.min(u, tl);
        bl.position.set(bailRest[i].x + vx * uu, Math.max(0.02, bailRest[i].y + vy * uu - 4.9 * uu * uu), bailRest[i].z + vz * uu);
        bl.rotation.set(uu * 14, uu * 5, uu * 9);
      });
      wicketGroup.rotation.z = 0.22 * smooth(win(u, 0, 0.12));
    } else {
      bails.forEach((bl, i) => {
        bl.position.copy(bailRest[i]);
        bl.rotation.set(0, 0, 0);
      });
      wicketGroup.rotation.z = 0;
    }
    board.update(t);
  }

  // ---------------------------------------------------------------- lifecycle
  /** opts.nets: practice, no target or result, the field stays at opts.field. opts.conditions: the day (conditions.js). */
  function startMatch(difficulty, seed, opts = {}) {
    ctl.difficulty = difficulty;
    ctl.seed = seed;
    ctl.nets = !!opts.nets;
    ctl.m = createMatch({ difficulty, seed, nets: ctl.nets, conditions: opts.conditions });
    ctl.events = [];
    ctl.cur = null;
    ctl.ff = false;
    releases.length = 0;
    bailHit = null;
    markLog.length = 0;
    initPlans(ctl.t);
    const plan = ctl.m.startOver();
    if (ctl.nets) ctl.m.field = fieldPositions(opts.field ?? 'balanced');
    setField(ctl.m.field, ctl.t - 1, false);
    if (ctl.nets) board.show(['NETS', 'CALIBRATION'], 'PLAY YOUR SHOTS', ctl.t);
    else board.show([`TARGET ${ctl.m.target}`, '0-0'], `${GAME.overs} OVERS`, ctl.t);
    hud.score(ctl.m, ctl.t);
    if (!ctl.nets) hud.over(ctl.m, plan, ctl.t);
    ctl.phase = 'live';
    const T0 = ctl.t + 1.6;
    at(T0, (t) => startBall(t));
    onEvent('start', { m: ctl.m });
  }
  /** Before the first game: the XI in the attacking field, standing by. */
  function preview(difficulty, seed) {
    ctl.m = createMatch({ difficulty, seed });
    ctl.cur = null;
    initPlans(ctl.t);
    setField(fieldPositions('attack'), ctl.t - 1, false);
    board.show(['THE CHASE', `TARGET ${ctl.m.target}`], 'PRESS ENTER', ctl.t);
  }

  /** Advance game time by dt real seconds; fast-forward runs dead time at 4x. */
  function update(dt) {
    if (['paused', 'feedback', 'tuning', 'scorecard', 'replay'].includes(ctl.phase)) return;
    // Fast-forward only ever skips dead time: never through a live delivery.
    if (ctl.ff && !(ctl.phase === 'live' && ctl.cur?.resolved && ctl.t < (ctl.nextT0 ?? 0) - 0.3)) ctl.ff = false;
    ctl.t += dt * (ctl.ff ? 4 : 1);
    runEvents();
    for (const k in plans) plans[k].prune(ctl.t);
    ballPlan.prune(ctl.t);
  }

  /** Nets: move the field without restarting. */
  function setNetsField(name, walk = true) {
    if (!ctl.m) return;
    ctl.m.field = fieldPositions(name);
    setField(ctl.m.field, ctl.t, walk);
  }

  Object.assign(ctl, { plans, homes, roles, ballPlan, startMatch, preview, update, render, ballAt, ballPosAt, stateOf, palmAt, at, setNetsField, handOffset, POSES: { DIVE, SLIDE, LUNGE_CATCH, PICKUP, FIELD_GATHER, CATCH_CHEST } });
  return ctl;
}
