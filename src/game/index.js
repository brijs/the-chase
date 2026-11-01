import * as THREE from 'three';
import { createMaterials, timeUniform } from '../core/materials.js';
import { createLighting } from '../scene/lighting.js';
import { buildCast } from '../scene/cast.js';
import { buildEffects } from '../scene/effects.js';
import { buildScoreboard } from '../scene/scoreboard.js';
import { buildGameGround } from '../scene/gameGround.js';
import { buildStadium } from '../scene/stadium.js';
import { createDirector } from '../scene/gameCamera.js';
import { createController } from './controller.js';
import { createHud } from './hud.js';
import { createInput } from './input.js';
import { createAudio } from './audio.js';
import { tuning, SCALES } from './tuning.js';
import { createCalibration } from './calibration.js';
import { createTuningPanel } from './tuningPanel.js';
import { createGamepad, buttonName } from './gamepad.js';
import { createGamepadPanel } from './gamepadPanel.js';
import { createReplay } from './replay.js';
import { createScorebook } from './scorebook.js';
import { createScorecard } from './scorecard.js';
import { loadChoice, saveChoice, randomConditions, resolveConditions } from './conditions.js';
import { createConditionsPanel } from './conditionsPanel.js';
import { createDrs } from './drs.js';
import { createFlow } from './matchFlow.js';
import { createTitle } from './title.js';
import { simulateInnings } from './aiInnings.js';
import { resultLine } from './scorecard.js';
import { DIFFICULTY, OVAL, FORMATS, makeRng } from './rules.js';
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
 *   ?cond=sky:overcast,pitch:green   conditions for this visit (QA; else the saved choice)
 *   ?ump=0.5                  umpire error rate for this visit (QA)
 *   ?drs=1                    the bot gets review offers too (QA; it never takes them itself)
 *   ?overs=10                 match length (5, 10 or 20; else the last one chosen)
 *   ?title=0                  straight to the match card (no title screen; also with bot / nets,
 *                             and under automation unless ?title=1)
 *   ?ball=0.09                drawn ball radius for this visit (else O's Display slider)
 */
/** The drawn ball's radius (m); the physics keeps BALL_R (0.09). */
const BALL_SIZE = { min: 0.04, max: 0.09, def: 0.06 };

export function startGame({ renderer, post, scene, camera, canvas, params }) {
  // Calibrated values first: the browser's save, else a baked calibration.json.
  tuning.init();
  const lights = createLighting(renderer, scene, { extent: 33 });
  const baseLight = { sun: lights.sun.intensity, hemi: lights.hemi.intensity, color: lights.sun.color.clone() };
  const mats = createMaterials();
  const ground = buildGameGround(scene, mats);
  const cast = buildCast(scene, mats, { fielders: 7 });
  const fx = buildEffects(scene, mats);
  const board = buildScoreboard(scene, mats, -27.2, 8.2, 'dynamic');
  board.group.rotation.y = 1.73;

  // The world round the oval: stands, crowd, hills and sky, edge to edge (no clip box, no paper).
  const stadium = buildStadium(scene, mats);
  const CLIP = [];
  document.body.classList.add('game');

  const director = createDirector(camera);
  const audio = createAudio();
  // Browsers only allow sound after a gesture.
  for (const ev of ['keydown', 'pointerdown']) window.addEventListener(ev, () => audio.ensure(), { capture: true });
  let difficulty = DIFFICULTY[params.get('level')] ? params.get('level') : 'medium';
  const fixedSeed = params.has('seed') ? parseInt(params.get('seed'), 10) : null;
  let seed = fixedSeed ?? ((Date.now() % 100000) + 1);
  const bot = params.get('bot') === '1';
  // Match length: 5, 10 or 20 overs, remembered in this browser.
  let format = 5;
  try {
    format = FORMATS[+localStorage.getItem('chase-format')] ? +localStorage.getItem('chase-format') : 5;
  } catch {}
  if (FORMATS[+params.get('overs')]) format = +params.get('overs');
  const manual = params.get('manual') === '1';

  // The day's conditions: the saved choice (or a random roll), shown on the intro card.
  let choice = loadChoice();
  if (params.has('cond')) choice = { ...choice, random: false, sel: { ...choice.sel, ...Object.fromEntries(params.get('cond').split(',').map((kv) => kv.split(':'))) } };
  if (choice.random) choice = { ...choice, sel: randomConditions() };
  if (params.has('ump')) choice = { ...choice, umpire: { ...choice.umpire, bad: +params.get('ump') } };
  /** The ground looks the part: the light for the sky, the strip's colour for the pitch. */
  function applyLook(sel) {
    const c = resolveConditions(sel);
    lights.sun.intensity = baseLight.sun * c.light.sun;
    lights.hemi.intensity = baseLight.hemi * c.light.hemi;
    lights.sun.color.copy(baseLight.color).multiply(new THREE.Color(c.light.tint));
    mats.pitch.color.set(c.pitchColor);
    stadium.setSky(sel.sky === 'overcast' || sel.sky === 'humid' ? 'grey' : 'clear');
  }
  const setChoice = (c) => {
    choice = c;
    saveChoice(choice);
    applyLook(choice.sel);
    if (ctl.phase === 'intro') showIntro();
    if (ctl.nets) {
      ctl.m.cond = resolveConditions(choice.sel);
      ctl.m.umpireBad = choice.umpire.bad;
      ctl.m.drs = choice.umpire.drs;
      hud.conditions(choice.sel);
    }
  };

  // ---------------------------------------------------------------- a match
  // The toss, then two innings: yours is played, the AI's is simulated.
  // game: { yours, theirs, ai: { sim, book } | null, batFirst }
  let game = null;
  const teamsOf = () => {
    const b = createScorebook(seed);
    return { yours: b.teams.bat.name, theirs: b.teams.bowl.name };
  };
  const line = (name, m) => `${name} ${m.runs}/${m.wkts} (${m.overText()} ov)`;

  /** Straight into a chase of the AI's own target (the bot, QA, and "play again" in tests). */
  const start = () => {
    if (ctl.phase === 'result') seed = fixedSeed != null ? seed + 1 : (Date.now() % 100000) + 1;
    game = { ...teamsOf(), ai: null, batFirst: false };
    playInnings(undefined);
  };
  /** Your innings: target undefined (the AI's own), null (bat first) or the runs to win. */
  function playInnings(target, superOver = false) {
    hud.hideCard();
    hud.reset();
    calib.show(false);
    condPanel.close();
    applyLook(choice.sel);
    const other = game.ai ? line(game.theirs, game.ai.sim.m) : null;
    ctl.finalInfo = { teams: game, other };
    ctl.startMatch(difficulty, seed, { conditions: choice.sel, umpire: choice.umpire, format, target, superOver });
    hud.conditions(choice.sel);
    scorecard.setBook(createScorebook(seed, { overs: ctl.m.overs }));
    scorecard.setContext({ other });
  }
  /** The toss card; then their innings (you bowl first) or yours (you bat first). */
  function toss() {
    if (ctl.phase !== 'intro') return;
    hud.hideCard();
    game = { ...teamsOf(), ai: null };
    flow.toss({
      yours: game.yours,
      theirs: game.theirs,
      conditions: resolveConditions(choice.sel),
      rnd: makeRng(seed * 977 + 3),
      onDone: ({ batFirst }) => begin(batFirst),
    });
  }
  /** After the toss (or straight from QA): bat first, or watch their innings and chase. */
  function begin(batFirst) {
    game = { ...teamsOf(), ai: null, batFirst };
    if (batFirst) playInnings(null);
    else theirInnings(null);
  }
  /** The AI bats: setting a total (target null) or chasing yours; in a super over, one over and two wickets. */
  function theirInnings(target, superOver = false) {
    const book = createScorebook(seed, { aiBats: true, overs: superOver ? 1 : FORMATS[format].overs });
    const sim = simulateInnings({ difficulty, seed: seed + (game.supers ?? 0) * 977, format, target, conditions: choice.sel, umpire: choice.umpire, book, superOver });
    game.ai = { sim, book };
    hud.hideCard();
    hud.reset();
    hud.conditions(null);
    if (target == null) {
      flow.innings({ sim, book, title: superOver ? `Super over: ${game.theirs} bat first` : `${game.theirs} bat first`, intro: superOver ? 'one over, two wickets' : `${FORMATS[format].overs} overs · your side in the field`, doneLabel: 'Bat: chase it', onDone: () => playInnings(sim.m.runs + 1, superOver) });
    } else {
      const mine = ctl.m;
      const tied = sim.m.result === 'tied';
      const winner = sim.m.result === 'won' ? game.theirs : game.yours;
      const result = superOver ? (tied ? 'Super over tied: another one' : `${winner} win the super over`) : resultLine(sim.m, game.theirs, game.yours);
      scorecard.setContext({ other: line(game.theirs, sim.m), result });
      flow.innings({ sim, book, title: `${superOver ? 'Super over: ' : ''}${game.theirs} chase ${target}`, intro: `you made ${mine.runs}/${mine.wkts}`, other: line(game.yours, mine), resultText: result, doneLabel: tied ? 'Super over' : 'New match', onDone: tied ? () => superOverNext('ai') : backToIntro });
    }
  }
  /**
   * Scores level: a super over, one over and two wickets a side. The side
   * that batted second bats first; tied again, another one.
   */
  function superOverNext(battedSecond) {
    game.supers = (game.supers ?? 0) + 1;
    const youFirst = battedSecond === 'player';
    hud.hideCard();
    flow.announce({
      title: game.supers > 1 ? `SUPER OVER ${game.supers}` : 'SUPER OVER',
      lines: ['Scores level. One over each, two wickets; the higher score wins, and if it is tied again, another super over.', `<b>${youFirst ? `${game.yours} (you)` : game.theirs}</b> bat first: the side that batted second goes first.`],
      button: youFirst ? 'Bat' : 'Their over',
      onDone: () => (youFirst ? playInnings(null, true) : theirInnings(null, true)),
    });
  }
  /** After a match: back to the intro card (a new seed: new sides, a new day if random). */
  function backToIntro() {
    flow.close();
    seed = fixedSeed != null ? seed + 1 : (Date.now() % 100000) + 1;
    if (choice.random) choice = { ...choice, sel: randomConditions() };
    hud.reset();
    hud.hideCard();
    hud.conditions(null);
    ctl.phase = 'intro';
    ctl.preview(difficulty, seed, format);
    applyLook(choice.sel);
    showIntro();
  }
  /** Enter (or the button) on the end-of-innings card. */
  const afterInnings = () => {
    if (ctl.m?.result === 'innings') theirInnings(ctl.m.runs + 1, ctl.m.superOver);
    else if (ctl.m?.result === 'tied') superOverNext('player');
    else if (game?.ai || !bot) backToIntro();
    else start();
  };
  const startNets = () => {
    hud.hideCard();
    hud.reset();
    condPanel.close();
    ctl.startMatch(calib.level, seed, { nets: true, field: calib.field, conditions: choice.sel, umpire: choice.umpire });
    hud.conditions(choice.sel);
    calib.show(true);
  };
  const showIntro = () => hud.intro({ difficulty, format, conditions: choice.sel, random: choice.random, teams: (() => { const t = teamsOf(); return { bat: t.yours, bowl: t.theirs }; })() });
  const pickFormat = (f) => {
    if (ctl.phase !== 'intro' || !FORMATS[f]) return;
    format = f;
    try {
      localStorage.setItem('chase-format', String(f));
    } catch {}
    ctl.preview(difficulty, seed, format);
    showIntro();
  };
  const pick = (d) => {
    if (ctl.phase !== 'intro') return;
    difficulty = d;
    ctl.preview(difficulty, seed, format);
    hud.guide = DIFFICULTY[d].guide;
    showIntro();
  };
  const hud = createHud({
    hidden: params.get('hud') === '0',
    onPick: pick,
    onFormat: pickFormat,
    onStart: () => (ctl.phase === 'intro' ? toss() : ctl.phase === 'result' && afterInnings()),
    onPad: (dir, lofted, ts, special) => ctl.press(dir, lofted, toGame(ts), special),
    onNets: () => ctl.phase === 'intro' && startNets(),
    onTune: () => panel.toggle(),
    onController: () => padPanel.toggle(),
    onConditions: () => condPanel.toggle(),
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
      if (kind === 'review-offer') drs.offer(e);
      if (kind === 'review-ai') drs.aiReview(e);
      if (kind === 'outcome') {
        replay.record(e);
        calib.onOutcome(e);
        if (!ctl.nets && book()) {
          book().ball(e, ctl.m);
          // After a wicket or an over (the last ball's card comes with the result).
          if ((e.o.out || e.overEnd) && !ctl.m.result && params.get('cards') !== '0') ctl.at(Math.max(e.tCall + 2.2, e.tReveal + 1.6), () => scorecard.show(e.o.out ? 'wicket' : 'over'));
        }
      }
      if (kind === 'result' && !ctl.nets && params.get('cards') !== '0') scorecard.show('end');
      // A new day for the next match (O shows it before you start).
      if (kind === 'result' && choice.random) choice = { ...choice, sel: randomConditions() };
      // Fast-forward keeps the big moments and drops the small stuff.
      if (kind === 'sfx' && !(ctl.ff && ['step', 'glove', 'bounce', 'applause'].includes(e.name))) audio.play(e.name, e.opts ?? {});
    },
  });

  const hudRoot = document.getElementById('hud');
  const panel = createTuningPanel({ tuning, ctl, root: hudRoot });
  const condPanel = createConditionsPanel({
    root: hudRoot,
    ctl,
    getChoice: () => choice,
    setChoice,
    // Before a match, between matches, and any time in the nets.
    editable: () => ctl.phase === 'intro' || ctl.phase === 'result' || ctl.nets,
    ball: { min: BALL_SIZE.min, max: BALL_SIZE.max, get: () => ctl.ballSize, set: (r) => setBallSize(r) },
  });
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
    // On the toss cards a direction with the shot / confirm button picks and confirms (the arrows alone just pick).
    if (flow.open) return void (flow.dir(dir), dir && flow.key('enter'));
    if (padPanel.isOpen || panel.isOpen || condPanel.isOpen || replay.active || drs.busy) return;
    if (calib.cardOpen) calib.mark(dir, special);
    else ctl.press(dir, lofted, toGame(ts), special);
  };
  const handleKey = (k) => {
      if (title.isOpen) return void (k === 'mute' ? audio.toggleMute() : title.key(k));
      if (scorecard.isOpen) return void (['enter', 'pause', 'scorecard', 'skip'].includes(k) && scorecard.close());
      if (flow.open) return void (k === 'mute' ? audio.toggleMute() : flow.key(k));
      if (drs.busy) return void (k === 'mute' ? audio.toggleMute() : drs.key(k));
      if (replay.active) return void replay.key(k);
      if (k === 'scorecard') return void (!ctl.nets && ['live', 'paused', 'ending', 'result'].includes(ctl.phase) && scorecard.show('view'));
      if (k === 'replay') return void replay.start();
      if (k === 'pad') return padPanel.toggle();
      if (padPanel.isOpen) return void (k === 'pause' && padPanel.escape());
      if (k === 'conditions') return condPanel.toggle();
      if (condPanel.isOpen) return void (['pause', 'enter'].includes(k) && condPanel.close());
      if (k === 'tune') return panel.toggle();
      if (panel.isOpen) return void (k === 'pause' && panel.close());
      if (calib.cardOpen && calib.key(k)) return;
      if (k === 'feedback') return calib.request();
      if (k === 'nets' && ctl.phase === 'intro') return startNets();
      if (k === 'enter' && ctl.phase === 'intro') toss();
      else if (k === 'enter' && ctl.phase === 'result') afterInnings();
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
      else if (['4', '5', '6'].includes(k) && ctl.phase === 'intro') pickFormat(+Object.keys(FORMATS)[+k - 4]);
  };
  createInput({ onShot: handleShot, onKey: handleKey, onArrow: (d) => flow.open && flow.dir(d) });

  // Game controller (Gamepad API): polled every frame, mapped in the Controller panel (K).
  const toast = document.createElement('div');
  toast.style.cssText = 'position:absolute;right:12px;top:12px;padding:7px 10px;display:none;pointer-events:none';
  toast.className = 'panel';
  hudRoot.appendChild(toast);
  let toastTimer = 0;
  const pad = createGamepad({
    onShot: handleShot,
    onKey: handleKey,
    cardOpen: () => scorecard.isOpen || flow.open || replay.active || drs.busy || calib.cardOpen || panel.isOpen || padPanel.isOpen || condPanel.isOpen || ['intro', 'result', 'paused'].includes(ctl.phase),
    onConnect: (gp, on) => {
      toast.innerHTML = on ? `🎮 <b>${gp.id.replace(/\(.*\)/, '').trim() || 'Controller'}</b> connected · ${buttonName(pad.settings.map.ground)} shot · K or ${buttonName(pad.settings.map.pad)} to map buttons` : '🎮 Controller disconnected';
      toast.style.display = 'block';
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => (toast.style.display = 'none'), 4500);
    },
  });
  const padPanel = createGamepadPanel({ pad, ctl, root: hudRoot });
  let curAspect = 1.6;
  const replay = createReplay({ ctl, camera, canvas, root: hudRoot, aspect: () => curAspect, pad, onReview: (o, cur, done) => drs.analyse(o, cur, done) });
  const scorecard = createScorecard({ ctl, root: hudRoot });
  const flow = createFlow({ root: hudRoot, audio });
  const drs = createDrs({ ctl, scene, camera, root: hudRoot, audio, aspect: () => curAspect, fx });
  // The bot never reviews; with ?drs=1 it still gets the offer (QA drives it).
  ctl.noReviews = bot && params.get('drs') !== '1';
  // A six in the crowd: the fans where it lands are up on their feet.
  ctl.onCrowd = (p, t) => stadium.cheer(p, t);
  // The drawn ball's radius: O's Display slider, remembered here; ?ball= for one visit.
  const setBallSize = (r, save = true) => {
    ctl.ballSize = Math.min(BALL_SIZE.max, Math.max(BALL_SIZE.min, +r || BALL_SIZE.def));
    if (save) {
      try {
        localStorage.setItem('chase-ball-size', String(ctl.ballSize));
      } catch {}
    }
  };
  {
    let saved = null;
    try {
      saved = localStorage.getItem('chase-ball-size');
    } catch {}
    setBallSize(params.get('ball') ?? saved ?? BALL_SIZE.def, false);
  }
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
    // (The press is read through the calibrated latency offset, so the bot presses that much later.)
    const tp = tR + del.contactTime(shotFoot(sh, del)) - sh.swing + (sh.bias ?? 0) + jitter + SCALES.offsetMs / 1000;
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
      // A six: all the way into the crowd, and a beat to enjoy it.
      const six = f.type === 'boundary' && o.sim.six && o.sim.tLand != null;
      const dur = six ? o.sim.tLand + 1.3 : f.type === 'boundary' ? Math.min(o.sim.tStop, 4) + 1.0 : f.t + 1.5;
      path = { to, far: travel > 10 || peak > 3, six, peak, end: c.tContact + Math.min(six ? 6.5 : 5, Math.max(2.0, dur)) };
    }
    return { t: ctl.t, T0: c.T0, tR: c.tR, tC: c.tContact ?? null, ball: fx.ball.visible ? fx.ball.position : null, path };
  }

  function frame(dt) {
    if (drs.busy) drs.update(dt);
    if (drs.active) {
      // The third umpire's views: past moments, its own camera and overlays.
      drs.apply();
      timeUniform.value = drs.tView;
      ctl.render(drs.tView, { trail: false });
      stadium.update(drs.tView);
      drs.afterRender();
      post.render(scene, camera, CLIP);
      hud.update(ctl.t, ctl);
      return;
    }
    if (replay.active) {
      // The camera first (it reads past ball positions), then the field at that time.
      replay.applyCamera();
      timeUniform.value = replay.state.t;
      ctl.render(replay.state.t, { trail: replay.rate() >= 0.99 });
      stadium.update(replay.state.t);
      post.render(scene, camera, CLIP);
      hud.update(ctl.t, ctl);
      return;
    }
    timeUniform.value = ctl.t;
    ctl.render(ctl.t);
    stadium.update(ctl.t);
    director.update(dt, cameraCtx());
    post.render(scene, camera, CLIP);
    hud.update(ctl.t, ctl);
  }
  function step(dt) {
    ctl.update(dt);
    frame(dt);
  }

  ctl.preview(difficulty, seed, format);
  hud.guide = DIFFICULTY[difficulty].guide;
  // The title screen first (the camera drifting round the ground), then the match card.
  const title = createTitle({
    root: hudRoot,
    dioramaUrl: window.__DIORAMA_URL ?? '?mode=diorama',
    onPlay: () => {
      director.set('broadcast', { glide: true });
      setTimeout(showIntro, 650);
    },
    onNets: () => {
      director.set('broadcast', { glide: true });
      startNets();
    },
    onController: () => padPanel.toggle(),
  });
  director.set('broadcast');
  if (bot) start();
  else if (params.get('nets') === '1') startNets();
  // (Automation skips it unless ?title=1, so the QA scripts land on the match card as before.)
  else if (params.get('title') === '0' || (navigator.webdriver && params.get('title') !== '1')) showIntro();
  else {
    title.show();
    director.set('orbit');
  }
  applyLook(choice.sel);
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
    SCALES,
    calib,
    panel,
    pad,
    padPanel,
    replay,
    scorecard,
    drs,
    flow,
    title,
    toss,
    begin,
    superOverNext,
    playInnings,
    theirInnings,
    backToIntro,
    afterInnings,
    get game() {
      return game;
    },
    condPanel,
    conditions: () => choice,
    setConditions: setChoice,
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
