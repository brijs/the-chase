import { ACTIONS, buttonName } from './gamepad.js';

/**
 * The Controller panel (K, or the controller's own button for it): what is
 * connected, a live view of every button and the stick, and each action's
 * binding with Rebind (press the button you want) and Clear. Direction source
 * (D-pad / left stick / both) and the stick's dead zone. Saved in this browser.
 */
const CSS = `
#padp { position: absolute; left: 50%; top: 5vh; transform: translateX(-50%); width: min(640px, calc(100vw - 20px)); max-height: 90vh; overflow: auto; padding: 12px 16px; pointer-events: auto; display: none; font-size: 12px; z-index: 6; }
#padp.on { display: block; }
#padp h2 { margin: 0 0 2px; font-size: 16px; color: #1c2847; }
#padp .st { color: #6f6a55; margin-bottom: 8px; }
#padp .st b.ok { color: #2f8f86; } #padp .st b.no { color: #9a2731; }
#padp .live { display: flex; flex-wrap: wrap; gap: 3px; margin: 6px 0 10px; align-items: center; }
#padp .live span { padding: 2px 5px; border-radius: 4px; background: #ebe4d0; border: 1px solid #c9bfa4; font-size: 10.5px; }
#padp .live span.on { background: #2f8f86; border-color: #2f8f86; color: #f6f2e6; }
#padp .stick { width: 44px; height: 44px; border-radius: 50%; border: 1px solid #c9bfa4; position: relative; background: #ebe4d0; margin-left: 6px; }
#padp .stick i { position: absolute; width: 10px; height: 10px; border-radius: 50%; background: #9a2731; margin: -5px 0 0 -5px; }
#padp .stick u { position: absolute; inset: 0; border-radius: 50%; border: 1px dashed #b0a68a; }
#padp table { width: 100%; border-collapse: collapse; }
#padp td { padding: 4px 6px; border-top: 1px solid #ebe4d0; }
#padp td.k { color: #6f6a55; }
#padp td.b { font-weight: bold; color: #1c2847; }
#padp tr.hot td { background: #c9d86a; }
#padp tr.wait td.b { color: #9a2731; }
#padp button { font: inherit; color: inherit; background: #ebe4d0; border: 1px solid #c9bfa4; border-radius: 5px; padding: 3px 8px; cursor: pointer; }
#padp button.on { background: #283a63; border-color: #283a63; color: #f6f2e6; }
#padp .row { display: flex; gap: 8px; align-items: center; margin: 8px 0; flex-wrap: wrap; }
#padp .help { color: #6f6a55; }
`;

export function createGamepadPanel({ pad, ctl, root, onClose }) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const el = document.createElement('div');
  el.id = 'padp';
  el.className = 'panel';
  root.appendChild(el);
  let opened = false;
  let waiting = null; // action being rebound
  let prevPhase = null;
  let raf = 0;

  function draw() {
    const s = pad.settings;
    el.innerHTML = `<h2>Controller</h2>
      <div class="st">${pad.connected ? `<b class="ok">● connected</b> ${pad.live.name}` : '<b class="no">● no controller</b> — connect it (Bluetooth or USB) and press any button; browsers only report a pad after its first press'}</div>
      <div class="live" id="padp-live"></div>
      <div class="row"><span>Direction from</span>${[['both', 'D-pad and left stick'], ['dpad', 'D-pad only'], ['stick', 'Left stick only']].map(([k, n]) => `<button data-dir="${k}" class="${s.dirSource === k ? 'on' : ''}">${n}</button>`).join('')}</div>
      <div class="row"><span>Stick dead zone</span><input type="range" min="0.15" max="0.85" step="0.05" value="${s.deadzone}" data-dz><span>${s.deadzone.toFixed(2)}</span></div>
      <table>${ACTIONS.map(([id, label, key]) => `<tr data-a="${id}" class="${waiting === id ? 'wait' : ''}"><td>${label} <span class="k">(key ${key})</span></td><td class="b">${waiting === id ? 'press a button… (Esc cancels)' : buttonName(s.map[id])}</td><td><button data-rebind="${id}">Rebind</button> <button data-clear="${id}">Clear</button></td></tr>`).join('')}</table>
      <div class="row"><button data-act="reset">Reset to defaults</button><button data-act="close">Close (K)</button>
      <span class="help">A button can serve a shot and Confirm: on cards, Confirm and Back apply; with a direction held, Confirm marks that shot on the feedback card.</span></div>`;
    drawLive();
  }
  function drawLive() {
    const box = el.querySelector('#padp-live');
    if (!box) return;
    const b = pad.live.buttons;
    const hotIdx = new Set(b.map((on, i) => (on ? i : -1)).filter((i) => i >= 0));
    box.innerHTML = (b.length ? b.map((on, i) => `<span class="${on ? 'on' : ''}">${buttonName(i)}</span>`).join('') : '<span>—</span>') +
      `<div class="stick" title="left stick (dashed: dead zone)"><u style="inset:${((1 - pad.settings.deadzone) * 50).toFixed(0)}%"></u><i style="left:${(50 + pad.live.axes[0] * 50).toFixed(0)}%;top:${(50 + pad.live.axes[1] * 50).toFixed(0)}%"></i></div>` +
      `<span>direction: <b>${pad.live.dir || 'none'}</b></span>`;
    for (const tr of el.querySelectorAll('tr[data-a]')) tr.classList.toggle('hot', hotIdx.has(pad.settings.map[tr.dataset.a]));
  }
  const loop = () => {
    if (!opened) return;
    drawLive(); // the game loop polls the pad
    raf = requestAnimationFrame(loop);
  };

  el.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    b.blur();
    const s = pad.settings;
    if (b.dataset.rebind) {
      waiting = b.dataset.rebind;
      pad.capture((i) => {
        // One button, one action (Confirm/Back may share with a shot button).
        const shareable = ['confirm', 'back'];
        for (const [a] of ACTIONS) if (a !== waiting && s.map[a] === i && !(shareable.includes(a) || shareable.includes(waiting))) s.map[a] = null;
        s.map[waiting] = i;
        waiting = null;
        pad.save();
        draw();
      });
    } else if (b.dataset.clear) {
      s.map[b.dataset.clear] = null;
      pad.save();
    } else if (b.dataset.dir) {
      s.dirSource = b.dataset.dir;
      pad.save();
    } else if (b.dataset.act === 'reset') pad.reset();
    else if (b.dataset.act === 'close') return close();
    draw();
  });
  el.addEventListener('input', (e) => {
    if (e.target.dataset.dz === undefined) return;
    pad.settings.deadzone = +e.target.value;
    pad.save();
    e.target.nextElementSibling.textContent = pad.settings.deadzone.toFixed(2);
  });

  function open() {
    opened = true;
    if (['live', 'ending', 'paused'].includes(ctl.phase)) {
      prevPhase = ctl.phase;
      ctl.phase = 'tuning';
    }
    el.classList.add('on');
    draw();
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(loop);
  }
  function close() {
    opened = false;
    waiting = null;
    pad.cancelCapture();
    el.classList.remove('on');
    if (ctl.phase === 'tuning' && prevPhase) ctl.phase = prevPhase;
    prevPhase = null;
    onClose?.();
  }
  return {
    open,
    close,
    toggle: () => (opened ? close() : open()),
    get isOpen() {
      return opened;
    },
    /** Esc while rebinding cancels the rebind rather than closing. */
    escape() {
      if (waiting) {
        waiting = null;
        pad.cancelCapture();
        draw();
        return true;
      }
      close();
      return true;
    },
  };
}
