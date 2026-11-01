import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/**
 * Action replays of the last ball (R, or the controller's replay button).
 *
 * The whole field is a function of game time (every actor's plan, the ball's
 * plan, bails, dust), so a replay just freezes the live game and renders past
 * times on its own clock. Scrub anywhere, step frames, change speed; slow motion
 * eases in around the contact and around the take (catch, stop or rope).
 *
 * Views (C cycles); the first three are pure functions of replay time, so
 * scrubbing back gives the identical shot:
 *   ball       front-on like the broadcast: from behind the bowler for the
 *              delivery, then running ahead of the ball looking back at it (the
 *              ball comes at you, the striker and the field behind it)
 *   side       square of the pitch on the off side, panning and zooming with the ball
 *   broadcast  the TV angle from behind the bowler, craning after the ball
 *   free       yours: drag to rotate, scroll / pinch to zoom, right-drag to pan
 *              (dragging on the field from any view switches to it); "Follow
 *              ball" keeps the ball at the centre as it moves. Controller: right
 *              stick orbits, D-pad up / down zooms.
 *
 * No motion trail in slow motion: the ball is sharp frame by frame.
 *
 * Review (V) runs the third umpire's views on the ball (ball tracking,
 * UltraEdge) as an analysis: not a challenge, nothing changes.
 *
 * Keys in replay: Space play/pause · ← → step (hold to scrub) · [ ] speed ·
 * S slow motion on/off · C view · V review · Home restart · R or Esc back to the game.
 * Controller: Confirm play/pause, Back exit, direction left/right scrubs.
 */
const CSS = `
#replay { position: absolute; left: 50%; bottom: 12px; transform: translateX(-50%); width: min(760px, calc(100vw - 20px)); padding: 7px 10px; display: none; pointer-events: auto; font-size: 12px; z-index: 6; }
#replay.on { display: block; }
#replay .row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
#replay button { font: inherit; color: inherit; background: #ebe4d0; border: 1px solid #c9bfa4; border-radius: 5px; padding: 3px 8px; cursor: pointer; min-width: 30px; }
#replay button.on { background: #283a63; border-color: #283a63; color: #f6f2e6; }
#replay input[type=range] { flex: 1; min-width: 160px; accent-color: #9a2731; }
#replay .t { min-width: 5.5em; text-align: right; font-variant-numeric: tabular-nums; }
#replay .marks { position: relative; height: 8px; margin: 0 2px 2px; }
#replay .marks i { position: absolute; top: 0; width: 2px; height: 8px; background: #9a2731; }
#replay .marks i.r { background: #283a63; }
#replay .marks i.e { background: #2f8f86; }
#replay-badge { position: absolute; left: 12px; top: 12px; padding: 6px 12px; font: bold 16px/1 ui-monospace, Menlo, monospace; letter-spacing: 0.12em; color: #9a2731; display: none; z-index: 6; }
#replay-badge.on { display: block; }
#replay-badge small { display: block; font-size: 10.5px; letter-spacing: 0.04em; color: #6f6a55; margin-top: 3px; font-weight: normal; }
`;
const VIEWS = [['ball', 'Ball cam'], ['side', 'Side-on'], ['broadcast', 'Broadcast'], ['free', 'Free']];
const SPEEDS = [0.1, 0.25, 0.5, 1];
const STRIKER = new THREE.Vector3(-7.75, 0, -0.32);

export function createReplay({ ctl, camera, canvas, root, aspect, pad, onReview = null }) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const bar = document.createElement('div');
  bar.id = 'replay';
  bar.className = 'panel';
  const badge = document.createElement('div');
  badge.id = 'replay-badge';
  badge.className = 'panel';
  root.appendChild(bar);
  root.appendChild(badge);

  let last = null; // the last ball: { tR, tC, tTake, end, call }
  const R = { active: false, t: 0, t0: 0, t1: 0, playing: true, speed: 1, slowmo: true, view: 'ball', prevPhase: null, follow: true };

  // Free camera: orbit controls, live only in a replay's free view.
  const orbit = new OrbitControls(camera, canvas);
  orbit.enabled = false;
  orbit.enableDamping = true;
  orbit.dampingFactor = 0.12;
  orbit.screenSpacePanning = false;
  orbit.minDistance = 1.5;
  orbit.maxDistance = 90;
  orbit.maxPolarAngle = Math.PI / 2 - 0.03; // never under the grass
  let lastTarget = new THREE.Vector3();
  let lastBall = null;
  /** Switch to the free view from wherever the camera is now. */
  function goFree() {
    if (R.view === 'free') return;
    R.view = 'free';
    orbit.target.copy(lastTarget);
    orbit.update();
    lastBall = null;
    draw();
  }
  canvas.addEventListener('pointerdown', () => R.active && R.view !== 'free' && goFree(), { capture: true });
  canvas.addEventListener('wheel', () => R.active && R.view !== 'free' && goFree(), { capture: true, passive: true });
  let held = { L: false, R: false };

  /** Called on every outcome: remember the last ball for a replay. */
  function record({ o, tCall }) {
    const c = ctl.cur;
    const tC = c.tContact ?? null;
    const f = o.fielding;
    const tTake = tC != null && f ? tC + (f.type === 'boundary' ? Math.min(o.sim?.tRope ?? f.t, f.t) : f.t) : c.tR + (c.del.tKeeper ?? 0.9);
    const end = tC != null && f ? tC + Math.min(5.5, Math.max(2.4, (f.type === 'boundary' ? Math.min(o.sim.tStop, 4) : f.t) + 1.4)) : c.tR + 2.6;
    last = { o, cur: c, tR: c.tR, tC, tTake, end, call: o.call, contact: o.contactPos ? new THREE.Vector3(o.contactPos.x, o.contactPos.y, o.contactPos.z) : null };
  }
  const available = () => !!last && ctl.t - last.end < 25 && ctl.t > last.tR + 0.8;

  function start() {
    if (!available() || R.active) return false;
    R.active = true;
    R.prevPhase = ctl.phase;
    ctl.phase = 'replay';
    R.t0 = last.tR - 2.0;
    R.t1 = Math.min(last.end, ctl.t);
    R.t = R.t0;
    R.playing = true;
    R.speed = 1;
    bar.classList.add('on');
    badge.classList.add('on');
    orbit.enabled = true;
    if (R.view === 'free') R.view = 'ball';
    draw();
    return true;
  }
  /** The third umpire's views on this ball; the replay waits underneath. */
  function review() {
    if (!R.active || R.reviewing || !onReview) return;
    R.playing = false;
    R.reviewing = true;
    bar.classList.remove('on');
    badge.classList.remove('on');
    const ok = onReview(last.o, last.cur, () => {
      R.reviewing = false;
      if (!R.active) return;
      bar.classList.add('on');
      badge.classList.add('on');
      draw();
    });
    if (!ok) {
      R.reviewing = false;
      bar.classList.add('on');
      badge.classList.add('on');
    }
  }
  function stop() {
    if (!R.active) return;
    R.active = false;
    orbit.enabled = false;
    ctl.phase = R.prevPhase === 'replay' ? 'live' : R.prevPhase;
    bar.classList.remove('on');
    badge.classList.remove('on');
  }

  function draw() {
    const span = R.t1 - R.t0;
    const pc = (t) => `${(((t - R.t0) / span) * 100).toFixed(1)}%`;
    bar.innerHTML = `<div class="marks">${[[last.tR, 'r', 'release'], [last.tC, '', 'contact'], [last.tTake, 'e', 'take']].filter(([t]) => t != null && t >= R.t0 && t <= R.t1).map(([t, c, n]) => `<i class="${c}" style="left:${pc(t)}" title="${n}"></i>`).join('')}</div>
      <div class="row">
        <button data-a="restart" title="Restart (Home)">⏮</button>
        <button data-a="back" title="Step back (←)">◀︎</button>
        <button data-a="play" title="Play / pause (Space)">${R.playing ? '❚❚' : '▶'}</button>
        <button data-a="fwd" title="Step forward (→)">▶︎</button>
        <input type="range" min="${R.t0}" max="${R.t1}" step="0.001" value="${R.t}" aria-label="Replay timeline">
        <span class="t"></span>
      </div>
      <div class="row" style="margin-top:5px">
        ${SPEEDS.map((s) => `<button data-speed="${s}" class="${R.speed === s ? 'on' : ''}">${s}×</button>`).join('')}
        <button data-a="slowmo" class="${R.slowmo ? 'on' : ''}" title="Slow motion around contact and the take (S)">auto slow-mo</button>
        <span style="width:8px"></span>
        ${VIEWS.map(([v, n]) => `<button data-view="${v}" class="${R.view === v ? 'on' : ''}">${n}</button>`).join('')}
        ${R.view === 'free' ? `<button data-a="follow" class="${R.follow ? 'on' : ''}" title="Keep the ball centred">Follow ball</button>` : ''}
        <span style="flex:1"></span>
        ${onReview ? '<button data-a="review" title="Ball tracking and UltraEdge on this ball (V): an analysis, not a challenge">🎯 Review (V)</button>' : ''}
        <button data-a="exit" title="Back to the game (R / Esc)">✕ Exit replay</button>
      </div>`;
    refresh();
  }
  function refresh() {
    const r = bar.querySelector('input[type=range]');
    if (r && document.activeElement !== r) r.value = R.t;
    const tt = bar.querySelector('.t');
    if (tt) tt.textContent = `${(R.t - (last.tC ?? last.tR)).toFixed(2)} s`;
    const pb = bar.querySelector('[data-a=play]');
    if (pb) pb.textContent = R.playing ? '❚❚' : '▶';
    badge.innerHTML = `REPLAY<small>${last.call} · ${VIEWS.find(([v]) => v === R.view)[1]} · ${rate().toFixed(2)}×</small>`;
  }

  bar.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    b.blur();
    if (b.dataset.speed) R.speed = +b.dataset.speed;
    else if (b.dataset.view) {
      if (b.dataset.view === 'free') goFree();
      else R.view = b.dataset.view;
    } else if (b.dataset.a === 'follow') R.follow = !R.follow;
    else if (b.dataset.a === 'play') R.playing = !R.playing;
    else if (b.dataset.a === 'restart') { R.t = R.t0; R.playing = true; }
    else if (b.dataset.a === 'back') step(-1);
    else if (b.dataset.a === 'fwd') step(1);
    else if (b.dataset.a === 'slowmo') R.slowmo = !R.slowmo;
    else if (b.dataset.a === 'exit') return stop();
    else if (b.dataset.a === 'review') return review();
    draw();
  });
  bar.addEventListener('input', (e) => {
    if (e.target.type !== 'range') return;
    R.t = +e.target.value;
    R.playing = false;
    refresh();
  });

  const step = (n) => {
    R.playing = false;
    R.t = Math.min(R.t1, Math.max(R.t0, R.t + n / 30));
  };
  // Keyboard while replaying (captured before the game's own keys).
  window.addEventListener(
    'keydown',
    (e) => {
      if (!R.active || R.reviewing || e.target instanceof HTMLInputElement) return;
      const k = e.key;
      let used = true;
      if (k === ' ') R.playing = !R.playing;
      else if (k === 'ArrowLeft') { held.L = true; step(-1); }
      else if (k === 'ArrowRight') { held.R = true; step(1); }
      else if (k === '[' || k === ']') R.speed = SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, SPEEDS.indexOf(R.speed) + (k === ']' ? 1 : -1)))];
      else if (k === 's' || k === 'S') R.slowmo = !R.slowmo;
      else if (k === 'c' || k === 'C') cycleView();
      else if (k === 'Home') { R.t = R.t0; R.playing = true; }
      else if (k === 'v' || k === 'V') return void (e.preventDefault(), e.stopImmediatePropagation(), review());
      else if (k === 'r' || k === 'R' || k === 'Escape') stop();
      else used = false;
      if (used) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (R.active) draw();
      }
    },
    { capture: true }
  );
  window.addEventListener('keyup', (e) => {
    if (e.key === 'ArrowLeft') held.L = false;
    if (e.key === 'ArrowRight') held.R = false;
  });

  function cycleView() {
    const next = VIEWS[(VIEWS.findIndex(([v]) => v === R.view) + 1) % VIEWS.length][0];
    if (next === 'free') goFree();
    else R.view = next;
  }

  /** Slow motion eases in around contact and the take. */
  function rate() {
    if (!R.slowmo) return R.speed;
    let k = 1;
    for (const tm of [last.tC, last.tTake]) {
      if (tm == null) continue;
      const d = Math.abs(R.t - tm);
      k = Math.min(k, 0.25 + 0.75 * Math.min(1, Math.max(0, (d - 0.15) / 0.5)));
    }
    return R.speed * k;
  }

  // ---------------------------------------------------------------- cameras
  const ballAt = (t) => ctl.ballPosAt(t);
  const v = new THREE.Vector3();
  function pose(t) {
    const b = ballAt(t) ?? last.contact ?? STRIKER.clone().setY(0.8);
    const tC = last.tC;
    const out = { pos: new THREE.Vector3(), target: new THREE.Vector3(), fov: 30 };
    if (R.view === 'side') {
      // From square on the off side, a little behind the striker's end; pans and zooms.
      out.pos.set(-1.5, 4.2, 21);
      out.target.copy(b).setY(Math.min(4, b.y * 0.7 + 0.5));
      const d = out.pos.distanceTo(out.target);
      out.fov = Math.max(6, Math.min(40, (2 * Math.atan(5 / d) * 180) / Math.PI));
      return out;
    }
    if (R.view === 'broadcast') {
      const toward = Math.max(0, b.x - STRIKER.x);
      out.pos.set(31 + Math.min(4, 0.15 * toward), 6.5 + 0.6 * toward, 0.6 + 0.3 * b.z);
      out.target.copy(b).setY(Math.min(6, b.y * 0.6 + 0.2));
      if (tC == null || t < tC) out.target.lerp(new THREE.Vector3(-4.5, 0.4, 0.1), 0.6);
      const d = out.pos.distanceTo(out.target);
      out.fov = Math.max(12, Math.min(46, (2 * Math.atan((tC == null || t < tC ? 9 : 14) / d) * 180) / Math.PI));
      return out;
    }
    // Ball cam, front-on like the broadcast. The delivery from low behind the
    // bowler's arm, tight on the striker; off the bat it runs ahead of the ball
    // looking back at it, so the ball comes at you with the striker behind.
    const front = { pos: new THREE.Vector3(23, 3.2, 0.9), target: new THREE.Vector3(-7.2, 0.9, -0.05), fov: 13 };
    if (tC == null || t < tC) {
      // Lead in: wider on the bowler's last strides, closing on the striker.
      const u = Math.min(1, Math.max(0, (t - (last.tR - 1.0)) / 1.2));
      const e = u * u * (3 - 2 * u);
      out.pos.lerpVectors(new THREE.Vector3(26, 3.6, 1.2), front.pos, e);
      out.target.lerpVectors(new THREE.Vector3(4, 1.0, 0.3), front.target, e);
      out.fov = 24 + (front.fov - 24) * e;
      return out;
    }
    const from = last.contact ?? STRIKER.clone().setY(0.8);
    v.copy(b).sub(from).setY(0);
    if (v.lengthSq() < 0.04) {
      const b2 = ballAt(Math.min(R.t1, t + 0.25)) ?? b;
      v.copy(b2).sub(from).setY(0);
    }
    if (v.lengthSq() < 1e-4) v.set(1, 0, 0);
    v.normalize();
    // Ahead of the ball along its path, a little to one side and above, looking back.
    const ahead = {
      pos: b.clone().addScaledVector(v, 7).add(new THREE.Vector3(-v.z * 1.8, 0, v.x * 1.8)).setY(Math.max(2.2, b.y * 0.7 + 2.4)),
      target: b.clone().addScaledVector(v, -1.5).setY(Math.max(0.3, b.y * 0.85)),
      fov: 34,
    };
    const k = Math.min(1, (t - tC) / 0.45);
    const e = k * k * (3 - 2 * k);
    out.pos.lerpVectors(front.pos, ahead.pos, e);
    out.target.lerpVectors(front.target, ahead.target, e);
    out.fov = front.fov + (ahead.fov - front.fov) * e;
    return out;
  }

  /** One replay frame: advance the replay clock, then pose the camera for it. */
  function update(dt) {
    if (!R.active) return;
    // Controller: hold left/right to scrub.
    const pd = pad?.live?.dir ?? '';
    if (held.L || pd.includes('L')) R.t = Math.max(R.t0, R.t - dt * 0.6);
    else if (held.R || pd.includes('R')) R.t = Math.min(R.t1, R.t + dt * 0.6);
    else if (R.playing) {
      R.t += dt * rate();
      if (R.t >= R.t1) {
        R.t = R.t1;
        R.playing = false;
      }
    }
    if (held.L || held.R || pd.includes('L') || pd.includes('R')) R.playing = false;
    // Free view: right stick orbits, D-pad up / down zooms.
    if (R.view === 'free' && pad?.live?.axes) {
      const [, , rx, ry] = pad.live.axes;
      const sph = new THREE.Spherical().setFromVector3(camera.position.clone().sub(orbit.target));
      if (Math.abs(rx) > 0.15) sph.theta -= rx * dt * 1.8;
      if (Math.abs(ry) > 0.15) sph.phi = Math.min(orbit.maxPolarAngle, Math.max(0.1, sph.phi + ry * dt * 1.4));
      if (pd.includes('U')) sph.radius = Math.max(orbit.minDistance, sph.radius * (1 - dt * 1.2));
      if (pd.includes('D')) sph.radius = Math.min(orbit.maxDistance, sph.radius * (1 + dt * 1.2));
      camera.position.copy(orbit.target).add(new THREE.Vector3().setFromSpherical(sph));
    }
    refresh();
  }
  function applyCamera() {
    if (R.view === 'free') {
      // Follow ball: carry the camera with the ball, keeping your angle and distance.
      const b = ballAt(R.t);
      if (R.follow && b) {
        if (lastBall) {
          const d = b.clone().sub(lastBall);
          camera.position.add(d);
          orbit.target.add(d);
        } else orbit.target.copy(b);
        lastBall = b.clone();
      }
      camera.aspect = aspect();
      orbit.update();
      camera.updateProjectionMatrix();
      return;
    }
    const p = pose(R.t);
    lastTarget.copy(p.target);
    camera.position.copy(p.pos);
    camera.fov = p.fov * Math.max(1, 1.45 / Math.max(0.5, aspect()));
    camera.aspect = aspect();
    camera.near = 0.3;
    camera.far = 260;
    camera.lookAt(p.target);
    camera.updateProjectionMatrix();
  }

  return {
    record,
    start,
    stop,
    toggle: () => (R.active ? stop() : start()),
    update,
    applyCamera,
    available,
    rate,
    state: R,
    review,
    get active() {
      return R.active;
    },
    /** Controller in replay: confirm = play/pause, back = exit. */
    key(k) {
      if (!R.active) return false;
      if (k === 'review') return review(), true;
      if (k === 'enter' || k === 'skip') R.playing = !R.playing;
      else if (k === 'pause' || k === 'replay') stop();
      else if (k === 'camera') cycleView();
      if (R.active) draw();
      return true;
    },
    setView(v) {
      if (v === 'free') return goFree();
      R.view = v;
      if (R.active) draw();
    },
    seek(t) {
      R.t = Math.min(R.t1, Math.max(R.t0, t));
      R.playing = false;
    },
  };
}
