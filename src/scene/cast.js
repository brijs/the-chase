import * as THREE from 'three';
import { buildPerson, setPose } from './peopleModel-street.js';
import { contactShadow } from './detail.js';
import {
  addHelmet,
  addPads,
  addBattingGloves,
  addKeeperGloves,
  addCap,
  addUmpireHat,
  addBowlerKit,
  buildBat,
} from './kit.js';
import { reachArm } from './ik.js';

/**
 * An actor is a rig inside two groups: `outer` (position + yaw) and `roll` (a
 * pivot at hip height that rolls the body about its own forward axis, for the
 * dive). `apply(state)` is the only way the stage moves anyone, so every frame
 * is a pure function of the state the stage computed for `t`.
 *
 * Grounding: after the pose is set, the lowest joint (sole, knee, hip, shoulder,
 * head, each with its own radius) is put on the deck, so a crouch or a kneel never
 * floats or sinks. `state.lift` adds an authored airborne height on top of that.
 */
const RADII = {
  ankleL: 0.035,
  ankleR: 0.035,
  kneeL: 0.07,
  kneeR: 0.07,
  hipL: 0.09,
  hipR: 0.09,
  pelvis: 0.16,
  shoulderL: 0.08,
  shoulderR: 0.08,
  elbowL: 0.05,
  elbowR: 0.05,
  wristL: 0.05,
  wristR: 0.05,
  head: 0.13,
};

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _face = new THREE.Vector3();
const _x = new THREE.Vector3();
const _m = new THREE.Matrix4();
const POLE_L = new THREE.Vector3(-0.5, -1, -0.3);
const POLE_R = new THREE.Vector3(0.5, -1, -0.3);

export class Actor {
  constructor(name, person, scene, opts = {}) {
    this.name = name;
    this.person = person;
    this.joints = person.joints;
    this.outer = new THREE.Group();
    this.outer.name = name;
    this.roll = new THREE.Group();
    this.roll.position.y = 0.9;
    person.group.position.y = -0.9;
    this.roll.add(person.group);
    this.outer.add(this.roll);
    scene.add(this.outer);
    this.shadow = contactShadow(scene, 0, 0, 0, opts.shadowSize ?? 0.95, 0.6);
    this.shadow.name = name + '-shadow';
    this.bat = null;
    this.helmet = null;
    this.residual = 0;
  }

  palm(side, out = new THREE.Vector3()) {
    const w = this.joints['wrist' + side];
    return w.localToWorld(out.set(0, -0.06, 0.02));
  }

  /**
   * state: { x, z, yaw, pose, lift, roll, visible, bat: {dir, face} | null,
   *          ik: true to IK the bottom hand onto the handle, shadowScale }
   */
  apply(s) {
    const visible = s.visible !== false;
    this.outer.visible = visible;
    this.shadow.visible = visible;
    if (!visible) {
      if (this.bat) this.bat.visible = false;
      return;
    }
    this.outer.position.set(s.x, 0, s.z);
    this.outer.rotation.set(0, s.yaw ?? 0, 0);
    this.roll.rotation.set(0, 0, s.roll ?? 0);
    this.person.group.position.y = -0.9;
    setPose(this.person, s.pose);
    this.outer.updateMatrixWorld(true);

    let minY = Infinity;
    for (const k in RADII) {
      const j = this.joints[k];
      if (!j) continue;
      j.getWorldPosition(_v);
      const y = _v.y - RADII[k];
      if (y < minY) minY = y;
    }
    const lift = s.lift ?? 0;
    this.outer.position.y = -minY + lift + 0.004;
    this.outer.updateMatrixWorld(true);

    if (this.bat) this.placeBat(s);

    // Contact shadow: under the pelvis, stretched along a lying body.
    this.joints.pelvis.getWorldPosition(_v);
    const air = Math.max(0, lift);
    const sc = (s.shadowScale ?? 1) * (1 - Math.min(0.45, air * 0.5));
    this.shadow.position.set(_v.x, 0.018, _v.z);
    this.shadow.scale.set(sc * (1 + Math.abs(s.roll ?? 0) * 0.9), sc, 1);
    this.shadow.rotation.set(-Math.PI / 2, 0, (s.yaw ?? 0) + Math.PI / 2);
    this.shadow.material.opacity = 0.6 * (1 - Math.min(0.6, air * 0.7));
  }

  /** Top palm sets the position; the pose's dir/face set the orientation (root-local). */
  placeBat(s) {
    const b = s.bat;
    if (!b) {
      this.bat.visible = false;
      return;
    }
    this.bat.visible = true;
    const top = this.palm('R', _w);
    _dir.set(b.dir[0], b.dir[1], b.dir[2]).normalize().transformDirection(this.outer.matrixWorld);
    _face.set(b.face[0], b.face[1], b.face[2]).transformDirection(this.outer.matrixWorld);
    _face.addScaledVector(_dir, -_face.dot(_dir)).normalize();
    // Bat local: -Y along the blade, +Z the face.
    _x.crossVectors(_dir, _face).negate(); // x = y × z with y = -dir
    _m.makeBasis(_x, _v.copy(_dir).negate(), _face);
    this.bat.quaternion.setFromRotationMatrix(_m);
    // The palm sits 0.06 down the handle, not at its top.
    this.bat.position.copy(top).addScaledVector(_dir, -0.06);
    this.bat.updateMatrixWorld(true);
    if (s.ik) {
      const target = _v.copy(top).addScaledVector(_dir, 0.11);
      this.residual = reachArm(this.person, 'L', target, POLE_L);
      this.outer.updateMatrixWorld(true);
    } else {
      this.residual = 0;
    }
  }

  /** Distance from the bottom palm to the bat axis (the carry contact log). */
  gripGap() {
    if (!this.bat || !this.bat.visible) return 0;
    const p = this.palm('L', new THREE.Vector3());
    const a = new THREE.Vector3(0, 0, 0).applyMatrix4(this.bat.matrixWorld);
    const d = new THREE.Vector3(0, -1, 0).transformDirection(this.bat.matrixWorld);
    const ap = p.clone().sub(a);
    return ap.sub(d.multiplyScalar(ap.dot(d))).length();
  }
}

export { POLE_R };

/**
 * Build the eight-person cast. Skin and hair vary per role; kits follow the teams.
 * opts.fielders adds that many more capped fielders, f1..fN (the game's full XI).
 */
export function buildCast(scene, mats, opts = {}) {
  const skin = mats.skinTones;
  const hair = mats.hair;
  const whitesOpts = {
    top: mats.whites,
    bottom: mats.whites,
    shoe: mats.shoe,
    sleeve: 'long',
  };

  const mk = (name, opts, extra) => {
    const p = buildPerson(mats, { ...whitesOpts, ...opts });
    const a = new Actor(name, p, scene);
    extra?.(a, p);
    return a;
  };
  const batter = (name, skinI, hairI) =>
    mk(name, { skin: skin[skinI], hair: hair[hairI], hairStyle: 'buzz', glove: mats.glove }, (a, p) => {
      a.helmet = addHelmet(p, mats);
      addPads(p, mats);
      addBattingGloves(p, mats);
      a.bat = buildBat(mats);
      scene.add(a.bat);
    });

  const cast = {
    bowler: mk('bowler', { skin: skin[1], hair: hair[0], hairStyle: 'short', sleeve: 'short' }, (a, p) =>
      addBowlerKit(p, mats)
    ),
    batterA: batter('batterA', 2, 0),
    batterB: batter('batterB', 2, 0),
    nonStriker: batter('nonStriker', 3, 1),
    keeper: mk('keeper', { skin: skin[0], hair: hair[2], hairStyle: 'buzz', hatType: 'x' }, (a, p) => {
      addCap(p, mats, mats.navy);
      addKeeperGloves(p, mats);
      addPads(p, mats);
    }),
    slip1: mk('slip1', { skin: skin[2], hair: hair[1], hairStyle: 'buzz' }, (a, p) => addCap(p, mats, mats.navy)),
    slip2: mk('slip2', { skin: skin[4], hair: hair[0], hairStyle: 'buzz', top: mats.jumper }, (a, p) => {
      addCap(p, mats, mats.navy);
      // V-neck band of the cricket jumper.
      const t = p.joints.torso;
      for (const s of [-1, 1]) {
        const band = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.16, 0.012), mats.jumperBand);
        band.position.set(s * 0.04, 0.45, 0.135);
        band.rotation.set(0.3, 0, s * 0.45);
        t.add(band);
      }
    }),
    umpire: mk(
      'umpire',
      {
        skin: skin[3],
        hair: hair[3],
        hairStyle: 'buzz',
        hatType: 'x',
        top: mats.umpireShirt,
        bottom: mats.umpireTrousers,
        shoe: mats.leather,
      },
      (a, p) => addUmpireHat(p, mats)
    ),
  };
  for (let i = 1; i <= (opts.fielders ?? 0); i++) {
    const top = i % 3 === 0 ? mats.jumper : mats.whites;
    cast['f' + i] = mk('f' + i, { skin: skin[(i * 3 + 1) % skin.length], hair: hair[i % hair.length], hairStyle: i % 2 ? 'buzz' : 'short', top, sleeve: i % 4 === 1 ? 'short' : 'long' }, (a, p) =>
      addCap(p, mats, mats.navy)
    );
  }
  return cast;
}
