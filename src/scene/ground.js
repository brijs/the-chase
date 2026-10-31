import * as THREE from 'three';
import { roundedBoxGeometry } from '../core/geometry.js';
import { contactShadow } from './detail.js';
import { SLAB, PITCH } from '../config.js';

/**
 * The slab and everything fixed on it: mown outfield, the prepared strip with
 * its creases and footmarks, both sets of stumps, the boundary boards with the
 * pavilion gate, the rope, the heavy roller and the drinks crate. Detail goes on
 * the camera-facing surfaces; the backs of the boards are plain.
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
const box = (p, w, h, d, mat, x, y, z, o = {}) =>
  mesh(p, roundedBoxGeometry(w, h, d, Math.min(o.r ?? 0.01, Math.min(w, h, d) * 0.45), 2), mat, x, y, z, o);
const flat = (p, w, d, mat, x, y, z, o = {}) =>
  mesh(p, new THREE.BoxGeometry(w, 0.01, d), mat, x, y, z, { castShadow: false, ...o });
const cyl = (p, r0, r1, h, mat, x, y, z, o = {}) =>
  mesh(p, new THREE.CylinderGeometry(r0, r1, h, o.seg ?? 12), mat, x, y, z, o);

export const STUMP_POS = [-0.114, 0, 0.114];
export const GATE = { x0: -11.6, x1: -7.6, z: -6.55 };
export const MARK = { x: 19.2, z: 0.62 };

export function buildGround(scene, mats) {
  const g = new THREE.Group();
  g.name = 'ground';
  scene.add(g);
  const { hx, hz, thick } = SLAB;

  // Slab body, then mown stripes across the pitch line (they run along Z).
  box(g, hx * 2, thick, hz * 2, mats.slabSide, 0, -thick / 2 - 0.006, 0, { r: 0.02, castShadow: false });
  const stripe = 2.5;
  for (let x = -hx, i = 0; x < hx - 1e-6; x += stripe, i++) {
    const w = Math.min(stripe, hx - x);
    flat(g, w, hz * 2, i % 2 ? mats.grassA : mats.grassB, x + w / 2, -0.003, 0);
  }

  const wickets = buildPitch(g, mats);

  // Run-up marker disc.
  cyl(g, 0.11, 0.11, 0.015, mats.disc, MARK.x, 0.01, MARK.z, { seg: 14, castShadow: false });

  buildBoards(g, mats);
  buildRoller(g, mats, 15.6, 5.4);
  buildCrate(g, mats, -2.6, 5.7);
  return { group: g, wickets };
}

/**
 * The prepared strip, creases, footmarks and both wickets. Shared by the diorama
 * slab and the game's oval. Each wicket group carries its two bail meshes in
 * userData.bails (the game knocks them off).
 */
export function buildPitch(g, mats) {
  // The prepared strip: 3.05 wide, the length of the pitch plus the run-ups' ends.
  const p0 = PITCH.strikerStumps - 1.6;
  const p1 = PITCH.bowlerStumps + 1.6;
  const pitch = flat(g, p1 - p0, PITCH.halfWidth * 2, mats.pitch, (p0 + p1) / 2, 0.004, 0);
  pitch.name = 'pitch';
  // Worn ends: the bowlers' landing areas and the batter's guard.
  flat(g, 2.2, 1.5, mats.pitchWorn, PITCH.bowlerCrease + 0.25, 0.008, 0.35);
  flat(g, 2.0, 1.4, mats.pitchWorn, PITCH.strikerCrease - 0.2, 0.008, -0.1);
  // Creases (0.08 wide: anything thinner rasterises to dots).
  const creaseW = 0.08;
  for (const [cx, sgn] of [
    [PITCH.strikerCrease, -1],
    [PITCH.bowlerCrease, 1],
  ]) {
    flat(g, creaseW, 3.66, mats.crease, cx, 0.012, 0);
    const sx = cx + sgn * PITCH.crease;
    flat(g, creaseW, 2.64, mats.crease, sx, 0.012, 0);
    for (const z of [-1.32, 1.32]) flat(g, 2.44, creaseW, mats.crease, cx + sgn * 1.22, 0.012, z);
  }
  // Footmarks: front-foot holes at the bowler's crease, scuffed guard at the striker's.
  const scuffs = [
    [9.75, 0.45, 0.42, 0.28],
    [10.15, 0.62, 0.35, 0.22],
    [9.45, 0.7, 0.3, 0.2],
    [10.9, 0.95, 0.3, 0.18],
    [-7.85, -0.05, 0.12, 0.42],
    [-7.55, -0.42, 0.3, 0.2],
  ];
  for (const [x, z, w, d] of scuffs) flat(g, w, d, mats.footmark, x, 0.011, z, { rotation: [0, 0.4, 0] });
  // Guard mark scratched on the crease line.
  flat(g, 0.32, 0.05, mats.pitchScuff, PITCH.strikerCrease + 0.05, 0.013, -0.02);

  // Stumps and bails at both ends: the wicket is the goal.
  const wickets = [];
  for (const sx of [PITCH.strikerStumps, PITCH.bowlerStumps]) {
    const w = new THREE.Group();
    w.position.set(sx, 0, 0);
    g.add(w);
    for (const z of STUMP_POS) {
      cyl(w, 0.03, 0.03, PITCH.stumpH, mats.stump, 0, PITCH.stumpH / 2, z, { seg: 8 });
      cyl(w, 0.032, 0.032, 0.09, mats.stumpBand, 0, PITCH.stumpH - 0.17, z, { seg: 8, castShadow: false });
    }
    const bails = [-0.057, 0.057].map((z) => box(w, 0.035, 0.03, 0.12, mats.bail, 0, PITCH.stumpH + 0.012, z, { r: 0.008 }));
    w.userData.bails = bails;
    contactShadow(w, 0, 0, 0, 0.5, 0.45);
    wickets.push(w);
  }

  return wickets;
}

/** Boundary boards along the back edge, with an open pavilion gate. */
function buildBoards(g, mats) {
  const z = GATE.z;
  const colours = [mats.boardBlue, mats.boardNavy, mats.boardYellow, mats.boardOrange];
  const seg = 2.4;
  let i = 0;
  for (let x = -SLAB.hx + 0.3; x < SLAB.hx - 0.3; x += seg, i++) {
    const x0 = x;
    const x1 = Math.min(x + seg, SLAB.hx - 0.3);
    // Leave the gate open.
    const pieces = [];
    if (x1 <= GATE.x0 || x0 >= GATE.x1) pieces.push([x0, x1]);
    else {
      if (x0 < GATE.x0) pieces.push([x0, GATE.x0]);
      if (x1 > GATE.x1) pieces.push([GATE.x1, x1]);
    }
    for (const [a, b] of pieces) {
      const w = b - a - 0.06;
      if (w < 0.2) continue;
      const mat = colours[i % colours.length];
      box(g, w, 0.72, 0.1, mat, (a + b) / 2, 0.36, z, { r: 0.02 });
      // A pale sponsor bar on the face: the "lettering" at this scale.
      box(g, w * 0.62, 0.16, 0.02, mat === mats.boardYellow ? mats.boardNavy : mats.boardText, (a + b) / 2, 0.40, z + 0.055, {
        castShadow: false,
      });
      // Feet: two angled props behind each board.
      for (const fx of [a + 0.3, b - 0.3]) box(g, 0.06, 0.5, 0.06, mats.steel, fx, 0.22, z - 0.18, { rotation: [0.55, 0, 0] });
    }
  }
  // Gate posts and an open picket leaf.
  for (const x of [GATE.x0, GATE.x1]) {
    box(g, 0.14, 1.15, 0.14, mats.whites, x, 0.575, z, { r: 0.02 });
    box(g, 0.18, 0.06, 0.18, mats.whites, x, 1.18, z, { r: 0.02 });
  }
  const leaf = new THREE.Group();
  leaf.position.set(GATE.x0 + 0.08, 0, z);
  leaf.rotation.y = 1.25;
  g.add(leaf);
  for (let k = 0; k < 6; k++) box(leaf, 0.06, 0.85, 0.035, mats.whites, 0.12 + k * 0.17, 0.48, 0, { r: 0.01 });
  for (const y of [0.3, 0.72]) box(leaf, 1.05, 0.06, 0.04, mats.whites, 0.55, y, -0.02, { r: 0.01 });

  // Boundary rope, slightly sagging, in front of the boards.
  const pts = [];
  for (let k = 0; k <= 40; k++) {
    const x = -SLAB.hx + 0.35 + (k / 40) * (SLAB.hx * 2 - 0.7);
    pts.push(new THREE.Vector3(x, 0.05, -6.05 + Math.sin(k * 0.9) * 0.05));
  }
  const rope = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 120, 0.045, 5), mats.boardText);
  rope.castShadow = true;
  g.add(rope);
}

/** Heavy roller: two drums, axle frame, yoke and handle, seat, a rag and rust. */
export function buildRoller(g, mats, x, z) {
  const r = new THREE.Group();
  r.position.set(x, 0, z);
  r.rotation.y = 0.35;
  g.add(r);
  for (const dz of [-0.42, 0.42]) {
    cyl(r, 0.42, 0.42, 0.78, mats.roller, 0, 0.42, dz, { rotation: [Math.PI / 2, 0, 0], seg: 20 });
    cyl(r, 0.2, 0.2, 0.8, mats.rollerDark, 0, 0.42, dz, { rotation: [Math.PI / 2, 0, 0], seg: 10 });
  }
  // Rust patches on the camera-facing drum.
  box(r, 0.22, 0.12, 0.02, mats.rust, 0.15, 0.58, 0.82, { rotation: [0, 0, 0.4], castShadow: false });
  box(r, 0.12, 0.08, 0.02, mats.rust, -0.2, 0.3, 0.82, { castShadow: false });
  // Frame over the drums and the axle bosses.
  // Open frame: two rails and a cross bar, so the drums carry the silhouette.
  for (const dx of [-0.36, 0.36]) box(r, 0.08, 0.08, 1.9, mats.rollerDark, dx, 0.9, 0, { r: 0.02 });
  box(r, 0.8, 0.08, 0.1, mats.rollerDark, 0, 0.9, 0, { r: 0.02 });
  for (const dz of [-0.9, 0.9]) cyl(r, 0.09, 0.09, 0.06, mats.steel, 0, 0.42, dz, { rotation: [Math.PI / 2, 0, 0] });
  for (const dz of [-0.86, 0.86]) box(r, 0.1, 0.5, 0.06, mats.rollerDark, 0.0, 0.66, dz);
  // Seat on a sprung post.
  cyl(r, 0.03, 0.03, 0.32, mats.steel, -0.2, 1.1, 0);
  box(r, 0.34, 0.07, 0.32, mats.leather, -0.2, 1.28, 0, { r: 0.03 });
  // Yoke and handle bar out toward +X, resting on the grass.
  const yoke = new THREE.Group();
  yoke.position.set(0.45, 0.9, 0);
  yoke.rotation.z = -0.55;
  r.add(yoke);
  for (const dz of [-0.35, 0.35]) box(yoke, 1.35, 0.06, 0.06, mats.steel, 0.68, 0, dz);
  box(yoke, 0.06, 0.06, 0.82, mats.steel, 1.35, 0, 0);
  // A red rag knotted on the handle.
  box(yoke, 0.1, 0.16, 0.05, mats.rag, 1.33, -0.1, 0.22, { rotation: [0, 0, 0.5] });
  contactShadow(r, 0, 0, 0, 2.6, 0.5);
}

/** Drinks crate with bottles, a spare helmet on top and a spare bat leaning on it. */
export function buildCrate(g, mats, x, z) {
  const c = new THREE.Group();
  c.position.set(x, 0, z);
  c.rotation.y = -0.3;
  g.add(c);
  box(c, 0.62, 0.32, 0.42, mats.crate, 0, 0.16, 0, { r: 0.03 });
  for (const k of [-1, 0, 1]) box(c, 0.02, 0.2, 0.43, mats.boardNavy, k * 0.2, 0.17, 0, { castShadow: false });
  for (let i = 0; i < 6; i++) {
    const bx = -0.2 + (i % 3) * 0.2;
    const bz = i < 3 ? -0.1 : 0.1;
    cyl(c, 0.045, 0.045, 0.22, mats.whites, bx, 0.4, bz, { seg: 8 });
    cyl(c, 0.025, 0.025, 0.04, mats.boardBlue, bx, 0.53, bz, { seg: 6 });
  }
  // Spare helmet, upside down by the crate, and a bat leaning on it.
  mesh(c, new THREE.SphereGeometry(0.13, 12, 8, 0, Math.PI * 2, 0, 1.6), mats.maroon, 0.58, 0.13, 0.05, {
    rotation: [Math.PI, 0, 0],
  });
  const bat = new THREE.Group();
  bat.position.set(-0.36, 0, 0.15);
  bat.rotation.set(0, 0, -0.32);
  c.add(bat);
  box(bat, 0.108, 0.56, 0.044, mats.willow, 0, 0.29, 0, { r: 0.012 });
  cyl(bat, 0.022, 0.022, 0.3, mats.grip, 0, 0.72, 0);
  contactShadow(c, 0, 0, 0, 1.3, 0.5);
}
