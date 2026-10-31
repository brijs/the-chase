import * as THREE from 'three';
import { RIG } from './peopleModel-street.js';

/**
 * Two-bone arm IK, used for the bottom hand on the bat handle so "palms on the
 * prop" holds in every frame instead of on the frame the pose was tuned for.
 * Works in torso space; the shoulder group's rest orientation is identity.
 */
const U = RIG.upperArm;
const F = RIG.foreArm - 0.01 + 0.05; // elbow -> wrist group + wrist -> palm centre

const _t = new THREE.Vector3();
const _d = new THREE.Vector3();
const _p0 = new THREE.Vector3();
const _e = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qt = new THREE.Quaternion();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

/**
 * Put the palm of `side` ('L' | 'R') on `targetWorld`. `poleLocal` is the
 * direction, in torso space, the elbow should point toward (down and out).
 * Returns the residual distance from palm to target, in metres.
 */
export function reachArm(person, side, targetWorld, poleLocal) {
  const J = person.joints;
  const torso = J.torso;
  const shoulder = J['shoulder' + side];
  const elbow = J['elbow' + side];
  torso.updateWorldMatrix(true, false);
  _t.copy(targetWorld);
  torso.worldToLocal(_t);
  _d.subVectors(_t, shoulder.position);
  const want = _d.length();
  const dist = THREE.MathUtils.clamp(want, Math.abs(U - F) + 0.02, U + F - 0.002);
  const cosE = (U * U + F * F - dist * dist) / (2 * U * F);
  const flex = Math.PI - Math.acos(THREE.MathUtils.clamp(cosE, -1, 1));
  elbow.rotation.set(-flex, 0, 0);

  // Palm with the elbow flexed and the shoulder at rest.
  _p0.set(0, -U - F * Math.cos(flex), F * Math.sin(flex));
  _q.setFromUnitVectors(_a.copy(_p0).normalize(), _b.copy(_d).normalize());

  // Twist about the shoulder->target axis so the elbow points at the pole.
  _e.set(0, -U, 0).applyQuaternion(_q);
  const axis = _b;
  _e.addScaledVector(axis, -_e.dot(axis));
  _pole.copy(poleLocal).addScaledVector(axis, -poleLocal.dot(axis));
  if (_e.lengthSq() > 1e-8 && _pole.lengthSq() > 1e-8) {
    _e.normalize();
    _pole.normalize();
    let ang = Math.acos(THREE.MathUtils.clamp(_e.dot(_pole), -1, 1));
    if (_a.crossVectors(_e, _pole).dot(axis) < 0) ang = -ang;
    _qt.setFromAxisAngle(axis, ang);
    _q.premultiply(_qt);
  }
  shoulder.quaternion.copy(_q);
  return Math.abs(want - dist);
}
