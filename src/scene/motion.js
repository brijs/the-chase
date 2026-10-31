import * as THREE from 'three';
import { clamp, lerp, smooth, win, LOOP } from '../config.js';
import { STAND, walkPose, mixPose, BATS, mixBat } from './cricketPoses.js';

/**
 * Motion helpers shared by the scripted diorama (stage.js) and the game
 * (src/game/). Everything here is a pure function of its arguments.
 */
const PI = Math.PI;
export const ease = (u) => u - Math.sin(2 * PI * u) / (2 * PI); // zero speed at both ends
export const easeOut = (u) => 1 - (1 - u) * (1 - u);
export const lerpAngle = (a, b, k) => {
  let d = ((b - a + PI) % (2 * PI) + 2 * PI) % (2 * PI) - PI;
  return a + d * k;
};
/** Ambient loops are integer cycles per lap, so the seam never pops. */
export const amb = (t, n, phase = 0) => Math.sin((2 * PI * n * t) / LOOP + phase);

/** Pose track: [[t, pose], ...] eased between neighbours. */
export function poseAt(t, keys) {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i][0]) {
      const [t0, a] = keys[i - 1];
      const [t1, b, e] = keys[i];
      const u = clamp((t - t0) / Math.max(1e-6, t1 - t0), 0, 1);
      return mixPose(a, b, e === 'lin' ? u : smooth(u));
    }
  }
  return keys[keys.length - 1][1];
}
export function batAt(t, keys) {
  if (t <= keys[0][0]) return BATS[keys[0][1]];
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i][0]) {
      const [t0, a] = keys[i - 1];
      const [t1, b] = keys[i];
      const u = clamp((t - t0) / Math.max(1e-6, t1 - t0), 0, 1);
      return mixBat(BATS[a], BATS[b], smooth(u));
    }
  }
  return BATS[keys[keys.length - 1][1]];
}
export function scalarAt(t, keys) {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i][0]) {
      const [t0, a] = keys[i - 1];
      const [t1, b, e] = keys[i];
      const u = clamp((t - t0) / Math.max(1e-6, t1 - t0), 0, 1);
      return lerp(a, b, e === 'lin' ? u : e === 'out' ? easeOut(u) : smooth(u));
    }
  }
  return keys[keys.length - 1][1];
}

/**
 * A walk leg from `a` to `b` between t0 and t1. Gait phase is driven by distance,
 * so feet never skate; amplitude follows speed. Returns null outside the window.
 */
export function walkLeg(t, t0, t1, a, b, opts = {}) {
  if (t < t0 || t > t1) return null;
  const u = (t - t0) / (t1 - t0);
  // easeK < 1 blends toward linear: a sprint keeps its peak near the average.
  const k0 = opts.linear ? 0 : opts.easeK ?? 1;
  const e = lerp(u, ease(u), k0);
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const len = Math.hypot(dx, dz);
  const avg = len / (t1 - t0);
  const speed = avg * lerp(1, 1 - Math.cos(2 * PI * u), k0);
  const dist = len * e;
  const jog = avg > 2.1;
  const cycle = jog ? 2.3 : 1.5;
  const phase = (dist / cycle) * 2 * PI + (opts.phase0 ?? 0);
  const k = clamp(speed / (jog ? 2.6 : 1.3), 0, 1);
  const g = walkPose(phase, {
    amp: (jog ? 0.46 : 0.32) * k,
    armAmp: (jog ? 0.62 : 0.4) * k,
    lean: jog ? 0.16 : 0.05,
    kneeBase: jog ? 0.12 : 0.06,
  });
  if (jog) {
    g.elbowL = [-0.9, 0, 0];
    g.elbowR = [-0.9, 0, 0];
  }
  let yaw = Math.atan2(dx, dz);
  if (opts.fromYaw !== undefined) yaw = lerpAngle(opts.fromYaw, yaw, smooth(win(u, 0, opts.turn ?? 0.22)));
  if (opts.toYaw !== undefined) yaw = lerpAngle(yaw, opts.toYaw, smooth(win(u, 1 - (opts.turn ?? 0.22), 1)));
  return {
    x: a[0] + dx * e,
    z: a[1] + dz * e,
    yaw,
    pose: mixPose(STAND, g, clamp(k * 1.6, 0, 1)),
    moving: speed > 0.05,
    phase,
  };
}

/** Idle weight shift and breathing on top of a pose. */
export function breathe(pose, t, n, phase) {
  const p = { ...pose };
  const s = amb(t, n, phase);
  p.torso = [(p.torso?.[0] ?? 0) + s * 0.015, (p.torso?.[1] ?? 0) + amb(t, n * 0.5 + 0.5, phase) * 0.02, p.torso?.[2] ?? 0];
  p.head = [(p.head?.[0] ?? 0) + s * 0.02, (p.head?.[1] ?? 0) + amb(t, 3, phase + 1) * 0.06, p.head?.[2] ?? 0];
  return p;
}

export function solveFlight(p0, p1, T, swing = 0) {
  const a = new THREE.Vector3(0, -9.81, swing);
  const v = p1.clone().sub(p0).addScaledVector(a, -0.5 * T * T).multiplyScalar(1 / T);
  return (tau) => p0.clone().addScaledVector(v, tau).addScaledVector(a, 0.5 * tau * tau);
}

