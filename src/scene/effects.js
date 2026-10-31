import * as THREE from 'three';
import { buildBall } from './kit.js';
import { contactShadow } from './detail.js';
import { BALL_R, hash, win } from '../config.js';
import { P } from '../core/materials.js';

/**
 * Event effects, every one a pure function of t:
 *   ball + 4-ghost trail + ground shadow (the shadow is what sells the bounce height)
 *   pitch dust at each bounce, a ball mark that stays and fades
 *   impact stars (hot core + short sparks) at the helmet and the edge
 *   dive dust where second slip lands
 * No Math.random: every puff direction comes from `hash`, so a frozen frame and a
 * played frame are identical.
 */
export function buildEffects(scene, mats) {
  const ball = buildBall(mats);
  ball.name = 'ball';
  scene.add(ball);
  const ballShadow = contactShadow(scene, 0, 0, 0, 0.32, 0.55);

  const trailMats = [0.75, 0.55, 0.38, 0.24].map(() => mats.ball);
  const trail = trailMats.map((m, i) => {
    const s = new THREE.Mesh(new THREE.SphereGeometry(BALL_R * (0.82 - i * 0.14), 8, 6), mats.ballTrail ?? mats.ball);
    s.castShadow = false;
    scene.add(s);
    return s;
  });

  // Dust puffs: small tan blobs (opaque, palette clay), grown and sunk rather
  // than faded, so they never become a translucent grey card.
  const dustGeo = new THREE.IcosahedronGeometry(1, 0);
  const pools = [];
  function dustPool(n, mat) {
    const list = [];
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(dustGeo, mat);
      m.castShadow = false;
      m.visible = false;
      scene.add(m);
      list.push(m);
    }
    pools.push(list);
    return list;
  }

  const sparkGeo = new THREE.BoxGeometry(1, 1, 1);
  function starPool(n) {
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), mats.lampOn);
    core.visible = false;
    scene.add(core);
    const sparks = [];
    for (let i = 0; i < n; i++) {
      const s = new THREE.Mesh(sparkGeo, i % 2 ? mats.boardYellow : mats.lampOn);
      s.visible = false;
      scene.add(s);
      sparks.push(s);
    }
    return { core, sparks };
  }

  const marks = [];
  function addMark(x, z) {
    const m = new THREE.Mesh(new THREE.CircleGeometry(0.11, 10), mats.ballMark);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.014, z);
    m.visible = false;
    scene.add(m);
    marks.push(m);
    return m;
  }

  /** A burst of dust at (x, z) starting at t0. */
  function drive(list, t, t0, x, y, z, opts = {}) {
    const dur = opts.dur ?? 0.55;
    const k = (t - t0) / dur;
    const on = k >= 0 && k < 1;
    list.forEach((m, i) => {
      m.visible = on;
      if (!on) return;
      const a = hash(i + (opts.seed ?? 0) * 13) * Math.PI * 2;
      const sp = (opts.spread ?? 0.45) * (0.5 + hash(i * 3.1 + 1) * 0.7);
      const e = 1 - (1 - k) ** 2.2;
      const dirX = Math.cos(a) + (opts.bias?.[0] ?? 0);
      const dirZ = Math.sin(a) + (opts.bias?.[1] ?? 0);
      m.position.set(x + dirX * sp * e, y + (opts.rise ?? 0.25) * e * (0.6 + hash(i + 7) * 0.8) - k * k * 0.15, z + dirZ * sp * e);
      const r = (opts.size ?? 0.06) * (0.6 + hash(i + 2) * 0.6) * (k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3);
      m.scale.setScalar(Math.max(0.001, r));
    });
  }

  function star(st, t, t0, p, opts = {}) {
    const dur = opts.dur ?? 0.16;
    const k = (t - t0) / dur;
    const on = k >= 0 && k < 1;
    st.core.visible = on;
    st.sparks.forEach((s) => (s.visible = on));
    if (!on) return;
    const size = opts.size ?? 0.12;
    st.core.position.copy(p);
    st.core.scale.setScalar(size * (1 - k * 0.6));
    st.sparks.forEach((s, i) => {
      const a = (i / st.sparks.length) * Math.PI * 2 + hash(i + 3) * 0.3;
      const b = (hash(i + 11) - 0.5) * 1.2;
      const dir = new THREE.Vector3(Math.cos(a) * Math.cos(b), Math.sin(b) + 0.2, Math.sin(a) * Math.cos(b)).normalize();
      const len = size * (1.6 + hash(i + 5)) * (0.6 + k * 0.8);
      s.position.copy(p).addScaledVector(dir, size * 0.8 + len * 0.5 + k * size * 1.2);
      s.scale.set(0.035, 0.035, len);
      s.lookAt(p);
    });
  }

  return {
    dustMat: mats.pitchWorn,
    flashColour: P('#e2675c'),
    maroonColour: P('#741c26'),
    ball,
    ballShadow,
    trail,
    dustPool,
    starPool,
    addMark,
    drive,
    star,
    win,
  };
}
