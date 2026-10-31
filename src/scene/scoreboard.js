import * as THREE from 'three';
import { roundedBoxGeometry } from '../core/geometry.js';
import { contactShadow } from './detail.js';
import { win } from '../config.js';

/**
 * The landmark: a speed-gun scoreboard on two legs, at the back edge. Machine
 * grammar per delivery: engage (lamp blinks), work (two panels flip about their
 * horizontal axis), output (new km/h and verdict), settle. Each state's text is
 * baked to a canvas once; the flip swaps texture at mid-turn. The board states are
 * chosen so the loop seam needs no reset: the state shown at t = 0 is the report
 * of the last ball, which is exactly what the board shows at t = 46.
 */
export const BOARD_STATES = [
  { ball: 'BALL 4', kph: '142', note: 'BEATEN' },
  { ball: 'BALL 5', kph: '151', note: 'BOUNCER' },
  { ball: 'BALL 6', kph: '147', note: 'OUT  c SLIP' },
];

const AMBER = '#f3c94a';
const DIM = '#e39a2e';
const BOARD = '#1d2c25';
const CREAM = '#f6f2e6';

function panelTexture(lines, w = 256, h = 96) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const x = c.getContext('2d');
  x.fillStyle = BOARD;
  x.fillRect(0, 0, w, h);
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  for (const l of lines) {
    x.fillStyle = l.colour;
    x.font = `bold ${l.size}px ui-monospace, Menlo, monospace`;
    x.fillText(l.text, w / 2, l.y);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.LinearFilter;
  return t;
}

const box = (p, w, h, d, mat, x, y, z, o = {}) => {
  const m = new THREE.Mesh(roundedBoxGeometry(w, h, d, Math.min(o.r ?? 0.02, Math.min(w, h, d) * 0.45), 2), mat);
  m.position.set(x, y, z);
  if (o.rotation) m.rotation.set(...o.rotation);
  m.castShadow = o.castShadow ?? true;
  m.receiveShadow = true;
  p.add(m);
  return m;
};

export function buildScoreboard(scene, mats, x, z, events) {
  const g = new THREE.Group();
  g.name = 'scoreboard';
  g.position.set(x, 0, z);
  g.rotation.y = 0.18;
  scene.add(g);

  // Footings, two legs, cross braces, a ladder to the cabinet.
  for (const lx of [-1.5, 1.5]) {
    box(g, 0.4, 0.12, 0.4, mats.steel, lx, 0.06, 0);
    box(g, 0.16, 2.0, 0.16, mats.woodDark, lx, 1.06, 0);
  }
  for (const s of [-1, 1]) {
    box(g, 3.3, 0.08, 0.06, mats.woodDark, 0, 1.0, s * 0.02 - 0.06, { rotation: [0, 0, s * 0.5] });
  }
  for (const s of [-0.3, 0.3]) box(g, 0.05, 1.95, 0.05, mats.steel, 2.0 + s, 1.0, 0.1, { rotation: [0, 0, -0.12] });
  for (let k = 0; k < 6; k++) box(g, 0.62, 0.04, 0.04, mats.steel, 2.0 - k * 0.025, 0.25 + k * 0.31, 0.1, { castShadow: false });

  // Cabinet: frame, dark board, roof with an overhang.
  box(g, 4.1, 2.25, 0.5, mats.woodDark, 0, 3.15, -0.05, { r: 0.04 });
  box(g, 3.86, 2.02, 0.06, mats.boardGreen, 0, 3.15, 0.21);
  box(g, 4.5, 0.12, 0.85, mats.whites, 0, 4.33, 0.05, { r: 0.03 });
  box(g, 4.3, 0.1, 0.06, mats.boardNavy, 0, 4.24, 0.47, { castShadow: false });
  // Sponsor plate under the board, weathered (a lighter patch where paint went).
  box(g, 3.0, 0.32, 0.05, mats.boardBlue, 0, 1.86, 0.08, { r: 0.02 });
  box(g, 1.8, 0.1, 0.02, mats.boardText, 0, 1.88, 0.115, { castShadow: false });
  box(g, 0.35, 0.18, 0.02, mats.whitesShade, 1.1, 1.82, 0.115, { castShadow: false });

  // Two flip panels: top = ball + km/h, bottom = verdict.
  const texTop = BOARD_STATES.map((s) =>
    panelTexture([
      { text: s.ball, size: 22, y: 18, colour: CREAM },
      { text: `${s.kph} KM/H`, size: 44, y: 62, colour: AMBER },
    ])
  );
  const texBot = BOARD_STATES.map((s) =>
    panelTexture([{ text: s.note, size: 34, y: 48, colour: s.note.startsWith('OUT') ? AMBER : DIM }], 256, 96)
  );
  const mkPanel = (y, h, tex) => {
    const pivot = new THREE.Group();
    pivot.position.set(0, y, 0.26);
    g.add(pivot);
    const mat = new THREE.MeshBasicMaterial({ map: tex[0], toneMapped: false, side: THREE.DoubleSide });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(3.5, h), mat);
    pivot.add(m);
    return { pivot, mat, tex };
  };
  const top = mkPanel(3.55, 1.05, texTop);
  const bot = mkPanel(2.55, 0.62, texBot);

  // Lamp on the roof: an object, not a glow.
  box(g, 0.2, 0.12, 0.2, mats.steelDark, -1.7, 4.45, 0.2);
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), mats.amberDim);
  lamp.position.set(-1.7, 4.58, 0.2);
  g.add(lamp);

  // Two pennants on poles: the ambient loop.
  const flags = [];
  for (const [fx, mat, period, phase] of [
    [-1.9, mats.flagA, 1.7, 0],
    [1.9, mats.flagB, 2.3, 1.9],
  ]) {
    box(g, 0.05, 1.1, 0.05, mats.steel, fx, 4.9, 0.0);
    const segs = [];
    let parent = g;
    let px = fx + 0.03;
    for (let k = 0; k < 3; k++) {
      const s = new THREE.Group();
      s.position.set(k === 0 ? px : 0.2, k === 0 ? 5.3 : 0, 0);
      parent.add(s);
      const w = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.32 - k * 0.07), mat);
      w.position.x = 0.1;
      w.castShadow = true;
      s.add(w);
      segs.push(s);
      parent = s;
    }
    flags.push({ segs, period, phase });
  }
  contactShadow(g, 0, 0, 0, 4.0, 0.4);

  if (events === 'dynamic') return dynamicBoard(g, top, bot, lamp, flags, mats);

  const flipAt = events; // [{ t, state }] in domain time
  function stateAt(t) {
    // Before the first flip the board shows the last state of the previous lap.
    let s = BOARD_STATES.length - 1;
    let since = Infinity;
    for (const e of flipAt) {
      if (t >= e.t) {
        s = e.state;
        since = t - e.t;
      }
    }
    return { s, since };
  }

  function update(t) {
    for (const f of flags) {
      for (let k = 0; k < f.segs.length; k++) {
        f.segs[k].rotation.y = Math.sin((t / f.period) * Math.PI * 2 + f.phase - k * 0.9) * (0.18 + k * 0.08);
      }
    }
    // Engage 0.5 s of lamp before each flip; flip lasts 0.4 s, bottom panel 0.12 s later.
    let lampOn = false;
    for (const e of flipAt) if (t > e.t - 0.5 && t < e.t + 0.2 && Math.floor((t - e.t) * 8) % 2 === 0) lampOn = true;
    lamp.material = lampOn ? mats.lampOn : mats.amberDim;
    const { s, since } = stateAt(t);
    const prev = (s + BOARD_STATES.length - 1) % BOARD_STATES.length;
    for (const [panel, delay] of [
      [top, 0],
      [bot, 0.12],
    ]) {
      const u = win(since, delay, delay + 0.4);
      const flipping = since >= delay && since < delay + 0.4;
      panel.pivot.rotation.x = flipping ? Math.PI * u : 0;
      // First half shows the old face, second half the new one (seen from behind, mirrored back).
      const showNew = !flipping || u >= 0.5;
      panel.mat.map = panel.tex[showNew ? s : prev];
      panel.pivot.scale.y = flipping && u >= 0.5 ? -1 : 1;
    }
  }
  return { group: g, update, stateAt };
}

/**
 * The game's board: the same engage -> flip -> settle machine, but the faces are
 * drawn on demand. show(lines, verdict, t) bakes the new faces and starts a flip
 * at t; update(t) animates it. Times are the game clock.
 */
function dynamicBoard(g, top, bot, lamp, flags, mats) {
  const face = (lines, verdict) => [
    panelTexture([
      { text: lines[0], size: 22, y: 18, colour: CREAM },
      { text: lines[1], size: 40, y: 62, colour: AMBER },
    ]),
    panelTexture([{ text: verdict, size: verdict.length > 13 ? 26 : 34, y: 48, colour: /OUT|SIX|FOUR|WON/.test(verdict) ? AMBER : DIM }], 256, 96),
  ];
  let cur = face(['THE CHASE', '-'], '');
  let prev = cur;
  let flipT = -Infinity;
  top.mat.map = cur[0];
  bot.mat.map = cur[1];
  function show(lines, verdict, t) {
    for (const tex of prev) if (tex !== cur[0] && tex !== cur[1]) tex.dispose();
    prev = cur;
    cur = face(lines, verdict);
    flipT = t + 0.5; // 0.5 s of lamp first
  }
  function update(t) {
    for (const f of flags) {
      for (let k = 0; k < f.segs.length; k++) {
        f.segs[k].rotation.y = Math.sin((t / f.period) * Math.PI * 2 + f.phase - k * 0.9) * (0.18 + k * 0.08);
      }
    }
    const since = t - flipT;
    lamp.material = since > -0.5 && since < 0.2 && Math.floor(since * 8) % 2 === 0 ? mats.lampOn : mats.amberDim;
    [[top, 0, 0], [bot, 0.12, 1]].forEach(([panel, delay, i]) => {
      const u = win(since, delay, delay + 0.4);
      const flipping = since >= delay && since < delay + 0.4;
      panel.pivot.rotation.x = flipping ? Math.PI * u : 0;
      const showNew = since >= delay + 0.2;
      panel.mat.map = (showNew ? cur : prev)[i];
      panel.pivot.scale.y = flipping && u >= 0.5 ? -1 : 1;
    });
  }
  return { group: g, update, show };
}
