import * as THREE from 'three';
import { PixelPost } from './core/post.js';
import { PALETTE_HEX } from './core/palette.js';
import { createMaterials, timeUniform } from './core/materials.js';
import { createCamera, updateCamera } from './scene/camera.js';
import { createLighting } from './scene/lighting.js';
import { buildGround } from './scene/ground.js';
import { buildCast } from './scene/cast.js';
import { buildEffects } from './scene/effects.js';
import { buildScoreboard } from './scene/scoreboard.js';
import { createStage, TL } from './scene/stage.js';
import { SLAB, LOOP, domainTime, clockTime } from './config.js';
import { createViewer } from './viewer.js';
import { startGame } from './game/index.js';

/**
 * The Short Ball. Wire order: renderer -> scene -> camera -> post -> clip planes
 * -> lights -> materials -> ground/props -> cast -> effects -> landmark -> stage.
 * There is no merge pass: the cast is re-posed every frame and the set is small
 * enough (see README for the draw-call line).
 *
 *   ?t=19.12   freeze at a clock time (0..46)
 *   ?from=30   start playback there
 *   ?grey=1    grey blockout: flat grey materials, no post pass
 *   ?dither=0  post pass with the dither off (noise isolation)
 *   ?rs=1      render scale (default 2)
 *   ?ui=0      hide the viewer bar (also hidden under automation)
 *   ?mode=game play the Chase (src/game/index.js): you bat, the AI bowls
 *
 * Viewer: drag to rotate, scroll/pinch to zoom, right-drag to pan, Space to
 * pause, [ ] for speed, R to reset to the locked diorama view.
 */
const params = new URLSearchParams(location.search);
const grey = params.get('grey') === '1';

const canvas = document.getElementById('stage');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, preserveDrawingBuffer: true });
} catch (e) {
  document.getElementById('fallback').hidden = false;
  throw e;
}
renderer.setPixelRatio(1);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
renderer.localClippingEnabled = false;

const scene = new THREE.Scene();
scene.background = null;
const camera = createCamera();
// Render scale: target pixels per CSS pixel. 2x (the playbook's close-detail
// setting) quantises at a finer grid and the browser box-filters it down, so the
// palette, ink and dither stay but the blocks are half the size. maxDim 2600 keeps
// a 1280-wide desktop from being capped. ?rs=1 restores the 1:1 chunky grid.
const renderScale = parseFloat(params.get('rs') ?? '2');
const post = new PixelPost(renderer, 2600, renderScale);
canvas.style.imageRendering = renderScale > 1 ? 'auto' : 'pixelated';
if (params.get('dither') === '0') post.uniforms.uDither.value = 0;
if (post.uniforms.uPalette.value.length !== PALETTE_HEX.length || PALETTE_HEX.length !== 64) {
  throw new Error(`palette length ${PALETTE_HEX.length} does not match the shader's uPalette[64]`);
}

if (params.get('mode') === 'game') startGame({ renderer, post, scene, camera, canvas, params });
else runDiorama();

function runDiorama() {
  const CLIP = [
    new THREE.Plane(new THREE.Vector3(1, 0, 0), SLAB.hx + 0.05),
    new THREE.Plane(new THREE.Vector3(-1, 0, 0), SLAB.hx + 0.05),
    new THREE.Plane(new THREE.Vector3(0, 0, 1), SLAB.hz + 0.05),
    new THREE.Plane(new THREE.Vector3(0, 0, -1), SLAB.hz + 0.05),
  ];

  const lights = createLighting(renderer, scene);
  const mats = createMaterials();
  const ground = buildGround(scene, mats);
  const cast = buildCast(scene, mats);
  const fx = buildEffects(scene, mats);
  const board = buildScoreboard(scene, mats, -1.5, -6.1, TL.boardFlip.map((t, i) => ({ t, state: i })));
  const stage = createStage({ cast, fx, board });

  if (grey) {
    const g = new THREE.MeshStandardMaterial({ color: 0x9a9a9a, roughness: 0.9 });
    scene.traverse((o) => {
      if (o.isMesh && !o.material.transparent) o.material = g;
    });
  }

  function draw(T) {
    const t = domainTime(T);
    timeUniform.value = t;
    stage.update(t);
    if (grey) {
      renderer.setRenderTarget(null);
      renderer.setClearColor(0xffffff, 1);
      renderer.clippingPlanes = CLIP;
      renderer.render(scene, camera);
      renderer.clippingPlanes = [];
    } else {
      post.render(scene, camera, CLIP);
    }
  }

  // Playhead: advances by real elapsed time x speed unless paused. The scene is
  // still a pure function of the playhead, so pause/seek/speed never drift.
  const startAt = params.has('from') ? parseFloat(params.get('from')) : 0;
  const wrap = (c) => ((c % LOOP) + LOOP) % LOOP;
  const play = {
    clock: wrap(params.has('t') ? parseFloat(params.get('t')) : startAt),
    speed: 1,
    paused: params.has('t'),
  };
  let dirty = true;
  let debugView = false; // QA's view(pos, tgt) owns the camera until view() resets
  const playback = {
    toggle() { play.paused = !play.paused; dirty = true; },
    setSpeed(s) { play.speed = s; dirty = true; },
    seek(c) { play.clock = wrap(c); play.paused = true; dirty = true; },
    speed: () => play.speed,
    paused: () => play.paused,
  };

  function resize() {
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;
    const aspect = Math.max(0.3, rect.width / rect.height);
    if (!viewer?.isUser() && !debugView) {
      updateCamera(camera, aspect);
      viewer?.syncToLocked();
    } else {
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
    }
    post.setSize(rect.width, rect.height);
    dirty = true;
  }

  let viewer = null;
  resize();
  viewer = createViewer({
    canvas,
    camera,
    slab: SLAB,
    loop: LOOP,
    playback,
    onCameraChange: () => (dirty = true),
    onReset: () => {
      debugView = false;
      const rect = canvas.getBoundingClientRect();
      updateCamera(camera, Math.max(0.3, rect.width / rect.height));
    },
  });

  let last = null;
  function tick(now) {
    const dt = last == null ? 0 : Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!play.paused) {
      play.clock = wrap(play.clock + dt * play.speed);
      dirty = true;
    }
    if (!debugView) viewer.update();
    if (dirty) {
      draw(play.clock);
      dirty = false;
    }
    viewer.refresh(play.clock);
    requestAnimationFrame(tick);
  }

  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 250));
  draw(play.clock);
  requestAnimationFrame(tick);

  const entities = Object.fromEntries(Object.entries(cast).map(([k, a]) => [k, a.outer]));
  entities.ball = fx.ball;

  window.__diorama = {
    THREE,
    scene,
    camera,
    renderer,
    post,
    cast,
    stage,
    board,
    ground,
    lights,
    mats,
    CLIP,
    TL,
    LOOP,
    clockTime,
    /** The beat table in page-clock seconds (what ?t= takes). */
    clockTL: JSON.parse(JSON.stringify(TL, (k, v) => (typeof v === 'number' && k !== 'loop' ? +clockTime(v).toFixed(3) : v))),
    entities,
    viewer,
    playback,
    freeze(t) {
      play.clock = wrap(t);
      play.paused = true;
      draw(play.clock);
      dirty = false;
    },
    play() {
      play.paused = false;
    },
    /** QA debug camera. view() with no arguments returns to the locked view. */
    view(pos, target) {
      if (!pos) {
        viewer.reset();
        return;
      }
      debugView = true;
      camera.position.set(pos[0], pos[1], pos[2]);
      camera.lookAt(target[0], target[1], target[2]);
      camera.updateProjectionMatrix();
      draw(play.clock);
    },
    audit: {
      loop: LOOP,
      slab: { x0: -SLAB.hx, x1: SLAB.hx, z0: -SLAB.hz, z1: SLAB.hz, margin: 0.35 },
      movers: [
        { name: 'batterA', group: cast.batterA.outer, required: true, allowSpawn: true },
        { name: 'batterB', group: cast.batterB.outer, allowSpawn: false },
      ],
      emitters: [],
    },
  };
  window.__dioramaReady = true;
}
