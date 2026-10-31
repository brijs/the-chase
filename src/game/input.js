/**
 * Keyboard for the Chase. Arrows are held (8 directions); D plays the shot
 * along the ground, A lofts it, S plays a special (sweep / reverse sweep / scoop). The arrow set is read at the press, with a
 * 60 ms grace so an arrow that lands just after the shot key still counts.
 *
 * onShot(dirKey, lofted, eventTimeMs, special) — dirKey is '', 'D', 'DL', 'L', 'UL', 'U', 'UR', 'R', 'DR'
 * onKey(name, event) — enter, pause, camera, skip, help, guide, mute, tune, nets, 1-3, 7-9
 */
const ARROWS = { ArrowUp: 'U', ArrowDown: 'D', ArrowLeft: 'L', ArrowRight: 'R' };

export function dirKeyOf(held) {
  const v = held.has('U') && !held.has('D') ? 'U' : held.has('D') && !held.has('U') ? 'D' : '';
  const h = held.has('L') && !held.has('R') ? 'L' : held.has('R') && !held.has('L') ? 'R' : '';
  return v + h;
}

export function createInput({ onShot, onKey }) {
  const held = new Set();
  let pending = null;
  const fire = () => {
    if (!pending) return;
    const p = pending;
    pending = null;
    clearTimeout(p.timer);
    onShot(dirKeyOf(new Set([...p.held, ...held])), p.lofted, p.time, p.special);
  };
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey) return;
    if (ARROWS[e.key]) {
      e.preventDefault();
      held.add(ARROWS[e.key]);
      return;
    }
    if (e.repeat) return;
    const k = e.key.toLowerCase();
    if (k === 'd' || k === 'a' || k === 's') {
      e.preventDefault();
      if (pending) fire();
      // An arrow already held decides at once; with none, wait the grace period.
      pending = { held: new Set(held), lofted: k === 'a', special: k === 's', time: e.timeStamp };
      if (held.size) fire();
      else pending.timer = setTimeout(fire, 60);
      return;
    }
    const map = { enter: 'enter', p: 'pause', escape: 'pause', c: 'camera', ' ': 'skip', h: 'help', '?': 'help', g: 'guide', m: 'mute', t: 'tune', n: 'nets', k: 'pad', r: 'replay', b: 'scorecard', f: 'feedback', 1: '1', 2: '2', 3: '3', 7: '7', 8: '8', 9: '9', 4: '4', 5: '5', 6: '6', q: 'q', w: 'w', e: 'e', z: 'z', x: 'x' }; // (C stays 'camera'; the feedback card reads it as "too narrow")
    if (map[k]) {
      e.preventDefault();
      onKey(map[k], e);
    }
  });
  window.addEventListener('keyup', (e) => {
    if (ARROWS[e.key]) held.delete(ARROWS[e.key]);
  });
  window.addEventListener('blur', () => held.clear());
  return { held };
}
