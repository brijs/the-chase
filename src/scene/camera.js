import * as THREE from 'three';

/**
 * Locked three-quarter camera. Distance is solved against a set of fit points
 * (slab corners plus the tops of tall props) so the play keeps its white
 * margin at every aspect ratio. Nothing here orbits or drifts.
 */
export const CAMERA = {
  fov: 20.5,
  azimuth: (45.0 * Math.PI) / 180,
  elevation: (33.0 * Math.PI) / 180,
  target: new THREE.Vector3(0, -0.15, 0),
  baseTarget: new THREE.Vector3(0, -0.15, 0),
  fillX: 0.9,
  fillY: 0.88,
  // Post-fit camera multiplier. Keep 1.0 for the fitted size; 0.70 makes the
  // diorama 30% smaller linearly and leaves more paper margin. This is a camera
  // move only: slab, world clip, shadows and canvas stay at full scale.
  subjectScale: 1.0,
};

/** Override this list for a different slab / landmark height. */
export const FIT_POINTS = [
  // 40 x 14 slab at deck and underside, plus the scoreboard flags and the roller.
  ...[-20, 20].flatMap((x) => [-7, 7].flatMap((z) => [new THREE.Vector3(x, 0, z), new THREE.Vector3(x, -0.42, z)])),
  new THREE.Vector3(-1.5, 5.75, -6.1),
  new THREE.Vector3(15.6, 1.3, 5.4),
];

export function cameraDirection(out = new THREE.Vector3()) {
  const ce = Math.cos(CAMERA.elevation);
  return out.set(
    ce * Math.cos(CAMERA.azimuth),
    Math.sin(CAMERA.elevation),
    ce * Math.sin(CAMERA.azimuth)
  );
}

function fits(dir, right, up, aspect, distance, points) {
  const tanHalf = Math.tan((CAMERA.fov * Math.PI) / 360);
  const p = new THREE.Vector3();
  for (const fit of points) {
    p.subVectors(fit, CAMERA.target);
    const depth = distance - p.dot(dir);
    if (depth < 0.4) return false;
    const x = p.dot(right) / (depth * tanHalf * aspect);
    const y = p.dot(up) / (depth * tanHalf);
    if (Math.abs(x) > CAMERA.fillX) return false;
    if (Math.abs(y) > CAMERA.fillY) return false;
  }
  return true;
}

export function solveDistance(aspect, points = FIT_POINTS) {
  const a = Math.max(0.3, aspect);
  const dir = cameraDirection();
  const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), dir).normalize();
  const up = new THREE.Vector3().crossVectors(dir, right).normalize();

  let lo = 5;
  let hi = 300;
  for (let i = 0; i < 48; i++) {
    const mid = (lo + hi) * 0.5;
    if (fits(dir, right, up, a, mid, points)) hi = mid;
    else lo = mid;
  }
  return hi;
}

export function createCamera(aspect = 1.16, points = FIT_POINTS) {
  const camera = new THREE.PerspectiveCamera(CAMERA.fov, aspect, 0.5, 400);
  updateCamera(camera, aspect, points);
  return camera;
}

/**
 * Project the fit points at a given target/distance and return the centre of
 * their screen-space bounds in NDC. A long slab seen at 45/33 projects lower
 * and to one side of the target, so the template's fixed target wastes margin.
 */
function projectedCentre(target, distance, aspect, points) {
  const tanHalf = Math.tan((CAMERA.fov * Math.PI) / 360);
  const dir = cameraDirection();
  const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), dir).normalize();
  const up = new THREE.Vector3().crossVectors(dir, right).normalize();
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  const p = new THREE.Vector3();
  for (const fit of points) {
    p.subVectors(fit, target);
    const depth = distance - p.dot(dir);
    const x = p.dot(right) / (depth * tanHalf * aspect);
    const y = p.dot(up) / (depth * tanHalf);
    x0 = Math.min(x0, x); x1 = Math.max(x1, x);
    y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, right, up, tanHalf };
}

export function updateCamera(camera, aspect, points = FIT_POINTS) {
  const a = Math.max(0.3, aspect);
  // Calibrated for this scene: re-centre the target on the projected slab, then
  // re-solve. Angles, fov and subjectScale are untouched; only the look-at point
  // moves (in the ground plane), which is a framing margin, not a camera move.
  const target = CAMERA.baseTarget.clone();
  let fit = 0;
  for (let i = 0; i < 6; i++) {
    CAMERA.target.copy(target);
    fit = solveDistance(a, points);
    const c = projectedCentre(target, fit, a, points);
    // Screen right lies in the ground plane; screen up maps to a ground move away
    // from the camera of up / sin(elevation).
    const away = cameraDirection().setY(0).normalize().negate();
    target.addScaledVector(c.right, c.cx * fit * c.tanHalf * a);
    target.addScaledVector(away, (c.cy * fit * c.tanHalf) / Math.sin(CAMERA.elevation));
    target.y = CAMERA.baseTarget.y;
  }
  CAMERA.target.copy(target);
  fit = solveDistance(a, points);
  const scale = CAMERA.subjectScale ?? 1;
  const d = fit / Math.max(0.1, scale);
  const dir = cameraDirection();
  camera.position.copy(CAMERA.target).addScaledVector(dir, d);
  camera.lookAt(CAMERA.target);
  camera.aspect = a;
  camera.near = Math.max(0.3, d * 0.01);
  camera.far = d * 4 + 80;
  camera.updateProjectionMatrix();
  camera.userData.fitDistance = fit;
  camera.userData.subjectScale = scale;
  camera.userData.distance = d;
  camera.userData.target = CAMERA.target.clone();
}
