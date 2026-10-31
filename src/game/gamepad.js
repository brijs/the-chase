/**
 * Game controllers for the Chase (tested with the layout of a Stadia controller
 * in Bluetooth mode; any pad the browser reports with the "standard" mapping
 * works the same way). Polled once per frame through the Gamepad API.
 *
 * Direction comes from the D-pad, the left stick, or both (8 ways, like the
 * arrow keys). Every action is a button binding you can change in the
 * Controller panel (K); the mapping is saved in this browser.
 *
 * Presses are time-stamped with the pad's own report time, so shot timing is
 * as precise as the keyboard's.
 */
const STORE = 'chase-gamepad-v1';

export const ACTIONS = [
  ['ground', 'Shot along the ground', 'D'],
  ['lofted', 'Lofted shot', 'A'],
  ['special', 'Special: sweep / reverse sweep / scoop', 'S'],
  ['skip', 'Skip the dead time', 'Space'],
  ['pause', 'Pause', 'P'],
  ['camera', 'Camera', 'C'],
  ['feedback', 'Feedback on the last ball (nets)', 'F'],
  ['tune', 'Tuning panel', 'T'],
  ['help', 'Controls legend', 'H'],
  ['pad', 'Controller panel', 'K'],
  ['replay', 'Replay the last ball', 'R'],
  ['scorecard', 'Scorecard', 'B'],
  ['confirm', 'Confirm on cards (start, submit)', 'Enter'],
  ['back', 'Back on cards (close, skip)', 'Esc'],
];

/** Standard-mapping button indices, named as on a Stadia controller. */
export const BUTTON_NAMES = {
  0: 'A', 1: 'B', 2: 'X', 3: 'Y', 4: 'L1', 5: 'R1', 6: 'L2', 7: 'R2',
  8: 'Options ⋯', 9: 'Menu ≡', 10: 'L3 (stick click)', 11: 'R3 (stick click)',
  12: 'D-pad up', 13: 'D-pad down', 14: 'D-pad left', 15: 'D-pad right',
  16: 'Stadia button', 17: 'Assistant', 18: 'Capture',
};
export const buttonName = (i) => (i === null || i === undefined ? '—' : BUTTON_NAMES[i] ?? `Button ${i}`);

export const DEFAULTS = {
  map: { ground: 0, lofted: 3, special: 2, skip: 1, pause: 9, camera: 4, feedback: 5, tune: 8, help: null, pad: 16, replay: 6, scorecard: 11, confirm: 0, back: 1 },
  dirSource: 'both', // 'dpad' | 'stick' | 'both'
  deadzone: 0.45,
};

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE) ?? 'null');
    if (s && s.map) return { ...DEFAULTS, ...s, map: { ...DEFAULTS.map, ...s.map } };
  } catch {}
  return JSON.parse(JSON.stringify(DEFAULTS));
}

/**
 * onShot(dirKey, lofted, timeMs, special), onKey(name): the same handlers the
 * keyboard drives. cardOpen(): true while a card or panel has the controls,
 * when the confirm/back bindings apply instead of the shot ones.
 */
export function createGamepad({ onShot, onKey, cardOpen = () => false, onConnect = () => {} }) {
  const settings = load();
  let prev = [];
  let capture = null; // (buttonIndex) => void, while rebinding
  let active = null; // the pad in use
  const live = { buttons: [], axes: [0, 0], dir: '', name: '' };

  const save = () => {
    try {
      localStorage.setItem(STORE, JSON.stringify(settings));
    } catch {}
  };

  window.addEventListener('gamepadconnected', (e) => {
    live.name = e.gamepad.id;
    onConnect(e.gamepad, true);
  });
  window.addEventListener('gamepaddisconnected', (e) => onConnect(e.gamepad, false));

  function dirOf(pad) {
    const held = new Set();
    const b = (i) => !!pad.buttons[i]?.pressed;
    if (settings.dirSource !== 'stick') {
      if (b(12)) held.add('U');
      if (b(13)) held.add('D');
      if (b(14)) held.add('L');
      if (b(15)) held.add('R');
    }
    if (settings.dirSource !== 'dpad') {
      const [x, y] = [pad.axes[0] ?? 0, pad.axes[1] ?? 0];
      if (Math.hypot(x, y) > settings.deadzone) {
        // 8 sectors; the diagonals get their fair 45 degrees.
        const a = Math.atan2(-y, x);
        const sector = Math.round(a / (Math.PI / 4));
        const map = { 0: 'R', 1: 'UR', 2: 'U', 3: 'UL', 4: 'L', '-4': 'L', '-3': 'DL', '-2': 'D', '-1': 'DR' };
        for (const c of map[sector]) held.add(c);
      }
    }
    const v = held.has('U') && !held.has('D') ? 'U' : held.has('D') && !held.has('U') ? 'D' : '';
    const h = held.has('L') && !held.has('R') ? 'L' : held.has('R') && !held.has('L') ? 'R' : '';
    return v + h;
  }

  function poll() {
    const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
    active = pads.find((p) => p.connected) ?? null;
    if (!active) {
      live.buttons = [];
      return;
    }
    const pad = active;
    live.name = pad.id;
    live.buttons = pad.buttons.map((b) => b.pressed || b.value > 0.5);
    live.axes = [pad.axes[0] ?? 0, pad.axes[1] ?? 0, pad.axes[2] ?? 0, pad.axes[3] ?? 0];
    const dir = dirOf(pad);
    live.dir = dir;
    // The pad's own timestamp is when this state was reported: use it for timing.
    const ts = pad.timestamp > 0 ? pad.timestamp : performance.now();
    const edges = [];
    live.buttons.forEach((on, i) => on && !prev[i] && edges.push(i));
    prev = live.buttons.slice();
    if (!edges.length) return;
    if (capture) {
      const fn = capture;
      capture = null;
      fn(edges[0]);
      return;
    }
    const m = settings.map;
    const card = cardOpen();
    for (const i of edges) {
      const is = (a) => m[a] === i;
      if (card) {
        // On a card: confirm/back; with a direction held, confirm marks that shot (feedback card).
        if (is('confirm')) {
          if (dir) onShot(dir, false, ts, false);
          else onKey('enter');
        } else if (is('special') && dir) onShot(dir, false, ts, true);
        else if (is('back')) onKey('pause');
        else if (is('tune')) onKey('tune');
        else if (is('pad')) onKey('pad');
        else if (is('help')) onKey('help');
        else if (is('replay')) onKey('replay');
        else if (is('scorecard')) onKey('scorecard');
        else if (is('camera')) onKey('camera');
        else if (is('skip')) onKey('skip');
        continue;
      }
      if (is('ground')) onShot(dir, false, ts, false);
      else if (is('lofted')) onShot(dir, true, ts, false);
      else if (is('special')) onShot(dir, false, ts, true);
      else if (is('skip')) onKey('skip');
      else if (is('pause')) onKey('pause');
      else if (is('camera')) onKey('camera');
      else if (is('feedback')) onKey('feedback');
      else if (is('tune')) onKey('tune');
      else if (is('help')) onKey('help');
      else if (is('pad')) onKey('pad');
      else if (is('replay')) onKey('replay');
      else if (is('scorecard')) onKey('scorecard');
      else if (is('confirm')) onKey('enter');
    }
  }

  return {
    poll,
    settings,
    live,
    save,
    get connected() {
      return !!active;
    },
    /** Next button pressed goes to fn(index) instead of the game. */
    capture(fn) {
      capture = fn;
    },
    cancelCapture() {
      capture = null;
    },
    get capturing() {
      return !!capture;
    },
    reset() {
      const d = JSON.parse(JSON.stringify(DEFAULTS));
      Object.assign(settings, d);
      save();
    },
  };
}
