import * as THREE from 'three';
import { P } from '../core/materials.js';
import { OVAL, STANDS, SEATED, PAVILION, seatedTh, profileY, standHeight, makeRng } from '../game/rules.js';

/**
 * The world round the Chase's oval (game only; the diorama keeps its floating
 * slab on paper): a sky, the bowl of banks and terraces with a sprinkling of
 * spectators, a pavilion behind the gate, floodlight towers, a ring of trees,
 * green hills and snow-capped mountains on the horizon.
 *
 * The bowl's surface is the profile in rules.js (STANDS / profileY), which the
 * ball also lands on. Everything far is unlit vertex colour (palette tones,
 * shaded by hand toward the sun), and nothing past the stands casts a shadow.
 *
 * update(t) animates the crowd: the people near where a six lands (cheer())
 * stand up and bounce for a moment. It is a pure function of t, so replays
 * show it again.
 */
const SUN = new THREE.Vector3(-22, 29, 25).normalize();
const lin = (hex) => P(hex);
const mix = (a, b, k) => a.clone().lerp(b, k);

/** Offset-ellipse point: d metres past the slab's rim at angle th. */
function ringPt(th, d, y) {
  const [a, b] = OVAL.slab;
  return [OVAL.cx + (a + d) * Math.cos(th), y, (b + d) * Math.sin(th)];
}
const inPavilion = (th) => th >= PAVILION[0] && th <= PAVILION[1];

/** Flat-shaded triangles with per-face colour (non-indexed). */
function soup() {
  const pos = [];
  const col = [];
  return {
    tri(a, b, c, colour) {
      pos.push(...a, ...b, ...c);
      for (let i = 0; i < 3; i++) col.push(colour.r, colour.g, colour.b);
    },
    quad(a, b, c, d, colour) {
      this.tri(a, b, c, colour);
      this.tri(a, c, d, colour);
    },
    geometry() {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      g.computeVertexNormals();
      return g;
    },
  };
}
/** Hand shading for unlit meshes: the face's normal toward the sun picks between two tones. */
const faceLit = (a, b, c) => {
  const u = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const v = new THREE.Vector3(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
  const n = u.cross(v).normalize();
  if (n.y < 0) n.negate();
  return n.dot(SUN);
};

export function buildStadium(scene, mats) {
  const g = new THREE.Group();
  g.name = 'stadium';
  scene.add(g);
  const rng = makeRng(4242);

  // ---------------------------------------------------------------- sky
  const SKY_TONES = {
    clear: ['#f6f2e6', '#7dbbe3', '#3a83c6'],
    grey: ['#ebe4d0', '#d3d7d6', '#a9b0b1'],
  };
  const skyGeo = new THREE.SphereGeometry(240, 32, 16);
  skyGeo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(skyGeo.attributes.position.count * 3), 3));
  const skyMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, depthWrite: false, fog: false });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  sky.position.set(OVAL.cx, 0, 0);
  sky.renderOrder = -10;
  sky.frustumCulled = false;
  g.add(sky);
  function setSky(kind = 'clear') {
    const [hz, mid, top] = (SKY_TONES[kind] ?? SKY_TONES.clear).map(lin);
    const ground = lin('#466b35');
    const p = skyGeo.attributes.position;
    const c = skyGeo.attributes.color;
    for (let i = 0; i < p.count; i++) {
      const el = Math.asin(Math.max(-1, Math.min(1, p.getY(i) / 240)));
      const k = el / (Math.PI / 2);
      const col = el < 0 ? ground : k < 0.08 ? mix(hz, mid, k / 0.08) : mix(mid, top, Math.min(1, (k - 0.08) / 0.6));
      c.setXYZ(i, col.r, col.g, col.b);
    }
    c.needsUpdate = true;
  }
  setSky('clear');

  // ---------------------------------------------------------------- the bowl
  // Swept round the ellipse in segments; each segment takes the stepped
  // profile (seats) or the smooth bank, with an end wall where they meet.
  const N = 240;
  const S = STANDS;
  const [dTop, yTop] = S.bankTop;
  const treadEnd = dTop + S.steps * S.tread;
  const C = {
    apron: lin('#517b3c'),
    bank: lin('#5c8a43'),
    bankB: lin('#517b3c'),
    tread: lin('#d3d7d6'),
    riser: lin('#7d8789'),
    concourse: lin('#a9b0b1'),
    wall: lin('#dcd3ba'),
    wallTop: lin('#b0a68a'),
    land: lin('#5c8a43'),
    landB: lin('#69994b'),
  };
  /** The section's polyline: [d, y, colour] (vertical steps repeat d). */
  function section(seated, i) {
    const stripe = i % 2 ? C.bank : C.bankB;
    const pts = [[0, 0, C.apron], [S.apron, 0, C.apron], [dTop, yTop, stripe]];
    if (seated) {
      for (let k = 0; k < S.steps; k++) {
        const d0 = dTop + k * S.tread;
        const y = yTop + (k + 1) * S.rise;
        pts.push([d0, y, C.riser], [d0 + S.tread, y, C.tread]);
      }
      pts.push([S.concourse, yTop + S.steps * S.rise, C.concourse], [S.wall[0], S.wall[2], C.wall], [S.wall[1], S.wall[2], C.wallTop], [S.wall[1], profileY(S.wall[1] + 0.01, true), C.wall]);
    } else {
      pts.push([treadEnd, profileY(treadEnd, false), stripe], [S.wall[1], profileY(S.wall[1], false), stripe]);
    }
    for (const d of [24, 34, 48, 64, 84, 110, 140]) pts.push([d, profileY(d, false), d < 40 ? C.land : C.landB]);
    return pts;
  }
  const bowl = soup();
  const segTh = (i) => -Math.PI + (i / N) * Math.PI * 2;
  for (let i = 0; i < N; i++) {
    const t0 = segTh(i);
    const t1 = segTh(i + 1);
    const tm = (t0 + t1) / 2;
    const seated = seatedTh(tm);
    const pts = section(seated, i);
    for (let k = 0; k + 1 < pts.length; k++) {
      const [da, ya] = pts[k];
      const [db, yb, col] = pts[k + 1];
      if (da === db && ya === yb) continue;
      bowl.quad(ringPt(t0, da, ya), ringPt(t0, db, yb), ringPt(t1, db, yb), ringPt(t1, da, ya), col);
    }
    // End walls where seats meet the plain bank.
    for (const [ta, tb, side] of [[t0, segTh(i - 1), 0], [t1, segTh(i + 1), 1]]) {
      const nb = seatedTh(side ? (t1 + segTh(i + 2)) / 2 : (segTh(i - 1) + t0) / 2);
      if (!seated || nb) continue;
      for (let k = 0; k < S.steps; k++) {
        const d0 = dTop + k * S.tread;
        const d1 = d0 + S.tread;
        const y = yTop + (k + 1) * S.rise;
        const q = [ringPt(ta, d0, profileY(d0, false)), ringPt(ta, d0, y), ringPt(ta, d1, y), ringPt(ta, d1, profileY(d1, false))];
        side ? bowl.quad(q[0], q[1], q[2], q[3], C.riser) : bowl.quad(q[3], q[2], q[1], q[0], C.riser);
      }
      const q = [ringPt(ta, treadEnd, yTop + S.steps * S.rise), ringPt(ta, S.wall[0], S.wall[2]), ringPt(ta, S.wall[1], S.wall[2]), ringPt(ta, S.wall[1], profileY(S.wall[1], false))];
      side ? bowl.quad(q[0], q[1], q[2], q[3], C.wall) : bowl.quad(q[3], q[2], q[1], q[0], C.wall);
      void tb;
    }
  }
  const bowlMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide });
  const bowlMesh = new THREE.Mesh(bowl.geometry(), bowlMat);
  bowlMesh.receiveShadow = true;
  g.add(bowlMesh);

  // ---------------------------------------------------------------- seats and people
  const seatCols = ['#283a63', '#9a2731', '#2f8f86', '#e39a2e'].map(lin);
  const benchGeo = new THREE.BoxGeometry(1, 0.12, 0.42);
  const benchSlots = [];
  const people = [];
  const m4 = new THREE.Matrix4();
  const q4 = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < N; i++) {
    const t0 = segTh(i);
    const t1 = segTh(i + 1);
    const tm = (t0 + t1) / 2;
    if (!seatedTh(tm) || inPavilion(tm) || i % 14 === 0) continue; // aisles
    const block = Math.floor(i / 14);
    const col = seatCols[block % seatCols.length];
    // How full this block is: clumps of fans, empty patches.
    const fill = 0.08 + 0.42 * Math.pow((Math.sin(block * 2.7 + 1.3) + 1) / 2, 1.6);
    for (let k = 0; k < S.steps; k++) {
      const d = dTop + k * S.tread + 0.6;
      const y = yTop + (k + 1) * S.rise;
      const a = new THREE.Vector3(...ringPt(t0, d, y));
      const b = new THREE.Vector3(...ringPt(t1, d, y));
      const len = a.distanceTo(b);
      const yaw = -Math.atan2(b.z - a.z, b.x - a.x);
      benchSlots.push({ mid: a.clone().add(b).multiplyScalar(0.5), len, yaw, y, col });
      const n = Math.floor(len / 0.62);
      for (let s = 0; s < n; s++) {
        if (rng() > fill) continue;
        const u = (s + 0.5) / n;
        const p = a.clone().lerp(b, u);
        people.push({ x: p.x, y: y + 0.06, z: p.z, yaw, shirt: rng.int(0, 7), skin: rng.int(0, 4), phase: rng() * 6.28 });
      }
    }
  }
  const benches = new THREE.InstancedMesh(benchGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 }), benchSlots.length);
  benchSlots.forEach((s, i) => {
    q4.setFromAxisAngle(up, s.yaw);
    m4.compose(new THREE.Vector3(s.mid.x, s.y + 0.36, s.mid.z), q4, new THREE.Vector3(s.len - 0.04, 1, 1));
    benches.setMatrixAt(i, m4);
    benches.setColorAt(i, s.col);
  });
  benches.receiveShadow = true;
  g.add(benches);

  const shirts = ['#f6f2e6', '#3a83c6', '#c13a3c', '#f3c94a', '#2f8f86', '#283a63', '#e5843a', '#9cc472'].map(lin);
  const skins = ['#f0cfae', '#dcae86', '#c48f66', '#a06d48', '#704831'].map(lin);
  const bodyGeo = new THREE.BoxGeometry(0.34, 0.5, 0.26);
  bodyGeo.translate(0, 0.25, 0);
  const headGeo = new THREE.BoxGeometry(0.2, 0.22, 0.2);
  headGeo.translate(0, 0.62, 0);
  const pmat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 });
  const bodies = new THREE.InstancedMesh(bodyGeo, pmat, people.length);
  const heads = new THREE.InstancedMesh(headGeo, pmat, people.length);
  bodies.castShadow = false;
  heads.castShadow = false;
  people.forEach((p, i) => {
    bodies.setColorAt(i, shirts[p.shirt]);
    heads.setColorAt(i, skins[p.skin]);
  });
  g.add(bodies, heads);
  const seat = (p, i, lift) => {
    q4.setFromAxisAngle(up, p.yaw);
    m4.compose(new THREE.Vector3(p.x, p.y + 0.36 + lift, p.z), q4, new THREE.Vector3(1, 1 + lift * 0.6, 1));
    bodies.setMatrixAt(i, m4);
    heads.setMatrixAt(i, m4);
  };
  people.forEach((p, i) => seat(p, i, 0));

  // ---------------------------------------------------------------- pavilion
  {
    const pav = new THREE.Group();
    const tm = (PAVILION[0] + PAVILION[1]) / 2;
    const [px, , pz] = ringPt(tm, 11.5, 0);
    pav.position.set(px, 0, pz);
    pav.rotation.y = Math.atan2(px - OVAL.cx, pz) + Math.PI;
    g.add(pav);
    const box = (w, h, d, mat, x, y, z) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      m.receiveShadow = true;
      pav.add(m);
      return m;
    };
    const white = mats.whites;
    const roof = new THREE.MeshStandardMaterial({ color: P('#9a2731'), roughness: 0.8 });
    const glass = mats.navyDark;
    box(14, 7.2, 7, white, 0, 3.6, -1.5); // the building, sitting into the bank
    box(13.4, 1.0, 0.1, glass, 0, 5.4, 2.02);
    box(13.4, 1.0, 0.1, glass, 0, 3.4, 2.02);
    box(15, 0.3, 4, mats.whitesShade, 0, 4.4, 3.4); // balcony
    for (const x of [-6.6, -2.2, 2.2, 6.6]) box(0.18, 1.0, 0.18, white, x, 4.9, 5.2);
    // A pitched roof and a clock turret.
    const rg = new THREE.CylinderGeometry(0.01, 5.2, 2.6, 4, 1);
    const r = new THREE.Mesh(rg, roof);
    r.scale.set(2.0, 1, 1.0);
    r.rotation.y = Math.PI / 4;
    r.position.set(0, 8.5, -1.5);
    r.castShadow = true;
    pav.add(r);
    box(1.6, 2.2, 1.6, white, 0, 10.2, -1.5);
    box(1.0, 1.0, 0.05, mats.boardText, 0, 10.4, -0.68);
    const flag = box(0.06, 2.4, 0.06, mats.steel, 0, 12.4, -1.5);
    void flag;
    box(1.1, 0.6, 0.03, mats.flagA, 0.58, 13.2, -1.5);
  }

  // ---------------------------------------------------------------- floodlights
  for (const th of [0.3, -0.3, 2.72, -2.72]) {
    const [x, , z] = ringPt(th, 19.5, 0);
    const y0 = profileY(19.5, false);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.6, 26, 6), mats.steel);
    pole.position.set(x, y0 + 13, z);
    g.add(pole);
    const head = new THREE.Group();
    head.position.set(x, y0 + 26.5, z);
    head.lookAt(OVAL.cx, 0, 0);
    g.add(head);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(5, 3, 0.4), mats.rollerDark);
    head.add(frame);
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 5; c++) {
        const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.7, 0.1), mats.lampOn);
        lamp.position.set(-2 + c, -1 + r, 0.25);
        head.add(lamp);
      }
  }

  // ---------------------------------------------------------------- trees
  const trees = [];
  for (let i = 0; i < 170; i++) {
    const th = rng() * Math.PI * 2 - Math.PI;
    const d = 21 + Math.pow(rng(), 0.7) * 38;
    if (seatedTh(th) && d < 19) continue;
    const [x, , z] = ringPt(th, d, 0);
    trees.push({ x, z, y: standHeight(x, z), h: 3.5 + rng() * 4.5, tone: rng.int(0, 2) });
  }
  const treeTones = [['#304a27', '#26391f'], ['#3b5a2e', '#304a27'], ['#466b35', '#3b5a2e']];
  const crownGeo = new THREE.ConeGeometry(1, 1, 7);
  crownGeo.translate(0, 0.5, 0);
  const trunkGeo = new THREE.BoxGeometry(0.3, 1, 0.3);
  trunkGeo.translate(0, 0.5, 0);
  const crowns = new THREE.InstancedMesh(crownGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true }), trees.length * 2);
  const trunks = new THREE.InstancedMesh(trunkGeo, mats.woodDark, trees.length);
  trees.forEach((t, i) => {
    const w = t.h * 0.34;
    trunks.setMatrixAt(i, m4.compose(new THREE.Vector3(t.x, t.y, t.z), q4.identity(), new THREE.Vector3(1, t.h * 0.3, 1)));
    crowns.setMatrixAt(i * 2, m4.compose(new THREE.Vector3(t.x, t.y + t.h * 0.22, t.z), q4.identity(), new THREE.Vector3(w, t.h * 0.55, w)));
    crowns.setMatrixAt(i * 2 + 1, m4.compose(new THREE.Vector3(t.x, t.y + t.h * 0.5, t.z), q4.identity(), new THREE.Vector3(w * 0.72, t.h * 0.5, w * 0.72)));
    crowns.setColorAt(i * 2, lin(treeTones[t.tone][1]));
    crowns.setColorAt(i * 2 + 1, lin(treeTones[t.tone][0]));
  });
  g.add(crowns, trunks);

  // ---------------------------------------------------------------- hills and mountains
  /** A jagged ridge ring: radius r, heights from `hgt(u)`, tones [lit, shade, snowLit, snowShade]. */
  function ridge(r, base, hgt, tones, snowAt = Infinity) {
    const s = soup();
    const n = 120;
    const pk = [];
    for (let i = 0; i <= n; i++) {
      const th = (i / n) * Math.PI * 2;
      const h = hgt(i / n, i);
      const rr = r + (rng() - 0.5) * r * 0.08;
      pk.push([OVAL.cx + rr * Math.cos(th), base + h, rr * Math.sin(th) * 0.92]);
    }
    pk[n] = pk[0];
    const [lit, shade, snowLit, snowShade] = tones.map(lin);
    for (let i = 0; i < n; i++) {
      const a = pk[i];
      const b = pk[i + 1];
      // Each span: two faces down from the peaks to the foot, toward and away from the middle.
      const mid = [(a[0] + b[0]) / 2, base + Math.min(a[1], b[1]) - base - 0.3 * Math.abs(a[1] - b[1]), (a[2] + b[2]) / 2];
      const out = (p, k) => [OVAL.cx + (p[0] - OVAL.cx) * k, base - 2, p[2] * k];
      const faces = [
        [out(a, 0.9), a, mid],
        [out(a, 0.9), mid, out(b, 0.9)],
        [mid, b, out(b, 0.9)],
      ];
      for (const [p, q, w] of faces) {
        const lt = faceLit(p, q, w);
        const top = Math.max(p[1], q[1], w[1]);
        const snow = top > snowAt && Math.min(p[1], q[1], w[1]) > snowAt * 0.82;
        s.tri(p, q, w, snow ? (lt > 0.55 ? snowLit : snowShade) : lt > 0.55 ? lit : shade);
      }
    }
    const m = new THREE.Mesh(s.geometry(), new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, fog: false }));
    m.frustumCulled = false;
    g.add(m);
    return m;
  }
  const noise = (u, f, ph) => Math.sin(u * Math.PI * 2 * f + ph);
  // Far mountains, a higher range behind the striker (the broadcast camera's background).
  ridge(196, 6, (u, i) => {
    const behind = Math.max(0, Math.cos(u * Math.PI * 2 - Math.PI));
    return 22 + 30 * behind + 12 * noise(u, 7, 1.1) + 7 * noise(u, 17, 0.4) + (i % 2 ? 6 : -2) + 8 * rng();
  }, ['#8ca0c6', '#5770a6', '#ffffff', '#d3d7d6'], 46);
  // Nearer wooded hills.
  ridge(150, 8, (u, i) => 9 + 6 * noise(u, 5, 2.0) + 4 * noise(u, 13, 0.7) + (i % 2 ? 2 : 0) + 3 * rng(), ['#517b3c', '#3b5a2e', '#517b3c', '#3b5a2e']);

  // ---------------------------------------------------------------- the crowd's moments
  const cheers = [];
  let lifted = new Set();
  return {
    group: g,
    setSky,
    /** The fans near p stand and bounce from t0 for ~1.8 s. */
    cheer(p, t0) {
      if (cheers.some((c) => Math.abs(c.t0 - t0) < 0.05)) return;
      cheers.push({ x: p.x, z: p.z, t0 });
      if (cheers.length > 8) cheers.shift();
    },
    update(t) {
      const now = new Set();
      for (const c of cheers) {
        const u = t - c.t0;
        if (u < -0.05 || u > 2.2) continue;
        people.forEach((p, i) => {
          const d = Math.hypot(p.x - c.x, p.z - c.z);
          if (d > 9) return;
          const delay = d * 0.05;
          const k = Math.max(0, Math.min(1, (u - delay) / 0.25)) * Math.max(0, Math.min(1, (2.2 - u) / 0.4));
          if (k <= 0) return;
          const hop = Math.abs(Math.sin((u - delay) * 9 + p.phase)) * 0.16;
          seat(p, i, k * (0.3 + hop));
          now.add(i);
        });
      }
      for (const i of lifted) if (!now.has(i)) seat(people[i], i, 0);
      if (now.size || lifted.size) {
        bodies.instanceMatrix.needsUpdate = true;
        heads.instanceMatrix.needsUpdate = true;
      }
      lifted = now;
    },
    people,
  };
}

/** A few points of the near stands, for the diorama camera's fit. */
export const STADIUM_FIT = (() => {
  const pts = [];
  for (const [a, b] of SEATED) for (const th of [a, b]) pts.push(new THREE.Vector3(...ringPt(th, STANDS.wall[1], STANDS.wall[2])));
  return pts;
})();
