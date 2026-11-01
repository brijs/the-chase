import * as THREE from 'three';
import { updateCamera } from './camera.js';
import { GAME_FIT_POINTS } from './gameGround.js';

/**
 * Cameras for the Chase: one continuous broadcast camera, never a cut.
 *
 *   wide      between balls: high behind the bowler's arm, the whole strip with
 *             the bowler at his mark at the bottom of the frame
 *   run-up    as he runs in, the lens pushes in and the aim slides up the pitch,
 *             so the release finds the camera tight on the striker (the arrows
 *             read as on screen: off side left, straight down)
 *   follow    off the bat the same camera cranes up and back, pans after the
 *             ball and opens its lens to keep it (and where it is going) in shot.
 *             A ball coming back toward the camera (a straight drive) lifts it
 *             higher and further back, so it looks down on the ball crossing the
 *             rope instead of losing it under the lens
 *   settle    when the ball is dead it glides back to the wide shot
 *   diorama   C: the locked 45/33 three-quarter view, fitted to the whole oval
 *   orbit     the title screen: a slow drift round the ground, high up; back
 *             to broadcast it glides down from wherever it is
 *
 * Every move eases (critically damped toward a target framing), so the
 * camera's path is continuous.
 */
const TIGHT = { pos: new THREE.Vector3(31, 6.5, 0.6), target: new THREE.Vector3(-4.5, 0.4, 0.1), fov: 16.5 };
const WIDE = { pos: new THREE.Vector3(35, 8.5, 1.8), target: new THREE.Vector3(6, 1.0, 0.4), fov: 30 };
const STRIKER = new THREE.Vector3(-7.75, 0, -0.32);
// The scoreboard (index.js puts it at (-27.2, 8.2), turned 1.73 rad): its face and facing.
const BOARD_N = new THREE.Vector3(Math.sin(1.73), 0, Math.cos(1.73));
const BOARD = new THREE.Vector3(-27.2, 3.15, 8.2).addScaledVector(BOARD_N, 0.3);

export function createDirector(camera) {
  const dio = { pos: new THREE.Vector3(), target: new THREE.Vector3(), fov: 20.5 };
  const cur = { pos: WIDE.pos.clone(), target: WIDE.target.clone(), fov: WIDE.fov };
  const want = { pos: new THREE.Vector3(), target: new THREE.Vector3(), fov: WIDE.fov };
  let mode = 'broadcast';
  let blend = 0; // 0 broadcast .. 1 diorama
  let aspect = 1.6;
  let shot = 'wide'; // which framing the camera is heading for
  let orbitT = 0;

  function fitDiorama(a) {
    aspect = a;
    updateCamera(camera, a, GAME_FIT_POINTS);
    dio.pos.copy(camera.position);
    dio.target.copy(camera.userData.target);
    dio.fov = camera.fov;
  }
  /** A portrait screen needs a wider vertical lens to keep the same width. */
  const fovFor = (f) => Math.min(70, f * Math.max(1, 1.45 / Math.max(0.5, aspect)));
  const ease = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
  const win = (t, a, b) => Math.min(1, Math.max(0, (t - a) / Math.max(1e-6, b - a)));
  const setFrom = (o, a, b, k) => {
    o.pos.lerpVectors(a.pos, b.pos, k);
    o.target.lerpVectors(a.target, b.target, k);
    o.fov = a.fov + (b.fov - a.fov) * k;
  };

  /**
   * ctx: { t, T0, tR, tC, ball, path: { to, far, end } | null }
   *   tC     contact time (null for a leave or a miss)
   *   path   the batted ball: where it ends up and until when to follow it
   */
  function update(dt, ctx = {}) {
    if (mode === 'manual') return; // QA owns the camera
    if (mode === 'orbit') {
      orbitT += dt;
      const a = 0.9 + orbitT * 0.06;
      cur.pos.set(-1 + Math.cos(a) * 44, 12 + Math.sin(orbitT * 0.21) * 2, Math.sin(a) * 36);
      cur.target.set(-2, 3.2, 0);
      cur.fov = fovFor(36);
      camera.position.copy(cur.pos);
      camera.fov = cur.fov;
      camera.aspect = aspect;
      camera.near = 0.5;
      camera.far = 330;
      camera.lookAt(cur.target);
      camera.updateProjectionMatrix();
      return;
    }
    const { t, T0, tR, tC, ball, path } = ctx;
    let next = 'wide';
    if (ctx.board) next = 'board';
    if (next !== 'board' && T0 != null && t >= T0) {
      if (t < tR) next = 'runup';
      else if (tC == null) next = t < tR + 1.6 ? 'tight' : 'wide';
      else if (t < (path ? path.end : tC + 2.4)) next = 'follow';
      else next = 'wide';
    }
    shot = next;

    if (shot === 'board') {
      // In front of the ground's scoreboard (it faces the striker's end).
      want.pos.copy(BOARD).addScaledVector(BOARD_N, 9.5).setY(BOARD.y + 0.8);
      want.target.copy(BOARD);
      want.fov = 28;
    } else if (shot === 'runup') {
      // The push-in: slow at first, committed by the delivery stride.
      const u = ease(win(t, T0 + 0.35, tR - 0.12));
      setFrom(want, WIDE, TIGHT, Math.pow(u, 1.2));
    } else if (shot === 'tight') {
      setFrom(want, TIGHT, TIGHT, 0);
    } else if (shot === 'follow' && ball) {
      // Crane and pan from the broadcast end. How far the ball has come back
      // toward the camera lifts and pulls the camera back; how far it is from
      // the striker opens the lens. The aim leads the ball toward its end point.
      const toward = Math.max(0, ball.x - STRIKER.x); // metres toward the bowler's end
      const side = ball.z;
      const away = Math.hypot(ball.x - STRIKER.x, ball.z - STRIKER.z);
      if (path?.six && path.to && path.to.x > 4) {
        // A six back over the bowler: the view from the stands it is heading
        // for. The camera stands off past where it lands, a little to one
        // side and up, and watches it come in, landing and all.
        const to = path.to;
        const dx = to.x - STRIKER.x;
        const dz = to.z - STRIKER.z;
        const n = Math.hypot(dx, dz) || 1;
        const lat = to.z >= 0 ? 1 : -1;
        want.pos.set(to.x + (dx / n) * 13 - (dz / n) * 6 * lat, (to.y ?? 0) + 8.5, to.z + (dz / n) * 13 + (dx / n) * 6 * lat);
        want.target.copy(ball).lerp(new THREE.Vector3(to.x, to.y ?? 0, to.z), 0.4);
        want.target.y = Math.max(1, want.target.y);
        const dist = want.pos.distanceTo(want.target);
        const span = Math.max(14, Math.hypot(ball.x - to.x, ball.z - to.z) * 0.9 + ball.y);
        want.fov = Math.max(TIGHT.fov, Math.min(62, (2 * Math.atan(span / 2 / dist) * 180) / Math.PI));
        want.fov = fovFor(want.fov);
        const s1 = 1 - Math.exp(-dt * 2.6);
        cur.pos.lerp(want.pos, s1);
        cur.target.lerp(want.target, 1 - Math.exp(-dt * 6));
        cur.fov += (want.fov - cur.fov) * s1;
        return place();
      }
      // (A four's pull-back is capped at the boards; a six, heading into the
      // stands, takes the camera back and up over them so the landing stays in shot.)
      const six = !!path?.six;
      const back = six ? Math.min(18, 0.45 * toward) : Math.min(4, 0.15 * toward);
      want.pos.set(TIGHT.pos.x + back, TIGHT.pos.y + (six ? 0.75 : 0.6) * toward + (six ? 0.2 : 0.12) * Math.abs(side) + (six ? 0.04 * away : 0), TIGHT.pos.z + 0.3 * side);
      want.target.copy(ball);
      if (path?.to) want.target.lerp(new THREE.Vector3(path.to.x, path.to.y ?? 0, path.to.z), six ? 0.3 : 0.18);
      // Keep the striker's end in the first moments, then let it go.
      const keepStriker = Math.max(0, 1 - away / 14);
      want.target.lerp(TIGHT.target, 0.45 * keepStriker);
      want.target.y = six ? Math.min(9, ball.y * 0.7 + 0.5) : Math.min(6, ball.y * 0.6 + 0.2);
      // Lens: show ~12 m around the ball (a six: its height too), more early on while the striker is in shot.
      const dist = want.pos.distanceTo(want.target);
      const span = 12 + 18 * keepStriker + (six ? 6 + ball.y * 1.2 : 0);
      want.fov = Math.max(TIGHT.fov, Math.min(six ? 62 : 48, (2 * Math.atan(span / 2 / dist) * 180) / Math.PI));
    } else if (shot === 'follow') {
      setFrom(want, TIGHT, TIGHT, 0);
    } else {
      setFrom(want, WIDE, WIDE, 0);
    }
    want.fov = fovFor(want.fov);

    // Damped toward the framing: brisk while the ball is live, gentle when settling.
    const rate = shot === 'runup' || shot === 'tight' ? 14 : shot === 'follow' ? 3.2 : shot === 'board' ? 2.6 : 1.4;
    const rateAim = shot === 'follow' ? 6 : rate;
    const s1 = 1 - Math.exp(-dt * rate);
    const s2 = 1 - Math.exp(-dt * rateAim);
    cur.pos.lerp(want.pos, s1);
    cur.target.lerp(want.target, s2);
    cur.fov += (want.fov - cur.fov) * s1;

    place();
    function place() {
    blend += ((mode === 'diorama' ? 1 : 0) - blend) * (1 - Math.exp(-dt * 6));
    if (Math.abs(blend - (mode === 'diorama' ? 1 : 0)) < 1e-3) blend = mode === 'diorama' ? 1 : 0;
    const b = blend * blend * (3 - 2 * blend);
    camera.position.copy(cur.pos).lerp(dio.pos, b);
    const tgt = cur.target.clone().lerp(dio.target, b);
    camera.fov = cur.fov + (dio.fov - cur.fov) * b;
    camera.aspect = aspect;
    camera.near = 0.5;
    camera.far = 330;
    camera.lookAt(tgt);
    camera.updateProjectionMatrix();
    }
  }
  return {
    update,
    resize: fitDiorama,
    toggle() {
      mode = mode === 'broadcast' ? 'diorama' : 'broadcast';
      return mode;
    },
    /** opts.glide: ease from the current view instead of jumping. */
    set(m, opts = {}) {
      mode = m;
      if (!opts.glide) blend = m === 'diorama' ? 1 : 0;
    },
    get mode() {
      return mode;
    },
    get shot() {
      return shot;
    },
  };
}
