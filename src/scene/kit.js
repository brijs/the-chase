import * as THREE from 'three';
import { roundedBoxGeometry } from '../core/geometry.js';
import { BALL_R } from '../config.js';

/**
 * Cricket kit built onto the clothed rig: helmet with a grille, pads, gauntlets,
 * keeper gloves, caps, the umpire's hat, the bat and the ball. Rig sides follow
 * peopleModel-street.js: joints named "L" sit at local -x, which is the figure's
 * anatomical RIGHT (it faces +Z). So a right-arm bowler bowls with `shoulderL`, and
 * a right-handed batter's top (left) hand is `wristR`.
 */

function mesh(parent, geo, mat, x, y, z, opts = {}) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  if (opts.rotation) m.rotation.set(...opts.rotation);
  if (opts.scale) m.scale.set(...opts.scale);
  m.castShadow = opts.castShadow ?? true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}
const box = (parent, w, h, d, mat, x, y, z, opts = {}) =>
  mesh(parent, roundedBoxGeometry(w, h, d, Math.min(opts.r ?? 0.008, Math.min(w, h, d) * 0.45), 2), mat, x, y, z, opts);
const cyl = (parent, r0, r1, h, mat, x, y, z, opts = {}) =>
  mesh(parent, new THREE.CylinderGeometry(r0, r1, h, opts.seg ?? 10), mat, x, y, z, opts);

/**
 * Helmet: shell, peak, a two-bar grille on side stems, neck guard and a crest.
 * Returns the shell material (cloned so the hit flash touches one helmet) and the
 * scuff decal the bouncer leaves behind.
 */
export function addHelmet(person, mats, shellMat = mats.maroon) {
  const head = person.joints.head;
  const g = new THREE.Group();
  head.add(g);
  const shell = shellMat.clone();
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.131, 18, 12, 0, Math.PI * 2, 0, 1.62), shell);
  dome.position.set(0, 0.118, -0.008);
  dome.scale.set(1.0, 1.0, 1.06);
  dome.castShadow = true;
  g.add(dome);
  // Peak, angled down over the eyes; a darker under-side band reads as its thickness.
  box(g, 0.21, 0.016, 0.085, shell, 0, 0.168, 0.135, { rotation: [-0.32, 0, 0] });
  box(g, 0.20, 0.008, 0.02, mats.maroonDark, 0, 0.152, 0.172, { rotation: [-0.32, 0, 0], castShadow: false });
  // Grille: side stems, two curved bars and a centre bar; chunky so it survives 1:1.
  for (const s of [-1, 1]) {
    box(g, 0.016, 0.11, 0.016, mats.grille, s * 0.112, 0.075, 0.062, { rotation: [0.15, 0, 0] });
    box(g, 0.034, 0.07, 0.07, shell, s * 0.118, 0.10, 0.0, { r: 0.012 });
  }
  for (const [y, r] of [
    [0.110, 0.135],
    [0.050, 0.124],
  ]) {
    const arc = new THREE.Mesh(new THREE.TorusGeometry(r, 0.0085, 4, 14, Math.PI * 0.9), mats.grille);
    arc.rotation.set(Math.PI / 2, 0, Math.PI * 0.05);
    arc.position.set(0, y, 0.0);
    arc.castShadow = true;
    g.add(arc);
  }
  box(g, 0.012, 0.075, 0.012, mats.grille, 0, 0.08, 0.130, { rotation: [0.08, 0, 0] });
  // Neck guard and a crest stripe down the crown.
  box(g, 0.13, 0.055, 0.024, mats.maroonDark, 0, 0.06, -0.122, { rotation: [-0.2, 0, 0] });
  box(g, 0.022, 0.012, 0.19, mats.whites, 0, 0.252, -0.005, { rotation: [0.05, 0, 0], castShadow: false });
  // The bouncer leaves a pale scuff on the grille side of the shell.
  const scuff = box(g, 0.05, 0.03, 0.012, mats.whitesShade, 0.07, 0.16, 0.10, {
    rotation: [-0.3, 0.6, 0],
    castShadow: false,
  });
  scuff.visible = false;
  return { group: g, shell, scuff };
}

/** Front pads: shaped face, three ridges, knee roll and two straps, per shin. */
export function addPads(person, mats) {
  const J = person.joints;
  for (const side of ['L', 'R']) {
    const knee = J['knee' + side];
    const hip = J['hip' + side];
    const pad = new THREE.Group();
    knee.add(pad);
    box(pad, 0.15, 0.50, 0.07, mats.padWhite, 0, -0.17, 0.06, { r: 0.02 });
    for (const x of [-0.045, 0, 0.045]) {
      box(pad, 0.026, 0.44, 0.018, mats.whites, x, -0.17, 0.098, { castShadow: false });
    }
    box(pad, 0.16, 0.10, 0.09, mats.padWhite, 0, 0.07, 0.055, { r: 0.03 });
    for (const y of [-0.06, -0.30]) {
      box(pad, 0.17, 0.03, 0.13, mats.padStrap, 0, y, 0.0, { castShadow: false });
    }
    // Thigh flap above the knee roll.
    box(hip, 0.15, 0.13, 0.05, mats.padWhite, 0, -0.32, 0.075, { r: 0.02 });
  }
}

/** Batting gauntlets: a cuff ring and a knuckle roll over the rig's hand. */
export function addBattingGloves(person, mats) {
  for (const side of ['L', 'R']) {
    const w = person.joints['wrist' + side];
    cyl(w, 0.05, 0.05, 0.06, mats.glove, 0, 0.01, 0.0);
    box(w, 0.08, 0.028, 0.06, mats.padStrap, 0, -0.07, 0.03, { castShadow: false });
  }
}

/** Keeper gloves: oversized mitts with a red web between thumb and fingers. */
export function addKeeperGloves(person, mats) {
  for (const side of ['L', 'R']) {
    const w = person.joints['wrist' + side];
    box(w, 0.13, 0.17, 0.08, mats.gloveKeeper, 0, -0.08, 0.02, { r: 0.03 });
    box(w, 0.05, 0.06, 0.03, mats.gloveWeb, (side === 'L' ? 1 : -1) * 0.04, -0.13, 0.06, { castShadow: false });
    cyl(w, 0.06, 0.06, 0.06, mats.gloveKeeper, 0, 0.01, 0.0);
  }
}

/** A cricket cap: crown, button and a long peak. */
export function addCap(person, mats, mat = mats.navy) {
  const head = person.joints.head;
  mesh(head, new THREE.SphereGeometry(0.118, 16, 10, 0, Math.PI * 2, 0, 1.45), mat, 0, 0.13, -0.004);
  box(head, 0.18, 0.014, 0.11, mat, 0, 0.165, 0.13, { rotation: [-0.14, 0, 0] });
  mesh(head, new THREE.SphereGeometry(0.014, 6, 4), mat, 0, 0.247, 0);
}

/** Umpire: wide-brim white hat, and the bowler's cap tucked in his belt. */
export function addUmpireHat(person, mats) {
  const head = person.joints.head;
  cyl(head, 0.10, 0.118, 0.10, mats.umpireHat, 0, 0.21, 0, { seg: 16 });
  cyl(head, 0.24, 0.24, 0.014, mats.umpireHat, 0, 0.165, 0, { seg: 20 });
  cyl(head, 0.121, 0.121, 0.026, mats.navy, 0, 0.18, 0, { seg: 16 });
  const pelvis = person.joints.pelvis;
  mesh(pelvis, new THREE.SphereGeometry(0.08, 10, 6, 0, Math.PI * 2, 0, 1.3), mats.navy, 0.13, 0.0, 0.13, {
    rotation: [1.3, 0, -0.3],
  });
}

/** Fast bowler: towel tucked at the right hip, sweatband on the bowling wrist. */
export function addBowlerKit(person, mats) {
  const J = person.joints;
  box(J.pelvis, 0.10, 0.26, 0.02, mats.towel, -0.12, -0.12, -0.15, { rotation: [0.2, 0.4, 0.06] });
  cyl(J.wristL, 0.052, 0.052, 0.05, mats.sweatband, 0, 0.0, 0.0);
  cyl(J.wristR, 0.052, 0.052, 0.05, mats.sweatband, 0, 0.0, 0.0);
}

/**
 * The bat. Origin at the top of the handle, blade hanging down -Y, face +Z,
 * spine ridge -Z. Length 0.89 m. Carried in world space by the actor, never parented
 * to a wrist: the top palm sets the position, the pose sets the direction, and
 * the bottom hand is IK'd onto the handle.
 */
export function buildBat(mats) {
  const g = new THREE.Group();
  cyl(g, 0.024, 0.024, 0.04, mats.grip, 0, -0.01, 0);
  cyl(g, 0.022, 0.022, 0.22, mats.grip, 0, -0.13, 0);
  cyl(g, 0.019, 0.026, 0.07, mats.willowEdge, 0, -0.275, 0);
  box(g, 0.108, 0.56, 0.044, mats.willow, 0, -0.59, 0, { r: 0.012 });
  box(g, 0.050, 0.42, 0.030, mats.willowEdge, 0, -0.62, -0.03, { r: 0.012 });
  box(g, 0.112, 0.06, 0.008, mats.batSticker, 0, -0.39, 0.024, { castShadow: false });
  box(g, 0.110, 0.025, 0.05, mats.willowEdge, 0, -0.865, 0, { castShadow: false });
  // A red seam mark on the outside edge: where the ball has caught it before.
  box(g, 0.012, 0.06, 0.02, mats.batSticker, 0.052, -0.72, 0.004, { castShadow: false });
  return g;
}

/** The ball, with a seam ring so it does not read as a dot. */
export function buildBall(mats) {
  const g = new THREE.Group();
  const s = mesh(g, new THREE.SphereGeometry(BALL_R, 12, 8), mats.ball, 0, 0, 0);
  s.castShadow = true;
  mesh(g, new THREE.TorusGeometry(BALL_R * 1.005, BALL_R * 0.13, 4, 14), mats.ballSeam, 0, 0, 0, {
    rotation: [0, Math.PI / 2, 0.35],
    castShadow: false,
  });
  return g;
}
