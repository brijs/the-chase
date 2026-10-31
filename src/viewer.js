import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/**
 * Viewer mode, added on request on top of the locked diorama camera:
 *   drag = rotate, scroll / pinch = zoom, right-drag / two-finger = pan,
 *   a playback bar (pause, 0.25x-2x, scrubber, reset view), keys Space / R / [ ].
 *
 * The locked 45/33 view stays the default and "Reset view" returns to it exactly
 * (the camera solve runs again). Limits keep the camera above the grass and the
 * orbit target on the slab, so the slab's underside and the clipped edges never
 * become the subject. This breaks the playbook's "locked angle" and "empty paper"
 * rules deliberately; DESIGN.md records it. The bar hides itself under automation
 * (navigator.webdriver) and with ?ui=0, so QA frames stay clean.
 */
const SPEEDS = [0.25, 0.5, 1, 2];

export function createViewer({ canvas, camera, slab, loop, playback, onCameraChange, onReset }) {
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.rotateSpeed = 0.6;
  controls.zoomSpeed = 0.9;
  controls.panSpeed = 0.8;
  controls.screenSpacePanning = false; // pan slides along the ground
  controls.minPolarAngle = 0.12; // not quite straight down
  controls.maxPolarAngle = Math.PI / 2 - 0.1; // never below the deck
  controls.minDistance = 5;
  controls.target.copy(camera.userData.target ?? new THREE.Vector3());
  controls.update();

  let user = false; // has the viewer moved the camera off the locked view?
  // Drive the controls only while someone is interacting, plus a second for the
  // damping to settle. Calling update() every frame would re-aim any camera set
  // from outside (the QA harness's fitted views) back at the orbit target.
  let interacting = false;
  let settleUntil = 0;
  controls.addEventListener('start', () => {
    user = true;
    interacting = true;
    wake();
  });
  controls.addEventListener('end', () => {
    interacting = false;
    settleUntil = performance.now() + 1200;
  });
  controls.addEventListener('change', () => {
    // Keep the orbit point on the slab, at deck height.
    const t = controls.target;
    t.x = THREE.MathUtils.clamp(t.x, -slab.hx, slab.hx);
    t.z = THREE.MathUtils.clamp(t.z, -slab.hz, slab.hz);
    t.y = THREE.MathUtils.clamp(t.y, -0.2, 1.5);
    onCameraChange();
  });

  /** Called after the locked camera has been solved (load, resize, reset). */
  function syncToLocked() {
    controls.target.copy(camera.userData.target);
    controls.maxDistance = camera.userData.fitDistance * 1.6;
    controls.update();
  }

  function reset() {
    user = false;
    // Flush any damping momentum first: with damping off, update() applies and
    // clears the pending deltas, so the next frame cannot drift off the locked view.
    controls.enableDamping = false;
    controls.update();
    onReset();
    syncToLocked();
    controls.enableDamping = true;
    onCameraChange();
  }

  // ------------------------------------------------------------------ UI
  const params = new URLSearchParams(location.search);
  const hidden = params.get('ui') === '0' || navigator.webdriver === true;
  let ui = null;
  let idleTimer = 0;
  function wake() {
    if (!ui) return;
    ui.bar.classList.remove('idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => ui.bar.classList.add('idle'), 2600);
  }

  if (!hidden) {
    const style = document.createElement('style');
    style.textContent = `
      #viewer { position: fixed; left: 50%; bottom: 14px; transform: translateX(-50%);
        display: flex; align-items: center; gap: 6px; padding: 6px 8px;
        background: rgba(246, 242, 230, 0.92); border: 1px solid #c9bfa4; border-radius: 8px;
        font: 12px/1 ui-monospace, SFMono-Regular, Menlo, monospace; color: #2a211c;
        box-shadow: 0 2px 10px rgba(23, 26, 24, 0.12); transition: opacity 0.4s;
        max-width: calc(100vw - 16px); flex-wrap: wrap; justify-content: center; user-select: none; }
      #viewer.idle { opacity: 0.28; }
      #viewer:hover { opacity: 1; }
      #viewer button { font: inherit; color: inherit; background: #ebe4d0; border: 1px solid #c9bfa4;
        border-radius: 5px; padding: 5px 8px; cursor: pointer; min-width: 30px; }
      #viewer button:hover { background: #dcd3ba; }
      #viewer button.on { background: #283a63; border-color: #283a63; color: #f6f2e6; }
      #viewer input[type=range] { width: 180px; accent-color: #9a2731; }
      #viewer .time { min-width: 4.6em; text-align: right; font-variant-numeric: tabular-nums; }
      #viewer .sep { width: 1px; height: 20px; background: #c9bfa4; margin: 0 2px; }
      #viewer .hint { color: #6f6a55; padding: 0 4px; }
      @media (max-width: 620px) { #viewer input[type=range] { width: 120px; } #viewer .hint { display: none; } }
    `;
    document.head.appendChild(style);
    const bar = document.createElement('div');
    bar.id = 'viewer';
    bar.innerHTML = `
      <button data-act="play" title="Pause / play (Space)">❚❚</button>
      ${SPEEDS.map((s) => `<button data-speed="${s}" title="Playback speed">${s}×</button>`).join('')}
      <span class="sep"></span>
      <input type="range" min="0" max="${loop}" step="0.01" value="0" aria-label="Timeline" />
      <span class="time">0.00s</span>
      <span class="sep"></span>
      <button data-act="reset" title="Back to the diorama view (R)">⟲ View</button>
      <span class="sep"></span>
      <button data-act="game" title="Bat in a 5-over chase against the AI">🏏 Play the chase</button>
      <span class="hint">drag rotate · scroll zoom · right-drag pan</span>`;
    document.body.appendChild(bar);
    ui = {
      bar,
      play: bar.querySelector('[data-act=play]'),
      speeds: [...bar.querySelectorAll('[data-speed]')],
      range: bar.querySelector('input[type=range]'),
      time: bar.querySelector('.time'),
    };
    bar.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.act === 'play') playback.toggle();
      else if (b.dataset.act === 'reset') reset();
      else if (b.dataset.act === 'game') location.search = '?mode=game';
      else if (b.dataset.speed) playback.setSpeed(parseFloat(b.dataset.speed));
      wake();
    });
    let scrubbing = false;
    ui.range.addEventListener('input', () => {
      scrubbing = true;
      playback.seek(parseFloat(ui.range.value));
      wake();
    });
    ui.range.addEventListener('change', () => (scrubbing = false));
    ui.isScrubbing = () => scrubbing;
    bar.addEventListener('pointermove', wake);
    canvas.addEventListener('pointermove', wake);
    wake();
  }

  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement) return;
    if (e.code === 'Space') {
      e.preventDefault();
      playback.toggle();
    } else if (e.key === 'r' || e.key === 'R') reset();
    else if (e.key === ']' || e.key === '[') {
      const i = SPEEDS.indexOf(playback.speed());
      const j = THREE.MathUtils.clamp(i + (e.key === ']' ? 1 : -1), 0, SPEEDS.length - 1);
      playback.setSpeed(SPEEDS[j]);
    } else return;
    wake();
  });

  /** Refresh the bar from the playback state (cheap; called every frame). */
  function refresh(clock) {
    if (!ui) return;
    ui.play.textContent = playback.paused() ? '▶' : '❚❚';
    for (const b of ui.speeds) b.classList.toggle('on', parseFloat(b.dataset.speed) === playback.speed());
    if (!ui.isScrubbing()) ui.range.value = clock.toFixed(2);
    ui.time.textContent = `${clock.toFixed(2)}s`;
  }

  return {
    controls,
    update: () => {
      if (interacting || performance.now() < settleUntil) controls.update();
    },
    isUser: () => user,
    syncToLocked,
    reset,
    refresh,
  };
}
