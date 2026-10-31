import { STAND, walkPose, runPose, mixPose } from './poses.js';

/**
 * Cricket pose library for the clothed rig. Poses are absolute (every joint),
 * radians, [x, y, z]. Signs as in poses.js:
 *   +hip X swings the thigh back; +knee X bends the heel back;
 *   -shoulder X swings the arm forward; -elbow X folds the forearm up.
 * Rig sides: joints named L sit at local -x and are the figure's anatomical
 * RIGHT. A right-arm bowler bowls with shoulderL; a right-handed batter's top hand
 * is wristR and his front (left) leg is hipR.
 *
 * Two extra keys ride along and blend like joints:
 *   bat:  { dir, face } in the actor's root frame (dir = handle -> toe)
 * They live in BATS below and are mixed by the stage with the same weights.
 */
const full = (over) => ({ ...STAND, ...over });

// ---------------------------------------------------------------- batter
// Root yaw 0: chest to +Z (off side, the camera), bowler at local +X.
export const STANCE = full({
  torso: [0.5, 0.22, 0.06],
  head: [0.02, 1.2, -0.1],
  hipL: [-0.52, 0, -0.17],
  hipR: [-0.46, 0, 0.19],
  kneeL: [0.78, 0, 0],
  kneeR: [0.7, 0, 0],
  ankleL: [-0.26, 0, 0],
  ankleR: [-0.24, 0, 0],
  shoulderR: [-0.62, 0, -0.42],
  elbowR: [-0.38, 0, 0],
  wristR: [0.2, 0, 0],
  wristL: [0.2, 0, 0],
});
/** Backlift: bat raised toward the slips, weight still central. */
export const BACKLIFT = full({
  ...STANCE,
  torso: [0.32, 0.12, 0.1],
  head: [0.08, 1.28, -0.1],
  shoulderR: [-1.05, 0, -0.72],
  elbowR: [-0.85, 0, 0],
});
/** Front-foot push, bat down beside the front pad. Root also yaws +0.55. */
export const PUSH = full({
  torso: [0.62, 0.35, 0.0],
  head: [0.32, 0.85, 0.0],
  hipL: [0.32, 0, -0.14],
  hipR: [-0.92, 0, 0.12],
  kneeL: [0.32, 0, 0],
  kneeR: [0.78, 0, 0],
  ankleL: [-0.25, 0, 0],
  ankleR: [0.05, 0, 0],
  shoulderR: [-1.12, 0, -0.3],
  elbowR: [-0.32, 0, 0],
  wristR: [0, 0, 0],
});
/** Drive follow-through: bat high over the front shoulder. */
export const DRIVE_END = full({
  ...PUSH,
  torso: [0.38, 0.55, 0.0],
  head: [0.2, 0.7, 0.0],
  shoulderR: [-2.2, 0, -0.4],
  elbowR: [-1.1, 0, 0],
});
/** Back and across: weight on the back foot, head turning away (the bouncer). */
export const BACK_ACROSS = full({
  torso: [0.18, 0.3, -0.12],
  head: [-0.15, 0.95, -0.1],
  hipL: [-0.18, 0, -0.1],
  hipR: [-0.12, 0, 0.16],
  kneeL: [0.32, 0, 0],
  kneeR: [0.24, 0, 0],
  shoulderR: [-1.25, 0, -0.55],
  elbowR: [-1.0, 0, 0],
});
/** Hit: head snapped back and round, chest twisted away, arms flung. */
export const HIT = full({
  torso: [-0.28, -0.35, -0.22],
  head: [-0.6, -0.25, 0.25],
  hipL: [-0.1, 0, -0.12],
  hipR: [0.18, 0, 0.2],
  kneeL: [0.35, 0, 0],
  kneeR: [0.22, 0, 0],
  shoulderR: [-0.6, 0, 0.55],
  elbowR: [-0.5, 0, 0],
  shoulderL: [-0.9, 0, -0.7],
  elbowL: [-1.6, 0, 0],
});
/** Bent double, free hand on the helmet, bat grounded in the top hand. */
export const DOUBLED = full({
  torso: [1.05, -0.1, 0.05],
  head: [0.45, 0, 0],
  hipL: [-0.55, 0, -0.14],
  hipR: [-0.45, 0, 0.16],
  kneeL: [0.85, 0, 0],
  kneeR: [0.7, 0, 0],
  ankleL: [-0.25, 0, 0],
  ankleR: [-0.22, 0, 0],
  shoulderR: [-0.55, 0, 0.12],
  elbowR: [-0.2, 0, 0],
  shoulderL: [-2.3, 0, -0.55],
  elbowL: [-2.25, 0, 0],
});
/** Down on the right knee, hand still to the helmet. */
export const KNEEL = full({
  torso: [0.55, -0.05, 0.0],
  head: [0.3, 0.1, 0],
  hipL: [0.15, 0, -0.1],
  kneeL: [1.75, 0, 0],
  ankleL: [0.55, 0, 0],
  hipR: [-1.35, 0, 0.14],
  kneeR: [1.42, 0, 0],
  ankleR: [-0.08, 0, 0],
  shoulderR: [-0.45, 0, 0.15],
  elbowR: [-0.25, 0, 0],
  shoulderL: [-2.25, 0, -0.6],
  elbowL: [-2.3, 0, 0],
});
/** Guard: bat upright on the crease, glancing down at the mark. */
export const GUARD = full({
  ...STANCE,
  torso: [0.5, 0.25, 0.05],
  head: [0.55, 0.7, 0],
  shoulderR: [-0.75, 0, -0.35],
  elbowR: [-0.3, 0, 0],
});
/** Looking back at the slips over the right shoulder. */
export const LOOK_BACK = full({
  ...STANCE,
  torso: [0.2, -0.45, 0.0],
  head: [0.0, -1.0, 0.0],
  hipL: [-0.15, 0, -0.12],
  hipR: [-0.1, 0, 0.14],
  kneeL: [0.25, 0, 0],
  kneeR: [0.22, 0, 0],
  shoulderR: [-0.3, 0, -0.1],
  elbowR: [-0.25, 0, 0],
});

/** Bat direction/face per batter pose (root frame; +X toward the bowler). */
export const BATS = {
  STANCE: { dir: [-0.28, -1, -0.32], face: [1, 0, 0] },
  BACKLIFT: { dir: [-0.85, 0.75, 0.25], face: [0, -0.4, 1] },
  PUSH: { dir: [0.25, -1, 0.15], face: [1, 0, 0.25] },
  DRIVE_END: { dir: [-0.5, 0.8, -0.35], face: [0.5, 0.4, -1] },
  BACK_ACROSS: { dir: [-0.6, 0.85, 0.2], face: [0.2, -0.3, 1] },
  HIT: { dir: [-0.3, -0.7, 0.8], face: [1, 0, 0] },
  DOUBLED: { dir: [0.15, -1, 0.35], face: [1, 0, 0] },
  KNEEL: { dir: [0.2, -1, 0.3], face: [1, 0, 0] },
  GUARD: { dir: [0.02, -1, -0.08], face: [1, 0, 0] },
  LOOK_BACK: { dir: [0.1, -1, 0.25], face: [1, 0, 0] },
  WALK: { dir: [0.0, -0.85, 0.45], face: [1, 0, 0] },
  TUCK: { dir: [0.0, 0.25, -1], face: [1, 0, 0] },
};

export function mixBat(a, b, k) {
  const m = (u, v) => [u[0] + (v[0] - u[0]) * k, u[1] + (v[1] - u[1]) * k, u[2] + (v[2] - u[2]) * k];
  return { dir: m(a.dir, b.dir), face: m(a.face, b.face) };
}

// ---------------------------------------------------------------- bowler
// Run yaw faces -X. Side-on (yaw PI) puts local +x (his left shoulder) at the
// batter, so the bowling arm (shoulderL) windmills in the local X-Y plane:
// shoulderL Z goes -0.6 (down, back) -> -PI (up) -> -3.3 (release, just past
// vertical) -> -5.8 (down and across in the follow-through). Never unwind it.
export const GATHER = full({
  torso: [0.05, 0, 0.05],
  head: [0.0, 0, 0],
  shoulderL: [-2.1, 0, 0.35],
  elbowL: [-1.45, 0, 0],
  shoulderR: [-2.5, 0, -0.25],
  elbowR: [-0.7, 0, 0],
  hipL: [0.35, 0, 0],
  kneeL: [1.1, 0, 0],
  ankleL: [0.3, 0, 0],
  hipR: [-1.15, 0, 0],
  kneeR: [1.3, 0, 0],
  ankleR: [-0.2, 0, 0],
});
export const BFC = full({
  torso: [0.0, 0.0, 0.3],
  head: [0.0, 1.25, -0.25],
  shoulderR: [-0.3, 0, 2.45],
  elbowR: [-0.15, 0, 0],
  shoulderL: [0.15, 0, -0.75],
  elbowL: [-0.5, 0, 0],
  wristL: [0.3, 0, 0],
  hipL: [-0.05, 0, -0.12],
  kneeL: [0.42, 0, 0],
  ankleL: [-0.15, 0, 0],
  hipR: [-0.35, 0, 0.75],
  kneeR: [0.95, 0, 0],
  ankleR: [-0.1, 0, 0],
});
export const FFC = full({
  torso: [0.0, 0.0, 0.05],
  head: [0.0, 1.2, -0.1],
  shoulderR: [-0.2, 0, 1.35],
  elbowR: [-0.7, 0, 0],
  shoulderL: [0.1, 0, -2.05],
  elbowL: [-0.25, 0, 0],
  wristL: [0.2, 0, 0],
  hipL: [0.1, 0, -0.55],
  kneeL: [0.62, 0, 0],
  ankleL: [-0.1, 0, 0],
  hipR: [-0.08, 0, 0.55],
  kneeR: [0.08, 0, 0],
  ankleR: [-0.05, 0, 0],
});
export const RELEASE = full({
  torso: [0.12, 0.0, -0.42],
  head: [0.05, 1.1, 0.25],
  shoulderR: [0.25, 0, 0.45],
  elbowR: [-1.1, 0, 0],
  shoulderL: [-0.12, 0, -3.32],
  elbowL: [-0.08, 0, 0],
  wristL: [0.35, 0, 0],
  hipL: [0.05, 0, -0.72],
  kneeL: [0.55, 0, 0],
  ankleL: [0.35, 0, 0],
  hipR: [-0.12, 0, 0.5],
  kneeR: [0.12, 0, 0],
  ankleR: [-0.05, 0, 0],
});
/** Follow-through, after the root has turned chest-on and past: trunk folded. */
export const FOLLOW = full({
  torso: [0.95, 0.0, -0.15],
  head: [-0.35, 0.0, 0],
  shoulderR: [0.75, 0, 0.35],
  elbowR: [-1.2, 0, 0],
  shoulderL: [-0.9, 0, -5.78],
  elbowL: [-0.3, 0, 0],
  wristL: [0.2, 0, 0],
  hipL: [0.55, 0, -0.1],
  kneeL: [0.85, 0, 0],
  ankleL: [0.3, 0, 0],
  hipR: [-0.75, 0, 0.12],
  kneeR: [0.55, 0, 0],
  ankleR: [-0.15, 0, 0],
});
/** Ball held at the chin in the last strides of the run. */
export function runUpPose(phase, k) {
  const p = runPose(phase);
  return mixPose(p, { ...p, shoulderL: [-1.0, 0, 0.35], elbowL: [-2.1, 0, 0] }, k);
}
export const HANDS_ON_HEAD = full({
  torso: [-0.12, 0, 0],
  head: [-0.3, 0, 0],
  shoulderL: [-2.5, 0, -0.85],
  elbowL: [-2.25, 0, 0],
  shoulderR: [-2.5, 0, 0.85],
  elbowR: [-2.25, 0, 0],
});
export const HANDS_ON_HIPS = full({
  torso: [0.05, 0, 0],
  head: [0.05, 0, 0],
  shoulderL: [0.15, 0, -0.62],
  elbowL: [-1.55, 0, 0],
  shoulderR: [0.15, 0, 0.62],
  elbowR: [-1.55, 0, 0],
  hipL: [0, 0, -0.1],
  hipR: [0, 0, 0.1],
});
export const CELEBRATE = full({
  torso: [-0.15, 0, 0],
  head: [-0.4, 0, 0],
  shoulderL: [-2.85, 0, -0.35],
  elbowL: [-0.25, 0, 0],
  shoulderR: [-2.85, 0, 0.35],
  elbowR: [-0.25, 0, 0],
  hipL: [-0.3, 0, -0.05],
  hipR: [0.2, 0, 0.05],
  kneeL: [0.7, 0, 0],
  kneeR: [0.5, 0, 0],
});
/** Catching a return throw at the chest. */
export const CATCH_CHEST = full({
  torso: [0.1, 0, 0],
  head: [-0.1, 0, 0],
  shoulderL: [-1.35, 0, 0.3],
  elbowL: [-0.75, 0, 0],
  shoulderR: [-1.35, 0, -0.3],
  elbowR: [-0.75, 0, 0],
});

// ---------------------------------------------------------------- fielders
export const KEEPER_SQUAT = full({
  torso: [0.52, 0, 0],
  head: [-0.42, 0, 0],
  hipL: [-1.45, 0, -0.32],
  hipR: [-1.45, 0, 0.32],
  kneeL: [2.15, 0, 0],
  kneeR: [2.15, 0, 0],
  ankleL: [-0.55, 0, 0],
  ankleR: [-0.55, 0, 0],
  shoulderL: [-0.75, 0, 0.12],
  elbowL: [-0.3, 0, 0],
  shoulderR: [-0.75, 0, -0.12],
  elbowR: [-0.3, 0, 0],
});
export const KEEPER_UP = full({
  torso: [0.35, 0, 0],
  head: [-0.3, 0, 0],
  hipL: [-0.65, 0, -0.25],
  hipR: [-0.65, 0, 0.25],
  kneeL: [0.95, 0, 0],
  kneeR: [0.95, 0, 0],
  ankleL: [-0.3, 0, 0],
  ankleR: [-0.3, 0, 0],
  shoulderL: [-1.25, 0, 0.3],
  elbowL: [-0.65, 0, 0],
  shoulderR: [-1.25, 0, -0.3],
  elbowR: [-0.65, 0, 0],
});
/** Gloves high: taking the deflection off the helmet. */
export const KEEPER_HIGH = full({
  ...KEEPER_UP,
  torso: [0.05, 0, 0],
  head: [-0.45, 0, 0],
  shoulderL: [-2.5, 0, 0.25],
  elbowL: [-0.35, 0, 0],
  shoulderR: [-2.5, 0, -0.25],
  elbowR: [-0.35, 0, 0],
});
export const SLIP_SET = full({
  torso: [0.68, 0, 0],
  head: [-0.5, 0, 0],
  hipL: [-0.75, 0, -0.22],
  hipR: [-0.75, 0, 0.22],
  kneeL: [0.95, 0, 0],
  kneeR: [0.95, 0, 0],
  ankleL: [-0.25, 0, 0],
  ankleR: [-0.25, 0, 0],
  shoulderL: [-0.95, 0, 0.18],
  elbowL: [-0.3, 0, 0],
  shoulderR: [-0.95, 0, -0.18],
  elbowR: [-0.3, 0, 0],
});
/** Full-length dive. The stage also rolls the root ~1.45 rad onto his right side. */
export const DIVE = full({
  torso: [0.05, 0, 0.1],
  head: [-0.2, 0, 0.15],
  shoulderL: [-2.95, 0, 0.1],
  elbowL: [-0.1, 0, 0],
  shoulderR: [-2.95, 0, -0.05],
  elbowR: [-0.1, 0, 0],
  hipL: [0.1, 0, -0.05],
  hipR: [-0.25, 0, 0.12],
  kneeL: [0.25, 0, 0],
  kneeR: [0.45, 0, 0],
  ankleL: [0.3, 0, 0],
  ankleR: [0.3, 0, 0],
});
/** On the ground after the dive, ball held up. */
export const DOWN_BALL_UP = full({
  ...DIVE,
  torso: [0.2, 0, 0.0],
  shoulderL: [-2.4, 0, 0.3],
  elbowL: [-0.4, 0, 0],
  shoulderR: [-2.0, 0, -0.1],
  elbowR: [-0.8, 0, 0],
  hipR: [-0.8, 0, 0.12],
  kneeR: [1.2, 0, 0],
});
/** Throw, right-handed (rig L arm). */
export const THROW_WIND = full({
  torso: [0.0, -0.45, 0],
  head: [0, 0.35, 0],
  shoulderL: [0.9, 0, -0.55],
  elbowL: [-1.3, 0, 0],
  shoulderR: [-1.0, 0, 0.2],
  elbowR: [-0.4, 0, 0],
  hipL: [0.12, 0, -0.08],
  hipR: [-0.22, 0, 0.08],
});
export const THROW_REL = full({
  torso: [0.32, 0.35, 0],
  head: [-0.05, -0.2, 0],
  shoulderL: [-1.9, 0, -0.15],
  elbowL: [-0.2, 0, 0],
  shoulderR: [0.3, 0, 0.3],
  elbowR: [-0.85, 0, 0],
  hipL: [-0.15, 0, -0.06],
  hipR: [0.15, 0, 0.06],
  kneeR: [0.25, 0, 0],
});

// ---------------------------------------------------------------- umpire
export const UMP_IDLE = full({
  torso: [0.08, 0, 0],
  shoulderL: [-0.32, 0, 0.32],
  elbowL: [-0.95, 0, 0],
  shoulderR: [-0.32, 0, -0.32],
  elbowR: [-0.95, 0, 0],
  hipL: [0, 0, -0.08],
  hipR: [0, 0, 0.08],
});
export const UMP_WATCH = full({
  ...UMP_IDLE,
  torso: [0.32, 0, 0],
  head: [-0.18, 0, 0],
  hipL: [-0.28, 0, -0.1],
  hipR: [-0.28, 0, 0.1],
  kneeL: [0.42, 0, 0],
  kneeR: [0.42, 0, 0],
  ankleL: [-0.12, 0, 0],
  ankleR: [-0.12, 0, 0],
});
export const UMP_OUT = full({
  ...UMP_IDLE,
  torso: [-0.05, 0, 0],
  head: [-0.12, 0, 0],
  shoulderL: [-2.95, 0, 0.18],
  elbowL: [-0.12, 0, 0],
});

// ---------------------------------------------------------------- game: shots
// The Chase plays these keyed to the press. Root yaw and the front/back step
// come from the shot table in src/game/choreo.js; bat face at impact is aimed
// at the shot direction there, so the BATS entries below are the swing's ends.

/** Back-foot defence: tall, weight back, bat straight under the eyes. */
export const BACK_DEFENCE = full({
  torso: [0.3, 0.32, 0.0],
  head: [0.22, 0.95, 0.0],
  hipL: [-0.12, 0, -0.16],
  hipR: [-0.3, 0, 0.2],
  kneeL: [0.32, 0, 0],
  kneeR: [0.36, 0, 0],
  ankleL: [-0.12, 0, 0],
  ankleR: [-0.1, 0, 0],
  shoulderR: [-1.05, 0, -0.28],
  elbowR: [-0.62, 0, 0],
  wristR: [0.1, 0, 0],
});
/** Cut / late cut at impact: arms out toward the off side at chest height. */
export const CUT_IMPACT = full({
  torso: [0.42, 0.05, 0.12],
  head: [0.3, 0.75, 0.0],
  hipL: [-0.22, 0, -0.2],
  hipR: [-0.35, 0, 0.3],
  kneeL: [0.42, 0, 0],
  kneeR: [0.4, 0, 0],
  ankleL: [-0.14, 0, 0],
  ankleR: [-0.12, 0, 0],
  shoulderR: [-1.35, 0, -0.75],
  elbowR: [-0.18, 0, 0],
  wristR: [0.15, 0, 0],
});
export const CUT_END = full({
  ...CUT_IMPACT,
  torso: [0.35, -0.2, 0.05],
  head: [0.25, 0.4, 0.0],
  shoulderR: [-1.75, 0, -0.15],
  elbowR: [-0.9, 0, 0],
});
/** Pull at impact: chest open to the bowler, bat across at chest height. */
export const PULL_IMPACT = full({
  torso: [0.18, -0.2, -0.05],
  head: [0.0, 0.55, 0.0],
  hipL: [-0.2, 0, -0.22],
  hipR: [-0.12, 0, 0.26],
  kneeL: [0.35, 0, 0],
  kneeR: [0.25, 0, 0],
  ankleL: [-0.12, 0, 0],
  ankleR: [-0.08, 0, 0],
  shoulderR: [-1.6, 0, -0.35],
  elbowR: [-0.25, 0, 0],
  wristR: [0.0, 0, 0],
});
export const PULL_END = full({
  ...PULL_IMPACT,
  torso: [0.12, -0.75, -0.05],
  head: [-0.05, 0.2, 0.0],
  shoulderR: [-2.0, 0, 0.35],
  elbowR: [-1.35, 0, 0],
});
/** Leg glance: front foot, face turned down to fine leg with the wrists. */
export const GLANCE = full({
  ...PUSH,
  torso: [0.55, 0.15, 0.0],
  head: [0.35, 0.7, 0.0],
  shoulderR: [-1.0, 0, -0.18],
  elbowR: [-0.4, 0, 0],
});
/** The leave: bat lifted high out of the way, eyes on the ball. */
export const LEAVE = full({
  ...STANCE,
  torso: [0.3, 0.15, 0.04],
  head: [0.1, 1.0, -0.05],
  hipL: [-0.3, 0, -0.17],
  hipR: [-0.28, 0, 0.19],
  kneeL: [0.45, 0, 0],
  kneeR: [0.42, 0, 0],
  ankleL: [-0.15, 0, 0],
  ankleR: [-0.14, 0, 0],
  shoulderR: [-2.45, 0, -0.35],
  elbowR: [-1.15, 0, 0],
});
/** Ducking a bouncer: folded at the hips and knees, head down. */
export const DUCK = full({
  torso: [1.05, 0.1, 0.0],
  head: [0.35, 0.3, 0.0],
  hipL: [-1.15, 0, -0.2],
  hipR: [-1.05, 0, 0.24],
  kneeL: [1.6, 0, 0],
  kneeR: [1.5, 0, 0],
  ankleL: [-0.45, 0, 0],
  ankleR: [-0.42, 0, 0],
  shoulderR: [-0.4, 0, -0.1],
  elbowR: [-0.3, 0, 0],
});
/** Lofted finish: arms right up and over. */
export const LOFT_END = full({
  ...DRIVE_END,
  torso: [0.22, 0.6, 0.0],
  head: [0.0, 0.6, 0.0],
  shoulderR: [-2.75, 0, -0.35],
  elbowR: [-0.9, 0, 0],
});

Object.assign(BATS, {
  BACK_DEFENCE: { dir: [0.06, -1, 0.08], face: [1, 0, 0] },
  CUT_IMPACT: { dir: [-0.15, -0.3, 1], face: [0.35, -0.9, 0] },
  CUT_END: { dir: [-0.7, 0.45, 0.45], face: [0.4, 0.2, 1] },
  PULL_IMPACT: { dir: [0.35, 0.05, 1], face: [1, 0, -0.35] },
  PULL_END: { dir: [-0.9, 0.55, -0.2], face: [0, 0.2, -1] },
  GLANCE: { dir: [0.2, -1, -0.1], face: [0.3, 0, -1] },
  LEAVE: { dir: [-0.55, 1, 0.2], face: [0, -0.2, 1] },
  DUCK: { dir: [0.1, -1, 0.3], face: [1, 0, 0] },
  LOFT_END: { dir: [-0.6, 0.85, -0.15], face: [0.5, 0.4, -1] },
});

// ---------------------------------------------------------------- game: fielders
/** Walking-in ready crouch as the bowler lets go. */
export const FIELD_READY = full({
  torso: [0.38, 0, 0],
  head: [-0.3, 0, 0],
  hipL: [-0.5, 0, -0.16],
  hipR: [-0.5, 0, 0.16],
  kneeL: [0.7, 0, 0],
  kneeR: [0.7, 0, 0],
  ankleL: [-0.22, 0, 0],
  ankleR: [-0.22, 0, 0],
  shoulderL: [-0.55, 0, 0.12],
  elbowL: [-0.45, 0, 0],
  shoulderR: [-0.55, 0, -0.12],
  elbowR: [-0.45, 0, 0],
});
/** Bent over, throwing hand down at the grass. */
export const PICKUP = full({
  torso: [1.05, 0, 0],
  head: [-0.55, 0, 0],
  hipL: [-0.8, 0, -0.2],
  hipR: [-0.25, 0, 0.2],
  kneeL: [1.15, 0, 0],
  kneeR: [0.45, 0, 0],
  ankleL: [-0.35, 0, 0],
  ankleR: [-0.15, 0, 0],
  shoulderL: [-1.15, 0, 0.12],
  elbowL: [-0.1, 0, 0],
  shoulderR: [-0.6, 0, -0.2],
  elbowR: [-0.4, 0, 0],
});
/** Hands up over the head for a skier. */
export const CATCH_HIGH = full({
  torso: [-0.12, 0, 0],
  head: [-0.6, 0, 0],
  shoulderL: [-2.65, 0, 0.18],
  elbowL: [-0.45, 0, 0],
  shoulderR: [-2.65, 0, -0.18],
  elbowR: [-0.45, 0, 0],
});
/** Hands cupped low in front: a catch at the knees. */
export const CATCH_LOW = full({
  ...SLIP_SET,
  torso: [0.75, 0, 0],
  shoulderL: [-0.75, 0, 0.1],
  shoulderR: [-0.75, 0, -0.1],
  elbowL: [-0.15, 0, 0],
  elbowR: [-0.15, 0, 0],
});

// ---------------------------------------------------------------- game: umpire
/** Four: the arm sweeps across the body (the stage waves shoulderL Z). */
export const UMP_FOUR = full({ ...UMP_IDLE, shoulderL: [-1.5, 0, -0.2], elbowL: [-0.1, 0, 0] });
export const UMP_SIX = full({ ...UMP_IDLE, shoulderL: [-2.95, 0, 0.15], elbowL: [-0.1, 0, 0], shoulderR: [-2.95, 0, -0.15], elbowR: [-0.1, 0, 0] });
export const UMP_WIDE = full({ ...UMP_IDLE, shoulderL: [0, 0, -1.5], elbowL: [-0.05, 0, 0], shoulderR: [0, 0, 1.5], elbowR: [-0.05, 0, 0] });

// ---------------------------------------------------------------- game: slaps, guide, specials
// The pull and the cut are horizontal slaps: the hands come from high on the
// off side, the bat flattens out in front at impact and whips through. The
// bat's arc is keyed in world space in controller.js; these are the bodies.
export const PULL_WIND = full({
  ...BACK_DEFENCE,
  torso: [0.2, 0.25, -0.05],
  head: [0.1, 0.9, 0],
  shoulderR: [-2.0, 0, -0.85],
  elbowR: [-1.25, 0, 0],
});
export const PULL_HIT = full({
  ...PULL_IMPACT,
  torso: [0.22, -0.1, -0.08],
  head: [0.05, 0.45, 0],
  shoulderR: [-1.5, 0, -0.15],
  elbowR: [-0.12, 0, 0],
});
export const PULL_THROUGH = full({
  ...PULL_IMPACT,
  torso: [0.18, -0.55, -0.1],
  head: [0.0, 0.25, 0],
  shoulderR: [-1.45, 0, 0.45],
  elbowR: [-0.45, 0, 0],
});
export const CUT_HIGH = full({
  ...CUT_IMPACT,
  torso: [0.28, 0.25, 0.1],
  head: [0.2, 0.85, 0],
  shoulderR: [-2.45, 0, -0.45],
  elbowR: [-0.85, 0, 0],
});
export const CUT_HIT = full({
  ...CUT_IMPACT,
  torso: [0.45, 0.0, 0.14],
  head: [0.32, 0.7, 0],
  shoulderR: [-1.45, 0, -0.05],
  elbowR: [-0.1, 0, 0],
});
export const CUT_THROUGH = full({
  ...CUT_IMPACT,
  torso: [0.5, -0.25, 0.1],
  head: [0.3, 0.5, 0],
  shoulderR: [-0.95, 0, -0.55],
  elbowR: [-0.2, 0, 0],
});
/** Third-man guide: back and across, soft hands, an open face just under the eyes. */
export const GUIDE = full({
  ...BACK_DEFENCE,
  torso: [0.42, 0.2, 0.12],
  head: [0.35, 0.75, 0],
  shoulderR: [-1.0, 0, -0.55],
  elbowR: [-0.5, 0, 0],
});
const KNEEL_LEGS = {
  hipL: [0.15, 0, -0.1],
  kneeL: [1.75, 0, 0],
  ankleL: [0.55, 0, 0],
  hipR: [-1.4, 0, 0.16],
  kneeR: [1.5, 0, 0],
  ankleR: [-0.1, 0, 0],
};
export const SWEEP_DOWN = full({ ...KNEEL_LEGS, torso: [0.7, 0.2, 0.0], head: [0.45, 0.7, 0], shoulderR: [-1.75, 0, -0.75], elbowR: [-0.9, 0, 0] });
export const SWEEP_HIT = full({ ...KNEEL_LEGS, torso: [0.85, 0.05, 0.0], head: [0.6, 0.45, 0], shoulderR: [-0.95, 0, -0.1], elbowR: [-0.12, 0, 0] });
export const SWEEP_END = full({ ...KNEEL_LEGS, torso: [0.8, -0.4, 0.0], head: [0.5, 0.2, 0], shoulderR: [-1.1, 0, 0.55], elbowR: [-0.5, 0, 0] });
export const RSWEEP_DOWN = full({ ...KNEEL_LEGS, torso: [0.7, -0.25, 0.0], head: [0.45, 0.6, 0], shoulderR: [-1.5, 0, 0.45], elbowR: [-0.8, 0, 0] });
export const RSWEEP_HIT = full({ ...KNEEL_LEGS, torso: [0.85, 0.15, 0.0], head: [0.6, 0.55, 0], shoulderR: [-0.95, 0, -0.25], elbowR: [-0.12, 0, 0] });
export const RSWEEP_END = full({ ...KNEEL_LEGS, torso: [0.8, 0.45, 0.0], head: [0.5, 0.75, 0], shoulderR: [-1.15, 0, -0.85], elbowR: [-0.45, 0, 0] });
export const SCOOP_DOWN = full({ ...KNEEL_LEGS, torso: [0.6, 0.1, 0.0], head: [0.25, 0.8, 0], shoulderR: [-1.0, 0, -0.2], elbowR: [-0.6, 0, 0] });
export const SCOOP_HIT = full({ ...KNEEL_LEGS, torso: [0.55, 0.05, 0.0], head: [0.1, 0.85, 0], shoulderR: [-1.15, 0, -0.1], elbowR: [-0.2, 0, 0] });
export const SCOOP_END = full({ ...KNEEL_LEGS, torso: [0.3, 0.05, 0.0], head: [-0.4, 0.6, 0], shoulderR: [-2.4, 0, -0.2], elbowR: [-0.5, 0, 0] });

/** Flick off the pads: front foot, bat straight down, then the wrists roll it to leg. */
export const FLICK_HIT = full({ ...PUSH, torso: [0.55, 0.15, 0.0], head: [0.38, 0.6, 0], shoulderR: [-1.15, 0, -0.1], elbowR: [-0.3, 0, 0] });
export const FLICK_THROUGH = full({ ...PUSH, torso: [0.5, -0.1, 0.0], head: [0.3, 0.45, 0], shoulderR: [-1.3, 0, 0.25], elbowR: [-0.45, 0, 0] });
export const FLICK_END = full({ ...PUSH, torso: [0.4, -0.35, 0.0], head: [0.2, 0.3, 0], shoulderR: [-1.75, 0, 0.45], elbowR: [-0.95, 0, 0] });

// ---------------------------------------------------------------- game: fielding variety
/** Set, ball rolling to him: legs apart, knees bent, both hands down in front. */
export const FIELD_GATHER = full({
  torso: [0.95, 0, 0],
  head: [-0.55, 0, 0],
  hipL: [-0.85, 0, -0.28],
  hipR: [-0.85, 0, 0.28],
  kneeL: [1.15, 0, 0],
  kneeR: [1.15, 0, 0],
  ankleL: [-0.3, 0, 0],
  ankleR: [-0.3, 0, 0],
  shoulderL: [-1.05, 0, 0.18],
  elbowL: [-0.12, 0, 0],
  shoulderR: [-1.05, 0, -0.18],
  elbowR: [-0.12, 0, 0],
});
/** The long barrier for a hard-hit ball: down on one knee behind it, hands together. */
export const LONG_BARRIER = full({
  torso: [0.7, 0, 0],
  head: [-0.4, 0, 0],
  hipL: [0.25, 0, -0.45],
  kneeL: [1.65, 0, 0],
  ankleL: [0.5, 0, 0],
  hipR: [-1.2, 0, 0.3],
  kneeR: [1.35, 0, 0],
  ankleR: [-0.1, 0, 0],
  shoulderL: [-0.85, 0, 0.12],
  elbowL: [-0.1, 0, 0],
  shoulderR: [-0.85, 0, -0.12],
  elbowR: [-0.1, 0, 0],
});
/** Sliding stop on the hip: legs out in front, one hand down to the ball (the stage rolls him ~0.5). */
export const SLIDE = full({
  torso: [-0.15, 0, 0],
  head: [-0.1, 0, 0],
  hipL: [-1.45, 0, -0.1],
  kneeL: [0.25, 0, 0],
  ankleL: [0.2, 0, 0],
  hipR: [-1.1, 0, 0.12],
  kneeR: [1.0, 0, 0],
  ankleR: [0.1, 0, 0],
  shoulderL: [-1.25, 0, 0.35],
  elbowL: [-0.1, 0, 0],
  shoulderR: [0.45, 0, -0.35],
  elbowR: [-0.25, 0, 0],
});
/** Lunging catch: one long step out, both hands reaching low to the side. */
export const LUNGE_CATCH = full({
  torso: [0.55, 0, 0.3],
  head: [-0.3, 0, 0.2],
  hipL: [-1.0, 0, -0.45],
  kneeL: [1.05, 0, 0],
  ankleL: [-0.25, 0, 0],
  hipR: [0.35, 0, 0.3],
  kneeR: [0.15, 0, 0],
  ankleR: [0.1, 0, 0],
  shoulderL: [-1.45, 0, 0.05],
  elbowL: [-0.15, 0, 0],
  shoulderR: [-1.45, 0, -0.25],
  elbowR: [-0.15, 0, 0],
});

export { walkPose, runPose, mixPose, STAND };
