import * as THREE from 'three';
import { roundedBoxGeometry } from '../core/geometry.js';
import { contactShadow } from './detail.js';
import { buildPitch, buildRoller, buildCrate } from './ground.js';
import { OVAL, GATE_PT } from '../game/rules.js';

/**
 * The Chase ground: the same prepared strip and wickets as the diorama, set in
 * a miniature oval. An elliptical slab with mown stripes, a rope, boundary
 * boards with a pavilion gate on the leg side, a sightscreen behind the
 * striker, and the heavy roller and drinks crate parked outside the rope.
 */
const box = (p, w, h, d, mat, x, y, z, o = {}) => {
  const m = new THREE.Mesh(roundedBoxGeometry(w, h, d, Math.min(o.r ?? 0.01, Math.min(w, h, d) * 0.45), 2), mat);
  m.position.set(x, y, z);
  if (o.rotY) m.rotation.y = o.rotY;
  m.castShadow = o.castShadow ?? true;
  m.receiveShadow = true;
  p.add(m);
  return m;
};

const ellZ = (x, [a, b]) => {
  const u = (x - OVAL.cx) / a;
  return u >= 1 ? 0 : b * Math.sqrt(1 - u * u);
};
const ellPt = (th, [a, b], y = 0) => new THREE.Vector3(OVAL.cx + a * Math.cos(th), y, b * Math.sin(th));

/** Points of the oval (for the camera fit): slab rim at deck and underside. */
export const GAME_FIT_POINTS = (() => {
  const pts = [];
  for (let k = 0; k < 24; k++) {
    const th = (k / 24) * Math.PI * 2;
    pts.push(ellPt(th, OVAL.slab, 0), ellPt(th, OVAL.slab, -0.42));
  }
  pts.push(new THREE.Vector3(-27.2, 5.75, 8.2));
  return pts;
})();

export function buildGameGround(scene, mats) {
  const g = new THREE.Group();
  g.name = 'gameGround';
  scene.add(g);
  const thick = 0.42;
  const [sa, sb] = OVAL.slab;

  // Slab body: a cylinder squashed into the ellipse.
  const body = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, thick, 72), mats.slabSide);
  body.scale.set(sa, 1, sb);
  body.position.set(OVAL.cx, -thick / 2 - 0.03, 0); // top sits 3 cm under the grass: no z-fight at 40 m
  body.receiveShadow = true;
  g.add(body);

  // Mown stripes across the pitch line, each cut to the ellipse.
  const stripe = 2.5;
  for (let x0 = OVAL.cx - sa, i = 0; x0 < OVAL.cx + sa - 1e-6; x0 += stripe, i++) {
    const x1 = Math.min(x0 + stripe, OVAL.cx + sa);
    const shape = new THREE.Shape();
    const n = 10;
    for (let k = 0; k <= n; k++) {
      const x = x0 + ((x1 - x0) * k) / n;
      const z = ellZ(x, OVAL.slab);
      k === 0 ? shape.moveTo(x, z) : shape.lineTo(x, z);
    }
    for (let k = n; k >= 0; k--) {
      const x = x0 + ((x1 - x0) * k) / n;
      shape.lineTo(x, -ellZ(x, OVAL.slab));
    }
    const geo = new THREE.ShapeGeometry(shape);
    geo.rotateX(-Math.PI / 2); // shape (x, y) -> world (x, 0, -y), facing up (the ellipse is symmetric)
    const m = new THREE.Mesh(geo, i % 2 ? mats.grassA : mats.grassB);
    m.position.y = -0.003;
    m.receiveShadow = true;
    g.add(m);
  }

  const wickets = buildPitch(g, mats);

  // Rope, a hair above the grass.
  const ropePts = [];
  for (let k = 0; k < 96; k++) ropePts.push(ellPt((k / 96) * Math.PI * 2, OVAL.rope, 0.05));
  const rope = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(ropePts, true), 240, 0.05, 5, true), mats.boardText);
  rope.castShadow = true;
  g.add(rope);

  // The fielding circle: white discs round the ring, as on a real ground.
  const [ra, rb] = OVAL.ring;
  const ringPer = Math.PI * (3 * (ra + rb) - Math.sqrt((3 * ra + rb) * (ra + 3 * rb)));
  const nDots = Math.round(ringPer / 1.5);
  const dots = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.15, 0.15, 0.025, 12), mats.boardText, nDots);
  const m4 = new THREE.Matrix4();
  for (let k = 0; k < nDots; k++) dots.setMatrixAt(k, m4.makeTranslation(ellPt((k / nDots) * Math.PI * 2, OVAL.ring, 0.012)));
  dots.receiveShadow = true;
  dots.name = 'fielding-circle';
  g.add(dots);

  // Boards round the ellipse, sponsor bars facing in; a gap for the gate.
  const colours = [mats.boardBlue, mats.boardNavy, mats.boardYellow, mats.boardOrange];
  const [ba, bb] = OVAL.boards;
  const per = Math.PI * (3 * (ba + bb) - Math.sqrt((3 * ba + bb) * (ba + 3 * bb)));
  const nSeg = Math.round(per / 2.4);
  const gateTh = Math.atan2(GATE_PT.z / bb, (GATE_PT.x - OVAL.cx) / ba);
  for (let k = 0; k < nSeg; k++) {
    const th0 = (k / nSeg) * Math.PI * 2;
    const th1 = ((k + 1) / nSeg) * Math.PI * 2;
    const thm = (th0 + th1) / 2;
    let dg = Math.abs(((thm - gateTh + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    if (dg < 0.09) continue;
    const a = ellPt(th0, OVAL.boards);
    const b = ellPt(th1, OVAL.boards);
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const len = a.distanceTo(b) - 0.06;
    const yaw = -Math.atan2(b.z - a.z, b.x - a.x);
    const mat = colours[k % colours.length];
    const seg = new THREE.Group();
    seg.position.copy(mid);
    seg.rotation.y = yaw;
    g.add(seg);
    box(seg, len, 0.72, 0.1, mat, 0, 0.36, 0, { r: 0.02 });
    // Which side faces the middle: the inward normal is toward the centre.
    const inward = new THREE.Vector3(OVAL.cx, 0, 0).sub(mid).normalize();
    const localZ = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    const s = Math.sign(inward.dot(localZ)) || 1;
    box(seg, len * 0.62, 0.16, 0.02, mat === mats.boardYellow ? mats.boardNavy : mats.boardText, 0, 0.4, 0.055 * s, { castShadow: false });
  }
  // Gate posts and an open picket leaf.
  const gp = ellPt(gateTh, OVAL.boards);
  const tang = new THREE.Vector3(-ba * Math.sin(gateTh), 0, bb * Math.cos(gateTh)).normalize();
  for (const s of [-1, 1]) {
    const p = gp.clone().addScaledVector(tang, s * 1.9);
    box(g, 0.14, 1.15, 0.14, mats.whites, p.x, 0.575, p.z, { r: 0.02 });
    box(g, 0.18, 0.06, 0.18, mats.whites, p.x, 1.18, p.z, { r: 0.02 });
  }
  const leaf = new THREE.Group();
  leaf.position.copy(gp.clone().addScaledVector(tang, -1.8));
  leaf.rotation.y = -Math.atan2(tang.z, tang.x) - 1.1;
  g.add(leaf);
  for (let k = 0; k < 6; k++) box(leaf, 0.06, 0.85, 0.035, mats.whites, 0.12 + k * 0.17, 0.48, 0, { r: 0.01 });
  for (const y of [0.3, 0.72]) box(leaf, 1.05, 0.06, 0.04, mats.whites, 0.55, y, -0.02, { r: 0.01 });

  // Sightscreen behind the striker (what the broadcast camera looks at).
  const ss = new THREE.Group();
  ss.position.set(OVAL.cx - OVAL.boards[0] - 1.4, 0, 0.3); // just outside the boards
  g.add(ss);
  box(ss, 0.18, 2.1, 6.2, mats.whites, 0, 1.25, 0, { r: 0.03 });
  for (const z of [-2.6, 0, 2.6]) box(ss, 0.3, 0.2, 0.3, mats.woodDark, 0.0, 0.1, z);
  box(ss, 0.2, 0.08, 6.3, mats.whitesShade, 0.02, 2.33, 0, { castShadow: false });
  contactShadow(ss, 0, 0, 0, 3.0, 0.4);

  buildRoller(g, mats, 25.2, -5.2);
  buildCrate(g, mats, GATE_PT.x + 3.2, GATE_PT.z + 0.4);

  return { group: g, wickets };
}
