import * as THREE from 'three';
import { createMaterials, timeUniform } from '../core/materials.js';
import { createLighting } from '../scene/lighting.js';
import { buildCast } from '../scene/cast.js';
import { buildEffects } from '../scene/effects.js';
import { buildScoreboard } from '../scene/scoreboard.js';
import { buildGameGround } from '../scene/gameGround.js';
import { createDirector } from '../scene/gameCamera.js';
import { createController } from './controller.js';
import { createHud } from './hud.js';
import { createInput } from './input.js';
import { createAudio } from './audio.js';
import { tuning } from './tuning.js';
import { createCalibration } from './calibration.js';
import { createTuningPanel } from './tuningPanel.js';
import { createGamepad, buttonName } from './gamepad.js';
import { createGamepadPanel } from './gamepadPanel.js';
import { createReplay } from './replay.js';
import { createScorebook } from './scorebook.js';
import { createScorecard } from './scorecard.js';
import { DIFFICULTY, OVAL } from './rules.js';
import { SHOTS, SHOT_KEYS, SPECIAL_KEYS, shotFor, shotFit, shotFoot } from './batting.js';

/**
 * The Chase: ?mode=game. Same renderer, palette and pixel pass as the
 * diorama; its own ground (the oval), a full XI, a live scoreboard, the
 * broadcast camera and a HUD.
 *
 *   ?level=easy|medium|hard   difficulty (default medium)
 *   ?seed=7                   fixed seed (targets, deliveries, outcomes)
 *   ?bot=1                    the computer bats (attract mode / QA)
 *   ?hud=0                    no HUD
 *   ?manual=1                 time only moves via __game.advance() (QA)
 *   ?nets=1                   straight into the calibration nets
 *   ?cards=0                  no automatic scorecards (QA; B still shows it)
 */
export function startGame({ renderer, post, scene, camera, canvas, params }) {
  // Calibrated values first: the browser's save, else a baked calibration.json.
  tuning.init();
  createLighting(renderer, scene, { extent: 31 });
  const mats = createMaterials();
  const ground = buildGameGround(scene, mats);
  const cast = buildCast(scene, mats, { fielders: 7 });
  const fx = buildEffects(scene, mats);
  const board = buildScoreboard(scene, mats, -23.4, 8.2, 'dynamic');
  board.group.rotation.y = 1.73;

  const [sa, sb] = OVAL.slab;
  const CLIP = [
    new THREE.Plane(new THREE.Vector3(1, 0, 0), -(OVAL.cx - sa) + 0.05),
    new THREE.Plane(new THREE.Vector3(-1, 0, 0), OVAL.cx + sa + 0.05),
    new THREE.Plane(new THREE.Vector3(0, 0, 1), sb + 0.05),
    new THREE.Plane(new THREE.Vector3(0, 0, -1), sb + 0.05),
  ];

  const director = createDirector(camera);
  const audio = createAudio();
  // Browsers only allow sound after a gesture.
  for (const ev of ['keydown', 'pointerdown']) window.addEventListener(ev, () => audio.ensure(), { capture: true });
  let difficulty = DIFFICULTY[params.get('level')] ? params.get('level') : 'medium';
  const fixedSeed = params.has('seed') ? parseInt(params.get('seed'), 10) : null;
  let seed = fixedSeed ?? ((Date.now() % 100000) + 1);
  const bot = params.get('bot') === '1';
  const manual = params.get('manual') === '1';

  const start = () => {
    hud.hideCard();
    hud.reset();
    calib.show(false);
    if (ctl.phase === 'result') seed = fixedSeed != null ? seed + 1 : (Date.now() % 100000) + 1;
    ctl.startMatch(difficulty, seed);
    scorecard.setBook(createScorebook(seed));
  };
  const startNets = () => {
    hud.hideCard();
    hud.reset();
    ctl.startMatch(calib.level, seed, { nets: true, field: calib.field });
    calib.show(true);
  };
  const pick = (d) => {
    if (ctl.phase !== 'intro') return;
    difficulty = d;
    ctl.preview(difficulty, seed);
    hud.guide = DIFFICULTY[d].guide;
    hud.intro({ target: ctl.m.target, difficulty, teams: (() => { const b = createScorebook(seed); return { bat: b.teams.bat.name, bowl: b.teams.bowl.name }; })() });
  };
  const hud = createHud({
    hidden: params.get('hud') === '0',
    onPick: pick,
    onStart: () => (ctl.phase === 'intro' || ctl.phase === 'result') && start(),
    onPad: (dir, lofted, ts, special) => ctl.press(dir, lofted, toGame(ts), special),
    onNets: () => ctl.phase === 'intro' && startNets(),
    onTune: () => panel.toggle(),
    onController: () => padPanel.toggle(),
  });
  const ctl = createController({
    scene,
    cast,
    fx,
    board,
    ground,
    hud,
    onEvent: (kind, e) => {
      if (kind === 'release' && bot) botPlay(e.tR);
      if (kind === 'outcome') {
        replay.record(e);
        calib.onOutcome(e);
        if (!ctl.nets && book()) {
          book().ball(e, ctl.m);
          // After a wicket or an over (the last ball's card comes with the result).
          if ((e.o.out || e.overEnd) && !ctl.m.result && params.get('cards') !== '0') ctl.at(e.tCall + 2.2, () => scorecard.show(e.o.out ? 'wicket' : 'over'));
        }
      }
      if (kind === 'result' && !ctl.nets && params.get('cards') !== '0') scorecard.show('end');
      // Fast-forward keeps the big moments and drops the small stuff.
      if (kind === 'sfx' && !(ctl.ff && ['step', 'glove', 'bounce', 'applause'].includes(e.name))) audio.play(e.name, e.opts ?? {});
    },
  });

  const hudRoot = document.getElementById('hud');
  const panel = createTuningPanel({ tuning, ctl, root: hudRoot });
  const calib = createCalibration({
    ctl,
    tuning,
    root: hudRoot,
    onTune: () => panel.toggle(),
    onExit: () => (location.search = '?mode=game'),
  });

  // Real time of the last frame, so a key's timestamp maps onto the game clock.
  let lastReal = performance.now();
  const toGame = (ts) => ctl.t + (Math.min(ts, performance.now()) - lastReal) / 1000 * (ctl.ff ? 4 : 1);

  // Keyboard and controller drive the same two handlers.
  const handleShot = (dir, lofted, ts, special) => {
    if (padPanel.isOpen || panel.isOpen || replay.active) return;
    if (calib.cardOpen) calib.mark(dir, special);
    else ctl.press(dir, lofted, toGame(ts), special);
  };
  const handleKey = (k) => {
      if (scorecard.isOpen) return void (['enter', 'pause', 'scorecard', 'skip'].includes(k) && scorecard.close());
      if (replay.active) return void replay.key(k);
      if (k === 'scorecard') return void (!ctl.nets && ['live', 'paused', 'ending', 'result'].includes(ctl.phase) && scorecard.show('view'));
      if (k === 'replay') return void replay.start();
      if (k === 'pad') return padPanel.toggle();
      if (padPanel.isOpen) return void (k === 'pause' && padPanel.escape());
      if (k === 'tune') return panel.toggle();
      if (panel.isOpen) return void (k === 'pause' && panel.close());
      if (calib.cardOpen && calib.key(k)) return;
      if (k === 'feedback') return calib.request();
      if (k === 'nets' && ctl.phase === 'intro') return startNets();
      if (k === 'enter' && (ctl.phase === 'intro' || ctl.phase === 'result')) start();
      else if (k === 'pause' && (ctl.phase === 'live' || ctl.phase === 'paused')) {
        ctl.phase = ctl.phase === 'paused' ? 'live' : 'paused';
        hud.pause(ctl.phase === 'paused');
        audio.setPaused(ctl.phase === 'paused');
      } else if (k === 'camera') director.toggle();
      else if (k === 'skip') ctl.ff = true;
      else if (k === 'help') hud.toggleHelp();
      else if (k === 'guide') hud.guide = !hud.guide;
      else if (k === 'mute') audio.toggleMute();
      else if (['1', '2', '3'].includes(k) && ctl.phase === 'intro') pick(Object.keys(DIFFICULTY)[+k - 1]);
  };
  createInput({ onShot: handleShot, onKey: handleKey });

  // Game controller (Gamepad API): polled every frame, mapped in the Controller panel (K).
  const toast = document.createElement('div');
  toast.style.cssText = 'position:absolute;right:12px;top:12px;padding:7px 10px;display:none;pointer-events:none';
  toast.className = 'panel';
  hudRoot.appendChild(toast);
  let toastTimer = 0;
  const pad = createGamepad({
    onShot: handleShot,
    onKey: handleKey,
    cardOpen: () => scorecard.isOpen || replay.active || calib.cardOpen || panel.isOpen || padPanel.isOpen || ['intro', 'result', 'paused'].includes(ctl.phase),
    onConnect: (gp, on) => {
      toast.innerHTML = on ? `🎮 <b>${gp.id.replace(/\(.*\)/, '').trim() || 'Controller'}</b> connected · ${buttonName(pad.settings.map.ground)} shot · K or ${buttonName(pad.settings.map.pad)} to map buttons` : '🎮 Controller disconnected';
      toast.style.display = 'block';
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => (toast.style.display = 'none'), 4500);
    },
  });
  const padPanel = createGamepadPanel({ pad, ctl, root: hudRoot });
  let curAspect = 1.6;
  const replay = createReplay({ ctl, camera, canvas, root: hudRoot, aspect: () => curAspect, pad });
  const scorecard = createScorecard({ ctl, root: hudRoot });
  const book = () => scorecard.book;

  /** The computer bats: best-fitting shot, near-perfect timing, leaves the wide ones. */
  function botPlay(tR) {
    const { del } = ctl.cur;
    let best = null;
    for (const k of Object.keys(SHOTS).filter((k) => !SHOTS[k].special)) {
      const f = shotFit(SHOTS[k], del, shotFoot(SHOTS[k], del));
      const sc = f * SHOTS[k].power * (k === 'defence' ? 0.45 : 1);
      if (!best || sc > best.sc) best = { k, f, sc };
    }
    if (best.f < 0.35 && !del.hitsStumps && !del.padImpact('stance')) return;
    const sh = SHOTS[best.k];
    const jitter = (Math.sin(tR * 12.9898) * 43758.5453 % 1) * 0.03;
    const tp = tR + del.contactTime(shotFoot(sh, del)) - sh.swing + (sh.bias ?? 0) + jitter;
    const dir = Object.entries({ D: 'straight', DL: 'cover', L: 'cut', UL: 'lateCut', U: 'punch', UR: 'glance', R: 'pull', DR: 'onDrive', '': 'defence' }).find(([, v]) => v === (best.k === 'flick' ? 'pull' : best.k))[0];
    const lofted = best.f > 0.9 && best.k !== 'defence' && ctl.m.need() / Math.max(1, ctl.m.ballsLeft()) > 1.6;
    ctl.events.push({ t: tp, fn: () => ctl.press(dir, lofted, tp) });
    ctl.events.sort((a, b) => a.t - b.t);
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;
    curAspect = Math.max(0.3, rect.width / rect.height);
    director.resize(curAspect);
    post.setSize(rect.width, rect.height);
  }
  resize();
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 250));

  /** What the director needs: the ball's timeline and, after a hit, its path. */
  function cameraCtx() {
    const c = ctl.cur;
    if (scorecard.onBoard) return { t: ctl.t, board: true };
    if (!c) return { t: ctl.t };
    const o = c.outcome;
    let path = null;
    if (o?.kind === 'hit' && o.sim) {
      const S = o.sim.samples;
      const to = S[S.length - 1];
      const travel = Math.hypot(to.x - o.contactPos.x, to.z - o.contactPos.z);
      const peak = S.reduce((m, q) => Math.max(m, q.y), 0);
      const f = o.fielding;
      // Follow until the ball is stopped or caught (and a beat after), at most 5 s.
      const dur = f.type === 'boundary' ? Math.min(o.sim.tStop, 4) + 1.0 : f.t + 1.5;
      path = { to, far: travel > 10 || peak > 3, end: c.tContact + Math.min(5, Math.max(2.0, dur)) };
    }
    return { t: ctl.t, T0: c.T0, tR: c.tR, tC: c.tContact ?? null, ball: fx.ball.visible ? fx.ball.position : null, path };
  }

  function frame(dt) {
    if (replay.active) {
      // The camera first (it reads past ball positions), then the field at that time.
      replay.applyCamera();
      timeUniform.value = replay.state.t;
      ctl.render(replay.state.t, { trail: replay.rate() >= 0.99 });
      post.render(scene, camera, CLIP);
      hud.update(ctl.t, ctl);
      return;
    }
    timeUniform.value = ctl.t;
    ctl.render(ctl.t);
    director.update(dt, cameraCtx());
    post.render(scene, camera, CLIP);
    hud.update(ctl.t, ctl);
  }
  function step(dt) {
    ctl.update(dt);
    frame(dt);
  }

  ctl.preview(difficulty, seed);
  hud.guide = DIFFICULTY[difficulty].guide;
  if (bot) start();
  else if (params.get('nets') === '1') startNets();
  else hud.intro({ target: ctl.m.target, difficulty, teams: (() => { const b = createScorebook(seed); return { bat: b.teams.bat.name, bowl: b.teams.bowl.name }; })() });
  director.set('broadcast');
  frame(0);

  let last = null;
  function tick(now) {
    const dt = last == null ? 0 : Math.min(0.1, (now - last) / 1000);
    last = now;
    lastReal = now;
    pad.poll();
    if (replay.active) {
      replay.update(dt);
      frame(dt);
    } else if (!manual) step(dt);
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  window.__game = {
    THREE,
    scene,
    camera,
    renderer,
    cast,
    fx,
    ctl,
    director,
    hud,
    audio,
    tuning,
    calib,
    panel,
    pad,
    padPanel,
    replay,
    scorecard,
    start,
    startNets,
    /** Step the game by `seconds` in fixed `dt` steps (QA; use with ?manual=1). */
    advance(seconds, dt = 1 / 60) {
      const n = Math.round(seconds / dt);
      for (let i = 0; i < n; i++) step(dt);
    },
    /** Run until predicate(ctl) is true or `max` seconds pass. */
    until(pred, max = 60, dt = 1 / 60) {
      for (let s = 0; s < max; s += dt) {
        if (pred(ctl)) return true;
        step(dt);
      }
      return pred(ctl);
    },
    press: (dir, lofted, t) => ctl.press(dir, lofted, t),
    /** Draw one frame at the current time without advancing it (QA). */
    renderFrame: () => frame(0),
    SHOTS,
    SHOT_KEYS,
    SPECIAL_KEYS,
    shotFor,
    shotFoot,
  };
  window.__dioramaReady = true;
}
