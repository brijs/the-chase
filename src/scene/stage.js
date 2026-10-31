import * as THREE from 'three';
import { clamp, lerp, smooth, win, hash, LOOP, SEAM, PITCH, BALL_R } from '../config.js';
import {
  STAND,
  walkPose,
  mixPose,
  STANCE,
  BACKLIFT,
  PUSH,
  DRIVE_END,
  BACK_ACROSS,
  HIT,
  DOUBLED,
  KNEEL,
  GUARD,
  LOOK_BACK,
  BATS,
  mixBat,
  GATHER,
  BFC,
  FFC,
  RELEASE,
  FOLLOW,
  runUpPose,
  HANDS_ON_HEAD,
  HANDS_ON_HIPS,
  CELEBRATE,
  CATCH_CHEST,
  KEEPER_SQUAT,
  KEEPER_UP,
  KEEPER_HIGH,
  SLIP_SET,
  DIVE,
  DOWN_BALL_UP,
  THROW_WIND,
  THROW_REL,
  UMP_IDLE,
  UMP_WATCH,
  UMP_OUT,
} from './cricketPoses.js';
import { MARK, GATE } from './ground.js';
import { ease, easeOut, lerpAngle, amb, poseAt, batAt, scalarAt, walkLeg, breathe, solveFlight } from './motion.js';

/**
 * The beat sheet, and every actor as a pure function of t.
 *
 * Time runs in the domain [SEAM, SEAM + LOOP) = [3, 49): the walk back to the mark
 * and the incoming batter cross the loop seam, so a clock value under 3 s is read
 * as t + 46. Nothing here integrates or carries state between frames; flight
 * endpoints are solved once at load by evaluating the actors at the contact times,
 * so the ball always arrives in the hand that is there.
 */
const PI = Math.PI;
export const R = [6.0, 18.5, 32.0]; // release times

export const TL = {
  loop: LOOP,
  release: R,
  bounce: [R[0] + 0.4, R[1] + 0.27, R[2] + 0.46],
  keeperTake: R[0] + 0.98,
  helmet: R[1] + 0.62,
  edge: R[2] + 0.56,
  catch: R[2] + 1.0,
  throw1: [R[0] + 2.4, R[0] + 3.4],
  throw2: [R[1] + 6.9, R[1] + 7.9],
  handoff: [R[2] + 4.85, R[2] + 5.1],
  boardFlip: [R[0] + 2.4, R[1] + 2.4, R[2] + 2.4],
  outFinger: [R[2] + 1.6, R[2] + 3.6],
  batterAExit: [R[2] + 2.6, R[2] + 9.4],
  batterBIn: [R[2] + 5.6, R[2] + 12.0],
};

// ------------------------------------------------------------ places
const BAT_BASE = [-7.75, -0.32];
const KEEP_BASE = [-16.2, 0.55];
const SLIP1_BASE = [-15.95, 1.85];
const SLIP2_BASE = [-15.55, 3.1];
const UMP_BASE = [12.75, -0.28];
const NS_BASE = [11.0, -1.42];
const NS_UP = [9.05, -1.45];
const RUN_TAKEOFF = 11.9;
const BFC_X = 10.75;
const FFC_X = 10.3;
const REL_X = 10.05;
const FT_END = [5.4, 1.9];
const CLUSTER = {
  slip2: [-15.4, 3.95],
  bowler: [-14.6, 3.55],
  slip1: [-15.75, 3.05],
  keeper: [-13.9, 4.6],
};
const YAW_FIELD = 1.62; // keeper and slips face up the pitch

// ------------------------------------------------------------ bowler
const BOWL_YAW_RUN = -PI / 2;
const BOWL_YAW_SIDE = -PI;
const markArrive = [R[1] - 2.45 - 0.85, R[2] - 2.45 - 0.85, R[0] + LOOP - 2.45 - 1.35];
const walkBackStart = [R[0] + 2.4, R[1] + 4.4, R[2] + 5.15];
const walkBackFrom = [FT_END, [2.8, 1.1], CLUSTER.bowler];
const walkBackYaw = walkBackFrom.map((f) => Math.atan2(MARK.x - f[0], MARK.z - f[1]));
const FT_YAW = Math.atan2(FT_END[0] - REL_X, FT_END[1] - 0.52);

export function bowlerAt(t) {
  // Which delivery's cycle are we in? Each starts at the previous mark arrival.
  let k = 0;
  if (t >= markArrive[0]) k = 1;
  if (t >= markArrive[1]) k = 2;
  const Rk = R[k];
  const runStart = Rk - 2.45;
  const holdingBall = 1;

  // At the mark (cycle k == 0 starts at the domain start, already standing).
  if (t < runStart) {
    // Arriving walk/jog for k = 1, 2 is handled by the previous cycle's tail below.
    const arriveT = k === 0 ? SEAM : markArrive[k - 1];
    const turn = win(t, arriveT, arriveT + 0.6);
    const yaw = k === 0 ? BOWL_YAW_RUN : lerpAngle(walkBackYaw[k - 1], BOWL_YAW_RUN, turn);
    // Shines the ball on his trouser leg: bowling hand rubs the right thigh.
    const rub = amb(t, 23, 0.3);
    const pose = breathe(
      { ...STAND, shoulderL: [0.05 + rub * 0.08, 0, -0.18], elbowL: [-0.55 - rub * 0.1, 0, 0], shoulderR: [-0.1, 0, 0.12] },
      t,
      11,
      0.2
    );
    return { x: MARK.x, z: MARK.z, yaw, pose, ball: holdingBall };
  }
  // Run-up.
  if (t < Rk - 0.45) {
    const u = win(t, runStart, Rk - 0.45);
    const s = 0.25 * u + 0.75 * u * u;
    const x = lerp(MARK.x, RUN_TAKEOFF, s);
    const dist = MARK.x - x;
    const phase = (dist / 2.9) * 2 * PI;
    const p = mixPose(STAND, runUpPose(phase, win(u, 0.55, 0.95)), clamp(u * 5, 0, 1));
    return { x, z: lerp(MARK.z, 0.52, u), yaw: BOWL_YAW_RUN, pose: p };
  }
  // Bound: both feet off, gather, turning side-on in the air.
  if (t < Rk - 0.18) {
    const u = win(t, Rk - 0.45, Rk - 0.18);
    const lastRun = runUpPose(((MARK.x - RUN_TAKEOFF) / 2.9) * 2 * PI, 1);
    const pose = u < 0.55 ? mixPose(lastRun, GATHER, smooth(u / 0.55)) : mixPose(GATHER, BFC, smooth((u - 0.55) / 0.45));
    return {
      x: lerp(RUN_TAKEOFF, BFC_X, u),
      z: 0.52,
      yaw: lerp(BOWL_YAW_RUN, BOWL_YAW_SIDE, smooth(u)),
      pose,
      lift: 0.34 * 4 * u * (1 - u),
    };
  }
  // Back-foot contact -> front-foot contact -> release.
  if (t < Rk) {
    const u = win(t, Rk - 0.18, Rk);
    const pose = u < 0.55 ? mixPose(BFC, FFC, smooth(u / 0.55)) : mixPose(FFC, RELEASE, smooth((u - 0.55) / 0.45));
    return { x: lerp(BFC_X, REL_X, u), z: 0.52, yaw: BOWL_YAW_SIDE, pose };
  }
  // Follow-through: arm down and across, trunk folds, he opens up and runs off left.
  if (t < Rk + 1.3) {
    const u = win(t, Rk, Rk + 1.3);
    const e = easeOut(u);
    const x = lerp(REL_X, FT_END[0], e);
    const z = lerp(0.52, FT_END[1], e * e);
    const pathYaw = Math.atan2(FT_END[0] - REL_X, FT_END[1] - 0.52);
    const yaw = u < 0.25 ? lerp(BOWL_YAW_SIDE, -PI / 2 + 0.55, smooth(u / 0.25)) : lerpAngle(-PI / 2 + 0.55, pathYaw, smooth((u - 0.25) / 0.75));
    const dist = Math.hypot(x - REL_X, z - 0.52);
    const run = walkPose((dist / 2.6) * 2 * PI, { amp: 0.5 * (1 - u), armAmp: 0.5 * (1 - u), lean: 0.3, kneeBase: 0.15 });
    let pose;
    if (u < 0.22) pose = mixPose(RELEASE, FOLLOW, smooth(u / 0.22));
    else pose = mixPose(FOLLOW, run, smooth((u - 0.22) / 0.55));
    // Keep the bowling arm's windmill from unwinding as FOLLOW blends into the run.
    if (u >= 0.22) {
      const k2 = smooth((u - 0.22) / 0.55);
      pose.shoulderL = [lerp(FOLLOW.shoulderL[0], run.shoulderL[0], k2), 0, lerp(FOLLOW.shoulderL[2], run.shoulderL[2] - 2 * PI, k2)];
    }
    return { x, z, yaw, pose };
  }
  // Reactions and the walk back.
  if (k === 0) {
    if (t < walkBackStart[0]) {
      const u = win(t, Rk + 1.3, walkBackStart[0]);
      const pose = poseAt(t, [
        [Rk + 1.3, STAND],
        [Rk + 1.6, HANDS_ON_HEAD],
        [walkBackStart[0] - 0.25, HANDS_ON_HEAD],
        [walkBackStart[0], STAND],
      ]);
      return { x: FT_END[0], z: FT_END[1], yaw: lerpAngle(FT_YAW, walkBackYaw[0], smooth(u)), pose };
    }
  } else if (k === 1) {
    if (t < Rk + 2.8) {
      const w = walkLeg(t, Rk + 1.3, Rk + 2.8, FT_END, [2.8, 1.1], { fromYaw: FT_YAW, toYaw: -PI / 2 - 0.1 });
      return { ...w, pose: w.pose };
    }
    if (t < walkBackStart[1]) {
      const u = win(t, Rk + 2.8, walkBackStart[1]);
      const pose = poseAt(t, [
        [Rk + 2.8, STAND],
        [Rk + 3.2, HANDS_ON_HIPS],
        [walkBackStart[1] - 0.3, HANDS_ON_HIPS],
        [walkBackStart[1], STAND],
      ]);
      const yaw = lerpAngle(-PI / 2 - 0.1, walkBackYaw[1], smooth(win(u, 0.8, 1)));
      return { x: 2.8, z: 1.1, yaw, pose: breathe(pose, t, 13, 0.4) };
    }
  } else {
    // Sprint to the slips, celebrate, take the ball.
    if (t < Rk + 4.15) {
      const w = walkLeg(t, Rk + 1.3, Rk + 4.15, FT_END, CLUSTER.bowler, { fromYaw: FT_YAW, toYaw: -PI / 2 - 0.3, easeK: 0.3 });
      const u = win(t, Rk + 1.3, Rk + 4.15);
      const run = walkPose(w.phase * 0.82, { amp: 0.55, armAmp: 0.75, lean: 0.26, kneeBase: 0.15 });
      run.elbowL = [-0.8, 0, 0];
      run.elbowR = [-0.8, 0, 0];
      const k2 = clamp(Math.min(u, 1 - u) * 6, 0, 1);
      return { ...w, pose: mixPose(w.pose, run, k2) };
    }
    if (t < walkBackStart[2]) {
      const pose = poseAt(t, [
        [Rk + 4.15, STAND],
        [Rk + 4.32, CELEBRATE],
        [Rk + 4.6, CELEBRATE],
        [Rk + 4.85, CATCH_CHEST],
        [Rk + 5.15, STAND],
      ]);
      const lift = 0.28 * Math.max(0, Math.sin(PI * win(t, Rk + 4.2, Rk + 4.58)));
      const yaw = lerpAngle(-PI / 2 - 0.3, walkBackYaw[2], smooth(win(t, Rk + 4.95, Rk + 5.15)));
      return { x: CLUSTER.bowler[0], z: CLUSTER.bowler[1], yaw: t < Rk + 4.95 ? -PI / 2 - 0.3 : yaw, pose, lift };
    }
  }
  // Walk / jog back to the mark, catching the return throw on the way (arms only).
  const w = walkLeg(t, walkBackStart[k], markArrive[k], walkBackFrom[k], [MARK.x, MARK.z], { easeK: k === 2 ? 0.4 : 1 });
  if (!w) {
    // Arrived (only the last cycle ends inside the domain): turn to face the batter.
    const yaw = lerpAngle(walkBackYaw[k], BOWL_YAW_RUN, smooth(win(t, markArrive[k], markArrive[k] + 0.6)));
    return { x: MARK.x, z: MARK.z, yaw, pose: breathe(STAND, t, 11, 0.2) };
  }
  const throwEnd = k === 0 ? TL.throw1[1] : k === 1 ? TL.throw2[1] : -1;
  const c = throwEnd > 0 ? Math.max(0, 1 - Math.abs(t - throwEnd) / 0.45) : 0;
  if (c > 0) {
    const p = { ...w.pose };
    for (const j of ['shoulderL', 'shoulderR', 'elbowL', 'elbowR']) {
      p[j] = [lerp(p[j][0], CATCH_CHEST[j][0], smooth(c)), 0, lerp(p[j][2], CATCH_CHEST[j][2], smooth(c))];
    }
    return { ...w, pose: p };
  }
  return w;
}

// ------------------------------------------------------------ batters
function batterAAt(t) {
  const base = { x: BAT_BASE[0], z: BAT_BASE[1], yaw: 0 };
  const idle = (pose) => breathe(pose, t, 9, 1.1);
  // D1: back-lift, front-foot push, beaten outside off.
  if (t < R[1] - 1.4) {
    const r = R[0];
    const pose = poseAt(t, [
      [r - 0.1, STANCE],
      [r + 0.25, BACKLIFT],
      [r + 0.55, PUSH],
      [r + 1.1, PUSH],
      [r + 1.9, LOOK_BACK],
      [r + 2.8, GUARD],
      [r + 4.0, STANCE],
    ]);
    const bat = batAt(t, [
      [r - 0.1, 'STANCE'],
      [r + 0.25, 'BACKLIFT'],
      [r + 0.55, 'PUSH'],
      [r + 1.1, 'PUSH'],
      [r + 1.9, 'LOOK_BACK'],
      [r + 2.8, 'GUARD'],
      [r + 4.0, 'STANCE'],
    ]);
    const dx = scalarAt(t, [[r + 0.25, 0], [r + 0.55, 0.32], [r + 1.1, 0.32], [r + 1.9, 0]]);
    const yaw = scalarAt(t, [[r + 0.25, 0], [r + 0.55, 0.45], [r + 1.1, 0.45], [r + 1.9, -0.25], [r + 2.8, 0]]);
    return { ...base, x: base.x + dx, yaw, pose: idle(pose), bat, ik: true };
  }
  // D2: back and across, hit on the helmet, stagger, kneel, recover.
  if (t < R[2] - 1.4) {
    const r = R[1];
    const h = TL.helmet;
    const pose = poseAt(t, [
      [r - 0.05, STANCE],
      [r + 0.3, BACK_ACROSS],
      [h, BACK_ACROSS],
      [h + 0.13, HIT, 'lin'],
      [h + 0.9, DOUBLED],
      [h + 1.6, KNEEL],
      [h + 4.3, KNEEL],
      [h + 5.0, DOUBLED],
      [h + 5.6, STAND],
      [h + 7.4, GUARD],
      [h + 8.2, GUARD],
      [h + 9.0, STANCE],
    ]);
    const bat = batAt(t, [
      [r - 0.05, 'STANCE'],
      [r + 0.3, 'BACK_ACROSS'],
      [h, 'BACK_ACROSS'],
      [h + 0.13, 'HIT'],
      [h + 0.9, 'DOUBLED'],
      [h + 1.6, 'KNEEL'],
      [h + 4.3, 'KNEEL'],
      [h + 5.0, 'DOUBLED'],
      [h + 5.6, 'WALK'],
      [h + 7.4, 'GUARD'],
      [h + 9.0, 'STANCE'],
    ]);
    const dx = scalarAt(t, [[r + 0.0, 0], [r + 0.3, -0.18], [h, -0.18], [h + 0.3, -0.45, 'out'], [h + 1.4, -0.95], [h + 5.6, -0.95], [h + 7.2, 0]]);
    const dz = scalarAt(t, [[h, 0], [h + 0.3, -0.12, 'out'], [h + 1.4, -0.75], [h + 5.6, -0.75], [h + 7.2, 0]]);
    const yaw = scalarAt(t, [[h, 0], [h + 0.15, -0.65, 'out'], [h + 1.4, -0.9], [h + 5.6, -0.6], [h + 6.4, 0.4], [h + 7.4, 0]]);
    // The bottom hand comes off the bat at the hit and goes to the helmet.
    const ik = t < h || t > h + 6.9;
    let p = pose;
    // Two short stagger steps while doubled up (distance-driven, from dx/dz).
    if (t > h + 0.3 && t < h + 1.4) {
      const st = walkPose(win(t, h + 0.3, h + 1.4) * 2 * PI, { amp: 0.2, armAmp: 0, kneeBase: 0.3 });
      p = { ...pose, hipL: st.hipL.map((v, i) => v + pose.hipL[i]), hipR: st.hipR.map((v, i) => v + pose.hipR[i]) };
    }
    // Walking back to the crease after he gets up.
    if (t > h + 5.6 && t < h + 7.2) {
      const st = walkPose(win(t, h + 5.6, h + 7.2) * 3 * 2 * PI, { amp: 0.28, armAmp: 0.2 });
      p = { ...pose, hipL: st.hipL, hipR: st.hipR, kneeL: st.kneeL, kneeR: st.kneeR, ankleL: st.ankleL, ankleR: st.ankleR };
    }
    return { ...base, x: base.x + dx, z: base.z + dz, yaw, pose: idle(p), bat, ik, hit: t >= h };
  }
  // D3: drive, outside edge, look back, walk off.
  const r = R[2];
  const e = TL.edge;
  const [x0, x1] = TL.batterAExit;
  if (t < x0) {
    const pose = poseAt(t, [
      [r - 0.1, STANCE],
      [r + 0.3, BACKLIFT],
      [e, PUSH],
      [e + 0.32, DRIVE_END],
      [e + 1.1, LOOK_BACK],
      [x0, LOOK_BACK],
    ]);
    const bat = batAt(t, [
      [r - 0.1, 'STANCE'],
      [r + 0.3, 'BACKLIFT'],
      [e, 'PUSH'],
      [e + 0.32, 'DRIVE_END'],
      [e + 1.1, 'LOOK_BACK'],
      [x0 - 0.4, 'LOOK_BACK'],
      [x0, 'TUCK'],
    ]);
    const dx = scalarAt(t, [[r + 0.3, 0], [e, 0.35], [e + 0.32, 0.4], [e + 1.1, 0.2]]);
    const yaw = scalarAt(t, [[r + 0.3, 0], [e, 0.45], [e + 0.32, 0.55], [e + 1.1, -0.35], [x0, -0.5]]);
    return { ...base, x: base.x + dx, yaw, pose: idle(pose), bat, ik: t < e + 1.1, hit: true };
  }
  // Walk off through the pavilion gate, bat under the arm, head down.
  const gate = [-9.65, GATE.z];
  const out = [-9.95, -8.7];
  const split = x0 + (x1 - x0) * 0.72;
  const from = [BAT_BASE[0] + 0.2, BAT_BASE[1]];
  const w = t < split ? walkLeg(t, x0, split, from, gate, { fromYaw: -0.5 }) : walkLeg(t, split, x1, gate, out, { linear: true });
  if (!w) return { ...base, visible: false };
  const p = { ...w.pose, head: [0.35, 0, 0], shoulderR: [0.15, 0, 0.32], elbowR: [-0.5, 0, 0] };
  return { ...w, pose: p, bat: BATS.TUCK, ik: false, hit: true, visible: t < x1 };
}

function batterBAt(t) {
  const [b0, b1] = TL.batterBIn;
  if (t < b0) return { visible: false, x: -8.1, z: -8.7, yaw: PI };
  const gate = [-8.1, GATE.z];
  const from = [-8.1, -8.7];
  const to = BAT_BASE;
  const split = b0 + (b1 - b0) * 0.3;
  if (t < b1) {
    const w = t < split ? walkLeg(t, b0, split, from, gate, { linear: true }) : walkLeg(t, split, b1, gate, to);
    const p = { ...w.pose, shoulderR: [w.pose.shoulderR[0] * 0.4, 0, 0.12] };
    return { ...w, pose: p, bat: BATS.WALK, ik: false };
  }
  // Turn square, take guard (two taps), settle into the stance that is t = 0.
  const pose = poseAt(t, [
    [b1, STAND],
    [b1 + 0.6, GUARD],
    [b1 + 0.9, mixPose(GUARD, STANCE, 0.5)],
    [b1 + 1.2, GUARD],
    [b1 + 1.5, mixPose(GUARD, STANCE, 0.5)],
    [b1 + 1.8, GUARD],
    [b1 + 2.8, STANCE],
  ]);
  const bat = batAt(t, [
    [b1, 'WALK'],
    [b1 + 0.6, 'GUARD'],
    [b1 + 2.0, 'GUARD'],
    [b1 + 2.8, 'STANCE'],
  ]);
  const yaw = scalarAt(t, [[b1, Math.atan2(to[0] - gate[0], to[1] - gate[1])], [b1 + 0.6, 0]]);
  return { x: to[0], z: to[1], yaw, pose: breathe(pose, t, 9, 1.1), bat, ik: t > b1 + 0.6 };
}

// ------------------------------------------------------------ fielders
function keeperAt(t) {
  const base = { x: KEEP_BASE[0], z: KEEP_BASE[1], yaw: YAW_FIELD };
  const between = (pose) => breathe(pose, t, 8, 2.2);
  const relaxed = { ...KEEPER_UP, torso: [0.18, 0, 0], hipL: [-0.2, 0, -0.18], hipR: [-0.2, 0, 0.18], kneeL: [0.3, 0, 0], kneeR: [0.3, 0, 0], ankleL: [-0.1, 0, 0], ankleR: [-0.1, 0, 0], shoulderL: [-0.4, 0, 0.1], shoulderR: [-0.4, 0, -0.1] };
  // D1: squat, rise, take it at the chest, throw back.
  if (t < R[1] - 2.0) {
    const r = R[0];
    const tk = TL.keeperTake;
    const pose = poseAt(t, [
      [r - 1.0, relaxed],
      [r - 0.6, KEEPER_SQUAT],
      [r + 0.15, KEEPER_SQUAT],
      [r + 0.6, KEEPER_UP],
      [tk + 0.3, KEEPER_UP],
      [TL.throw1[0] - 0.35, THROW_WIND],
      [TL.throw1[0], THROW_REL, 'lin'],
      [TL.throw1[0] + 0.6, relaxed],
    ]);
    const dz = scalarAt(t, [[r + 0.3, 0], [tk - 0.1, 0.3], [tk + 1.2, 0.3], [TL.throw1[0] + 1.5, 0]]);
    return { ...base, z: base.z + dz, pose: between(pose) };
  }
  // D2: deflection off the helmet: up, across to collect, walk to the batter.
  if (t < R[2] - 2.0) {
    const r = R[1];
    const h = TL.helmet;
    const g = h + 1.1; // gathers it
    const walkIn = walkLeg(t, h + 1.8, h + 3.6, [-15.3, -0.6], [-10.1, -1.25], { fromYaw: YAW_FIELD, toYaw: 1.9 });
    if (walkIn) return walkIn;
    if (t >= h + 3.6 && t < h + 4.4) return { x: -10.1, z: -1.25, yaw: 1.9, pose: between(HANDS_ON_HIPS) };
    const walkBack = walkLeg(t, h + 4.4, TL.throw2[0] - 0.6, [-10.1, -1.25], [-12.4, -0.4], { fromYaw: 1.9, toYaw: PI / 2, turn: 0.3 });
    if (walkBack) return walkBack;
    if (t >= TL.throw2[0] - 0.6 && t < TL.throw2[0] + 0.7) {
      const pose = poseAt(t, [
        [TL.throw2[0] - 0.6, STAND],
        [TL.throw2[0] - 0.3, THROW_WIND],
        [TL.throw2[0], THROW_REL, 'lin'],
        [TL.throw2[0] + 0.7, STAND],
      ]);
      return { x: -12.4, z: -0.4, yaw: PI / 2, pose };
    }
    const home = walkLeg(t, TL.throw2[0] + 0.7, TL.throw2[0] + 3.0, [-12.4, -0.4], KEEP_BASE, { fromYaw: PI / 2, toYaw: YAW_FIELD, turn: 0.3 });
    if (home) return home;
    const pose = poseAt(t, [
      [r - 1.0, relaxed],
      [r - 0.6, KEEPER_SQUAT],
      [r + 0.15, KEEPER_SQUAT],
      [r + 0.55, KEEPER_UP],
      [h + 0.25, KEEPER_HIGH],
      [g - 0.25, KEEPER_UP],
      [g, mixPose(KEEPER_UP, KEEPER_SQUAT, 0.5)],
      [g + 0.6, STAND],
    ]);
    const x = scalarAt(t, [[h, KEEP_BASE[0]], [g, -15.3]]);
    const z = scalarAt(t, [[h, KEEP_BASE[1]], [g, -0.6]]);
    return { x, z, yaw: YAW_FIELD, pose: t > TL.throw2[0] + 3.0 ? between(relaxed) : between(pose) };
  }
  // D3: up, then run to the catcher and celebrate; walk home.
  const r = R[2];
  const kc = Math.atan2(CLUSTER.slip2[0] - CLUSTER.keeper[0], CLUSTER.slip2[1] - CLUSTER.keeper[1]);
  // Leaves after first slip has gone, and walks home through a waypoint that
  // clears both slips' stations (the sweep found the straight lines jammed).
  const KEEP_WAY = [-14.9, 1.0];
  const run = walkLeg(t, r + 1.6, r + 2.7, KEEP_BASE, CLUSTER.keeper, { fromYaw: YAW_FIELD, toYaw: kc });
  if (run) return run;
  const yWay = Math.atan2(KEEP_WAY[0] - CLUSTER.keeper[0], KEEP_WAY[1] - CLUSTER.keeper[1]);
  const home1 = walkLeg(t, r + 6.4, r + 8.0, CLUSTER.keeper, KEEP_WAY, { fromYaw: kc });
  if (home1) return home1;
  const home = walkLeg(t, r + 8.0, r + 8.8, KEEP_WAY, KEEP_BASE, { fromYaw: yWay, toYaw: YAW_FIELD, turn: 0.4 });
  if (home) return home;
  if (t >= r + 1.2 && t < r + 1.6) {
    return { ...base, pose: poseAt(t, [[r + 1.2, STAND], [r + 1.6, STAND]]) };
  }
  if (t >= r + 2.7 && t < r + 6.4) {
    const pose = poseAt(t, [
      [r + 2.7, STAND],
      [r + 2.95, CELEBRATE],
      [r + 3.9, CELEBRATE],
      [r + 4.5, STAND],
    ]);
    return { x: CLUSTER.keeper[0], z: CLUSTER.keeper[1], yaw: kc, pose };
  }
  const pose = poseAt(t, [
    [r - 1.0, relaxed],
    [r - 0.6, KEEPER_SQUAT],
    [r + 0.15, KEEPER_SQUAT],
    [r + 0.6, KEEPER_UP],
    [r + 1.2, STAND],
  ]);
  return { ...base, pose: t > r + 8.8 ? between(relaxed) : between(pose) };
}

function slipAt(t, which) {
  const baseXZ = which === 1 ? SLIP1_BASE : SLIP2_BASE;
  const base = { x: baseXZ[0], z: baseXZ[1], yaw: YAW_FIELD - (which === 1 ? 0.04 : 0.08) };
  const phase = which * 1.7;
  const stand = { ...STAND, shoulderL: [-0.25, 0, -0.1], shoulderR: [-0.25, 0, 0.1], elbowL: [-0.5, 0, 0], elbowR: [-0.5, 0, 0] };
  const setKeys = (r, after) => [
    [r - 1.0, stand],
    [r - 0.6 - which * 0.05, SLIP_SET],
    [r + 0.75, SLIP_SET],
    [r + 1.1, after],
  ];
  if (t < R[1] - 2.0) {
    const r = R[0];
    const pose = poseAt(t, [...setKeys(r, STAND), [r + 1.3, HANDS_ON_HEAD], [r + 2.2, HANDS_ON_HEAD], [r + 2.7, stand]]);
    return { ...base, pose: breathe(pose, t, 7 + which, phase) };
  }
  if (t < R[2] - 2.0) {
    const r = R[1];
    const pose = poseAt(t, [...setKeys(r, STAND), [r + 1.6, HANDS_ON_HIPS], [r + 5.0, HANDS_ON_HIPS], [r + 5.6, stand]]);
    return { ...base, pose: breathe(pose, t, 7 + which, phase) };
  }
  const r = R[2];
  if (which === 1) {
    const sc = Math.atan2(CLUSTER.slip2[0] - CLUSTER.slip1[0], CLUSTER.slip2[1] - CLUSTER.slip1[1]);
    const run = walkLeg(t, r + 1.15, r + 1.95, SLIP1_BASE, CLUSTER.slip1, { fromYaw: base.yaw, toYaw: sc });
    if (run) return run;
    const home = walkLeg(t, r + 4.8, r + 6.6, CLUSTER.slip1, SLIP1_BASE, { fromYaw: sc, toYaw: base.yaw, turn: 0.3 });
    if (home) return home;
    if (t >= r + 1.95 && t < r + 4.8) {
      const pose = poseAt(t, [[r + 1.95, STAND], [r + 2.2, CELEBRATE], [r + 3.9, CELEBRATE], [r + 4.6, STAND]]);
      return { x: CLUSTER.slip1[0], z: CLUSTER.slip1[1], yaw: sc, pose };
    }
    const pose = poseAt(t, [...setKeys(r, STAND)]);
    return { ...base, pose: breathe(t > r + 6.6 ? stand : pose, t, 7 + which, phase) };
  }
  // Second slip: the dive.
  const c = TL.catch;
  if (t >= r + 0.58 && t < c + 1.9) {
    const takeoff = r + 0.58;
    const land = c + 0.12;
    const zDive = scalarAt(t, [[takeoff, SLIP2_BASE[1]], [land, CLUSTER.slip2[1], 'out']]);
    const xDive = scalarAt(t, [[takeoff, SLIP2_BASE[0]], [land, CLUSTER.slip2[0]]]);
    const roll = scalarAt(t, [[takeoff, 0], [c - 0.05, 1.42], [c + 0.9, 1.42], [c + 1.9, 0.0]]);
    const lift = 0.3 * Math.sin(PI * win(t, takeoff, land));
    const pose = poseAt(t, [
      [takeoff, SLIP_SET],
      [c - 0.12, DIVE],
      [c + 0.3, DIVE],
      [c + 0.9, DOWN_BALL_UP],
      [c + 1.9, CELEBRATE],
    ]);
    return { x: xDive, z: zDive, yaw: base.yaw, pose, roll, lift };
  }
  if (t >= c + 1.9 && t < TL.handoff[1] + 0.3) {
    const pose = poseAt(t, [
      [c + 1.9, CELEBRATE],
      [c + 3.2, CELEBRATE],
      [TL.handoff[0] - 0.3, { ...STAND, shoulderL: [-1.25, 0, 0.1], elbowL: [-0.3, 0, 0] }],
      [TL.handoff[1], { ...STAND, shoulderL: [-1.25, 0, 0.1], elbowL: [-0.3, 0, 0] }],
      [TL.handoff[1] + 0.3, STAND],
    ]);
    const lift = 0.22 * Math.max(0, Math.sin(PI * win(t, c + 2.3, c + 2.75)));
    const yaw = lerpAngle(base.yaw, Math.atan2(CLUSTER.bowler[0] - CLUSTER.slip2[0], CLUSTER.bowler[1] - CLUSTER.slip2[1]), smooth(win(t, c + 1.9, c + 2.4)));
    return { x: CLUSTER.slip2[0], z: CLUSTER.slip2[1], yaw, pose, lift };
  }
  const s2y = Math.atan2(CLUSTER.bowler[0] - CLUSTER.slip2[0], CLUSTER.bowler[1] - CLUSTER.slip2[1]);
  const home = walkLeg(t, TL.handoff[1] + 0.3, TL.handoff[1] + 2.4, CLUSTER.slip2, SLIP2_BASE, { fromYaw: s2y, toYaw: base.yaw, turn: 0.3 });
  if (home) return home;
  const pose = poseAt(t, [...setKeys(r, STAND)]);
  return { ...base, pose: breathe(t > TL.handoff[1] + 2.4 ? stand : pose, t, 7 + which, phase) };
}

function umpireAt(t) {
  const keys = [];
  for (const r of R) {
    keys.push([r - 1.0, UMP_IDLE], [r - 0.5, UMP_WATCH], [r + 0.8, UMP_WATCH], [r + 1.3, UMP_IDLE]);
  }
  let pose = poseAt(t, keys);
  const [f0, f1] = TL.outFinger;
  if (t > f0 - 0.4 && t < f1 + 0.5) {
    pose = poseAt(t, [[f0 - 0.4, UMP_IDLE], [f0, UMP_OUT], [f1, UMP_OUT], [f1 + 0.5, UMP_IDLE]]);
  }
  // Flinches at the bouncer: a half-turn of the head toward the batter.
  if (t > TL.helmet - 0.1 && t < TL.helmet + 1.2) {
    const k = Math.sin(PI * win(t, TL.helmet - 0.1, TL.helmet + 1.2));
    pose = { ...pose, head: [pose.head[0] - 0.12 * k, pose.head[1], pose.head[2]], torso: [pose.torso[0] - 0.08 * k, 0, 0] };
  }
  return { x: UMP_BASE[0], z: UMP_BASE[1], yaw: -PI / 2, pose: breathe(pose, t, 6, 3.3) };
}

function nonStrikerAt(t) {
  const hold = { ...STAND, shoulderR: [-0.35, 0, 0.08], elbowR: [-0.2, 0, 0] };
  for (const r of R) {
    const up = walkLeg(t, r - 0.5, r + 0.45, NS_BASE, NS_UP);
    if (up) return { ...up, yaw: -PI / 2, bat: BATS.WALK, ik: false, pose: { ...up.pose, shoulderR: [-0.35, 0, 0.08] } };
    if (t >= r + 0.45 && t < r + 1.4) return { x: NS_UP[0], z: NS_UP[1], yaw: -PI / 2, pose: breathe(hold, t, 10, 0.7), bat: BATS.WALK, ik: false };
    const back = walkLeg(t, r + 1.4, r + 3.0, NS_UP, NS_BASE);
    if (back) {
      const turn = smooth(win(t, r + 2.6, r + 3.0));
      return { ...back, yaw: lerpAngle(PI / 2, -PI / 2, turn), bat: BATS.WALK, ik: false, pose: { ...back.pose, shoulderR: [-0.3, 0, 0.08] } };
    }
  }
  return { x: NS_BASE[0], z: NS_BASE[1], yaw: -PI / 2, pose: breathe(hold, t, 10, 0.7), bat: BATS.WALK, ik: false };
}

export function createStage({ cast, fx, board }) {
  const S = {
    bowler: bowlerAt,
    batterA: batterAAt,
    batterB: batterBAt,
    nonStriker: nonStrikerAt,
    keeper: keeperAt,
    slip1: (t) => slipAt(t, 1),
    slip2: (t) => slipAt(t, 2),
    umpire: umpireAt,
  };
  const actors = Object.keys(S);
  const evalActor = (name, t) => {
    const st = S[name](t);
    cast[name].apply(st);
    return st;
  };
  const palm = (name, side, t) => {
    evalActor(name, t);
    return cast[name].palm(side, new THREE.Vector3());
  };
  const twoPalms = (name, t) => {
    evalActor(name, t);
    const a = cast[name].palm('L', new THREE.Vector3());
    const b = cast[name].palm('R', new THREE.Vector3());
    return a.add(b).multiplyScalar(0.5);
  };

  // ---- solve contact points from the actors themselves, once.
  const rel = R.map((r) => palm('bowler', 'L', r));
  const keeperTake = twoPalms('keeper', TL.keeperTake);
  evalActor('batterA', TL.helmet);
  const helmetPt = cast.batterA.joints.head.localToWorld(new THREE.Vector3(0.0, 0.11, 0.17));
  evalActor('batterA', TL.edge);
  const edgePt = cast.batterA.bat.localToWorld(new THREE.Vector3(0.058, -0.66, 0.0));
  const catchPt = twoPalms('slip2', TL.catch);
  const gather2 = twoPalms('keeper', TL.helmet + 1.1);
  const thr1 = [palm('keeper', 'L', TL.throw1[0]), palm('bowler', 'L', TL.throw1[1])];
  const thr2 = [palm('keeper', 'L', TL.throw2[0]), palm('bowler', 'L', TL.throw2[1])];

  const bounces = [
    new THREE.Vector3(-2.3, BALL_R, 0.1),
    new THREE.Vector3(2.0, BALL_R, -0.08),
    new THREE.Vector3(-4.2, BALL_R, 0.08),
  ];
  const deflectLand = new THREE.Vector3(-12.9, BALL_R, -0.9);
  const flights = [
    // [t0, t1, fn]
    [R[0], TL.bounce[0], solveFlight(rel[0], bounces[0], TL.bounce[0] - R[0], 2.2)],
    [TL.bounce[0], TL.keeperTake, solveFlight(bounces[0], keeperTake, TL.keeperTake - TL.bounce[0], 1.6)],
    [TL.throw1[0], TL.throw1[1], solveFlight(thr1[0], thr1[1], TL.throw1[1] - TL.throw1[0])],
    [R[1], TL.bounce[1], solveFlight(rel[1], bounces[1], TL.bounce[1] - R[1])],
    [TL.bounce[1], TL.helmet, solveFlight(bounces[1], helmetPt, TL.helmet - TL.bounce[1])],
    [TL.helmet, TL.helmet + 0.68, solveFlight(helmetPt, deflectLand, 0.68)],
    [TL.helmet + 0.68, TL.helmet + 1.1, solveFlight(deflectLand, gather2, 0.42)],
    [TL.throw2[0], TL.throw2[1], solveFlight(thr2[0], thr2[1], TL.throw2[1] - TL.throw2[0])],
    [R[2], TL.bounce[2], solveFlight(rel[2], bounces[2], TL.bounce[2] - R[2], 2.4)],
    [TL.bounce[2], TL.edge, solveFlight(bounces[2], edgePt, TL.edge - TL.bounce[2], 1.2)],
    [TL.edge, TL.catch, solveFlight(edgePt, catchPt, TL.catch - TL.edge)],
  ];
  /** Who holds the ball when it is not in flight. */
  function holder(t) {
    if (t < R[0]) return ['bowler', 'L'];
    if (t < TL.keeperTake) return null;
    if (t < TL.throw1[0] - 0.45) return ['keeper', 'both'];
    if (t < TL.throw1[0]) return ['keeper', 'L']; // into the throwing hand for the wind-up
    if (t < TL.throw1[1]) return null;
    if (t < R[1]) return ['bowler', 'L'];
    if (t < TL.helmet + 1.1) return null;
    if (t < TL.throw2[0] - 0.45) return ['keeper', 'both'];
    if (t < TL.throw2[0]) return ['keeper', 'L'];
    if (t < TL.throw2[1]) return null;
    if (t < R[2]) return ['bowler', 'L'];
    if (t < TL.catch) return null;
    if (t < TL.handoff[0]) return ['slip2', 'both'];
    if (t < TL.handoff[1]) return ['handoff'];
    return ['bowler', 'L'];
  }

  const dustPitch = fx.dustPool(7, fx.dustMat ?? null);
  const dustDive = fx.dustPool(9, fx.dustMat ?? null);
  const starHelmet = fx.starPool(10);
  const starEdge = fx.starPool(7);
  const marks = bounces.map((b) => fx.addMark(b.x, b.z));

  const ballPos = new THREE.Vector3();
  function ballAt(t) {
    for (const [t0, t1, fn] of flights) {
      if (t >= t0 && t < t1) return { pos: fn(t - t0), flying: true };
    }
    const h = holder(t);
    if (!h) return { pos: ballPos.clone(), flying: false };
    if (h[0] === 'handoff') {
      const k = smooth(win(t, TL.handoff[0], TL.handoff[1]));
      const a = cast.slip2.palm('L', new THREE.Vector3());
      const b = cast.bowler.palm('L', new THREE.Vector3());
      return { pos: a.lerp(b, k), flying: false };
    }
    const actor = cast[h[0]];
    if (h[1] === 'both') {
      const a = actor.palm('L', new THREE.Vector3());
      const b = actor.palm('R', new THREE.Vector3());
      return { pos: a.add(b).multiplyScalar(0.5), flying: false };
    }
    return { pos: actor.palm(h[1], new THREE.Vector3()), flying: false };
  }

  const state = { t: 0, moving: {} };
  function update(t) {
    state.t = t;
    for (const name of actors) {
      const st = S[name](t);
      cast[name].apply(st);
      state.moving[name] = !!st.moving;
      if (cast[name].helmet && name === 'batterA') {
        const h = cast[name].helmet;
        const flash = t >= TL.helmet && t < TL.helmet + 0.1;
        h.shell.color.copy(flash ? fx.flashColour : fx.maroonColour);
        h.scuff.visible = !!st.hit && t >= TL.helmet;
      }
    }

    // Ball, trail, shadow, spin.
    const b = ballAt(t);
    fx.ball.position.copy(b.pos);
    fx.ball.rotation.set(t * 31, t * 7, 0);
    fx.ball.visible = true;
    for (let i = 0; i < fx.trail.length; i++) {
      const tt = t - (i + 1) * 0.022;
      const p = b.flying ? ballAt(tt) : null;
      fx.trail[i].visible = !!(p && p.flying);
      if (p && p.flying) fx.trail[i].position.copy(p.pos);
    }
    const hgt = Math.max(0, b.pos.y - BALL_R);
    fx.ballShadow.position.set(b.pos.x, 0.02, b.pos.z);
    const ss = 1 / (1 + hgt * 0.9);
    fx.ballShadow.scale.set(ss, ss, 1);
    fx.ballShadow.material.opacity = 0.55 * ss;

    // Pitch dust at the bounce; the mark stays, then shrinks away over 8 s.
    let dustDone = false;
    for (let i = 0; i < 3; i++) {
      const tb = TL.bounce[i];
      if (!dustDone && t >= tb && t < tb + 0.5) {
        fx.drive(dustPitch, t, tb, bounces[i].x, 0.02, bounces[i].z, { seed: i + 1, spread: 0.35, rise: 0.22, size: 0.055, dur: 0.5, bias: [-0.8, 0] });
        dustDone = true;
      }
      const age = t >= tb ? t - tb : t + LOOP - tb;
      const s = 1 - win(age, 7, 15);
      marks[i].visible = s > 0.02;
      marks[i].scale.setScalar(Math.max(0.01, s));
    }
    if (!dustDone) dustPitch.forEach((m) => (m.visible = false));
    fx.star(starHelmet, t, TL.helmet, helmetPt, { size: 0.13, dur: 0.16 });
    fx.star(starEdge, t, TL.edge, edgePt, { size: 0.08, dur: 0.14 });
    const diveLand = new THREE.Vector3(CLUSTER.slip2[0], 0.02, CLUSTER.slip2[1]);
    fx.drive(dustDive, t, TL.catch + 0.1, diveLand.x, 0.02, diveLand.z, { seed: 9, spread: 0.7, rise: 0.3, size: 0.07, dur: 0.6, bias: [0, 0.6] });

    board.update(t);
  }

  return {
    update,
    state,
    S,
    actors,
    points: { rel, keeperTake, helmetPt, edgePt, catchPt, bounces },
    ballAt,
  };
}
