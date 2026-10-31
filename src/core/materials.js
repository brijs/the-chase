import * as THREE from 'three';
import { PALETTE_HEX } from './palette.js';

/**
 * Every material in the scene, and nothing else creates one with a colour
 * literal. `P(hex)` throws for a colour that is not a palette entry, so a stray
 * tint fails at load instead of appearing as an "unlisted colour" on screen.
 */
export const timeUniform = { value: 0 };

const PAL = new Set(PALETTE_HEX);
export function P(hex) {
  const h = hex.toLowerCase();
  if (!PAL.has(h)) throw new Error(`colour ${h} is not in the palette`);
  return new THREE.Color(h);
}

const std = (hex, opts = {}) =>
  new THREE.MeshStandardMaterial({
    color: P(hex),
    roughness: opts.roughness ?? 0.9,
    metalness: opts.metalness ?? 0,
    emissive: opts.emissive ? P(opts.emissive) : new THREE.Color(0),
    emissiveIntensity: opts.emissiveIntensity ?? 0,
    side: opts.side ?? THREE.FrontSide,
  });

export function createMaterials() {
  const m = {
    // ground
    slabEdge: std('#58625f'),
    slabSide: std('#3b4340'),
    grassA: std('#69994b'),
    grassB: std('#5c8a43'),
    grassEdge: std('#517b3c'),
    pitch: std('#d8c592'),
    pitchWorn: std('#c9b27c'),
    pitchScuff: std('#9b8353'),
    footmark: std('#7f6a44'),
    crease: std('#f6f2e6'),
    ballMark: std('#741c26'),
    // kit
    whites: std('#ebe4d0'),
    whitesShade: std('#c9bfa4'),
    jumper: std('#dcd3ba'),
    jumperBand: std('#283a63'),
    maroon: std('#741c26'),
    maroonDark: std('#4f1219'),
    navy: std('#283a63'),
    navyDark: std('#1c2847'),
    padWhite: std('#f6f2e6'),
    padStrap: std('#b0a68a'),
    glove: std('#f6f2e6'),
    gloveKeeper: std('#ebe4d0'),
    gloveWeb: std('#9a2731'),
    grille: std('#a9b0b1', { roughness: 0.5, metalness: 0.3 }),
    zinc: std('#ffffff'),
    towel: std('#f6f2e6'),
    sweatband: std('#3a5185'),
    umpireShirt: std('#1c2847'),
    umpireTrousers: std('#b0a68a'),
    umpireHat: std('#f6f2e6'),
    // bat, ball, stumps
    willow: std('#f1dfb2'),
    willowEdge: std('#dbbf88'),
    grip: std('#262d2b'),
    batSticker: std('#9a2731'),
    ball: std('#c13a3c', { roughness: 0.45 }),
    ballTrail: new THREE.MeshBasicMaterial({ color: P('#e2675c') }),
    ballSeam: std('#f6f2e6'),
    stump: std('#f6f2e6'),
    stumpBand: std('#283a63'),
    bail: std('#dbbf88'),
    // roller, kit crate, boards, scoreboard
    roller: std('#2f8f86', { roughness: 0.7 }),
    rollerDark: std('#3b4340', { roughness: 0.6, metalness: 0.2 }),
    steel: std('#7d8789', { roughness: 0.55, metalness: 0.35 }),
    rust: std('#7f6a44'),
    rag: std('#c13a3c'),
    wood: std('#b99760'),
    woodDark: std('#7c5d39'),
    boardBlue: std('#3a83c6'),
    boardNavy: std('#283a63'),
    boardYellow: std('#f3c94a'),
    boardOrange: std('#e5843a'),
    boardText: std('#f6f2e6'),
    boardGreen: std('#1d2c25'),
    amber: std('#f3c94a', { emissive: '#e39a2e', emissiveIntensity: 0.6 }),
    amberDim: std('#58625f'),
    lampOn: std('#fff1b8', { emissive: '#fff1b8', emissiveIntensity: 1.0 }),
    flagA: std('#e5843a', { side: THREE.DoubleSide }),
    flagB: std('#7dbbe3', { side: THREE.DoubleSide }),
    bottle: std('#7dbbe3', { roughness: 0.3 }),
    crate: std('#3a83c6'),
    disc: std('#f3c94a'),
    // rig keys expected by peopleModel-street.js
    leather: std('#41332a'),
    steelDark: std('#3b4340'),
    ink: std('#171a18'),
    eye: std('#171a18'),
    mouth: std('#a06d48'),
    bone: std('#f6f2e6'),
    paper: std('#f6f2e6'),
    chrome: std('#d3d7d6'),
    glass: std('#3b4340'),
    shoe: std('#f6f2e6'),
    sole: std('#9b8353'),
  };
  m.skinTones = ['#f0cfae', '#dcae86', '#c48f66', '#a06d48', '#704831'].map((h) => std(h, { roughness: 0.8 }));
  m.hair = ['#2a211c', '#41332a', '#5a4737', '#171a18'].map((h) => std(h));
  m.cloth = { navy: m.navy, charcoal: m.whitesShade, tealDeep: m.maroon, rust: m.maroon, coral: m.whites };
  return m;
}
