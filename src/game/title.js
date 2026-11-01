/**
 * The title screen: what you see first. The camera drifts round the ground
 * high up (the director's 'orbit' shot) behind a card with the name, one line
 * on the game, Play and the keys. Enter, Space, a click or the pad's A plays;
 * N goes to the nets. Then the camera glides down to the broadcast end and the
 * match card (format, level, conditions, toss) takes over.
 */
const CSS = `
body.titling #hud > :not(#title) { visibility: hidden; }
#title { position: absolute; inset: 0; display: none; place-items: center; pointer-events: none; }
#title.on { display: grid; }
#title .t-card { pointer-events: auto; text-align: center; padding: 26px 34px 18px; max-width: min(560px, calc(100vw - 32px)); transition: opacity 0.45s, transform 0.45s; }
#title.out .t-card { opacity: 0; transform: translateY(-14px) scale(0.98); }
#title .mark { font: bold clamp(40px, 9vw, 74px)/0.95 ui-monospace, Menlo, monospace; letter-spacing: 0.08em; color: #1c2847; text-shadow: 4px 4px 0 #f3c94a, 8px 8px 0 #9a2731; margin: 4px 0 18px; }
#title .tag { font-size: 15px; color: #2a211c; margin: 0 0 4px; }
#title .sub { font-size: 12px; color: #6f6a55; margin: 0 0 18px; }
#title .play { font: bold 18px ui-monospace, Menlo, monospace; letter-spacing: 0.14em; color: #f6f2e6; background: #9a2731; border: 0; border-radius: 6px; padding: 12px 34px; cursor: pointer; box-shadow: 0 4px 0 #4f1219; animation: t-pulse 1.6s ease-in-out infinite; }
#title .play:active { transform: translateY(2px); box-shadow: 0 2px 0 #4f1219; }
@keyframes t-pulse { 50% { transform: scale(1.05); } }
#title .keys { display: flex; flex-wrap: wrap; justify-content: center; gap: 6px 14px; margin: 18px 0 10px; font-size: 11.5px; color: #4a4f3c; }
#title .keys b { color: #1c2847; background: #ebe4d0; border: 1px solid #c9bfa4; border-radius: 4px; padding: 0 5px; }
#title .links { font-size: 11.5px; color: #6f6a55; }
#title .links a, #title .links button { color: #283a63; background: none; border: 0; font: inherit; cursor: pointer; text-decoration: underline; padding: 0; }
`;

export function createTitle({ root, onPlay, onNets, onController, dioramaUrl }) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const el = document.createElement('div');
  el.id = 'title';
  el.innerHTML = `<div class="t-card panel">
      <div class="mark">THE<br>CHASE</div>
      <p class="tag">One target. Your timing.</p>
      <p class="sub">A pixel cricket game: you bat, the AI bowls pace and spin, sets the field and learns where you score.</p>
      <button class="play" data-act="play">PLAY</button>
      <div class="keys">
        <span><b>←↑→↓</b> direction</span><span><b>D</b> along the ground</span><span><b>A</b> lofted</span><span><b>S</b> specials</span><span><b>V</b> review</span><span><b>R</b> replay</span><span><b>B</b> scorecard</span><span><b>O</b> conditions</span>
      </div>
      <div class="links"><button data-act="nets">Nets (N)</button> · <button data-act="pad">🎮 Controller (K)</button> · <a href="${dioramaUrl}">The diorama</a> · Enter to play</div>
    </div>`;
  root.appendChild(el);
  let open = false;
  let leaving = false;
  el.querySelector('[data-act=play]').onclick = () => play();
  el.querySelector('[data-act=nets]').onclick = () => leave(onNets);
  el.querySelector('[data-act=pad]').onclick = () => onController?.();

  function leave(then) {
    if (!open || leaving) return;
    leaving = true;
    el.classList.add('out');
    setTimeout(() => {
      el.classList.remove('on', 'out');
      document.body.classList.remove('titling');
      open = false;
      leaving = false;
    }, 450);
    then?.();
  }
  function play() {
    leave(onPlay);
  }
  return {
    show() {
      open = true;
      el.classList.add('on');
      document.body.classList.add('titling');
    },
    play,
    /** Keys while it is up: true when used. */
    key(k) {
      if (!open) return false;
      if (k === 'enter' || k === 'skip') play();
      else if (k === 'nets') leave(onNets);
      else if (k === 'pad') onController?.();
      return true;
    },
    get isOpen() {
      return open;
    },
  };
}
