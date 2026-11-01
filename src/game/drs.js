import * as THREE from 'three';
import { BALL_REAL_R, STUMPS_X } from './rules.js';
import { BALL_R, PITCH } from '../config.js';
import { ZONE_HALF, ZONE_TOP, snickEvents } from './umpire.js';

/**
 * The Decision Review System, for the batter.
 *
 * Given out LBW, or caught off a faint edge (or off nothing), the game holds
 * and offers a review: 10 seconds, V / Enter (controller: Confirm) to review,
 * Esc / Space (Back) to walk. Three reviews an innings; one that comes back as
 * umpire's call is kept. Then the third umpire goes through it, on the frozen
 * field rendered at past times, with its own camera:
 *
 *   replay       the delivery again from the broadcast end, at half speed
 *   UltraEdge    side-on at the bat in slow motion, the snickometer trace
 *                underneath: flat, a sharp spike for bat, a broad hump for pad
 *   ball tracking (LBW) the path drawn in red from the hand, the pitching zone
 *                on the strip (in line blue, outside leg red), where it pitched,
 *                where it hit the pad, then the projection in blue on to the
 *                wicket zone (the stumps to the top of the bails, with the
 *                umpire's-call margin of one ball outside it)
 *   decision     OUT / NOT OUT, and why; the crowd's answer
 *
 * Sound throughout: the sting, a low pulse while it is checked, a bleep for
 * each reveal, a riser into the decision.
 */
const CSS = `
#drs-offer, #drs-head, #drs-rows, #drs-step, #drs-big, #drs-snick { position: absolute; display: none; z-index: 7; color: #f6f2e6; font-family: ui-monospace, Menlo, monospace; }
#drs-offer { left: 50%; bottom: 70px; transform: translateX(-50%); background: #1c2847; border: 2px solid #f3c94a; border-radius: 8px; padding: 10px 18px 12px; text-align: center; min-width: 300px; pointer-events: auto; }
#drs-offer .given { font-size: 13px; letter-spacing: 0.08em; color: #f3c94a; }
#drs-offer .ask { font-size: 22px; font-weight: bold; margin: 4px 0 6px; letter-spacing: 0.06em; }
#drs-offer .ask b { color: #f3c94a; }
#drs-offer .bar { height: 6px; background: #3b4a75; border-radius: 3px; overflow: hidden; }
#drs-offer .bar i { display: block; height: 100%; background: #f3c94a; transform-origin: left; }
#drs-offer .bar i.hot { background: #c13a3c; }
#drs-offer .row { display: flex; justify-content: space-between; gap: 14px; margin-top: 6px; font-size: 12px; color: #c9d0e6; }
#drs-offer .secs { font-size: 18px; color: #f6f2e6; font-weight: bold; }
#drs-offer button { font: inherit; color: #1c2847; background: #f3c94a; border: 0; border-radius: 5px; padding: 4px 10px; cursor: pointer; font-weight: bold; }
#drs-offer button.walk { background: #3b4a75; color: #f6f2e6; }
.drs-dots span { display: inline-block; width: 9px; height: 9px; border-radius: 50%; background: #f3c94a; margin-left: 3px; }
.drs-dots span.used { background: #3b4a75; }
#drs-head { left: 12px; top: 12px; background: #1c2847; border-left: 5px solid #f3c94a; padding: 7px 12px; border-radius: 4px; }
#drs-head .t { font-size: 15px; font-weight: bold; letter-spacing: 0.14em; }
#drs-head .s { font-size: 11.5px; color: #c9d0e6; margin-top: 3px; }
#drs-rows { right: 12px; top: 12px; background: rgba(28,40,71,0.94); border-radius: 6px; padding: 6px 8px; min-width: 230px; }
#drs-rows .r { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 5px 4px; border-bottom: 1px solid #3b4a75; font-size: 12.5px; letter-spacing: 0.06em; }
#drs-rows .r:last-child { border-bottom: 0; }
#drs-rows .v { padding: 2px 8px; border-radius: 3px; font-weight: bold; font-size: 11.5px; min-width: 96px; text-align: center; background: #3b4a75; color: #c9d0e6; }
#drs-rows .v.out { background: #c13a3c; color: #fff; }
#drs-rows .v.ok { background: #2f8f86; color: #fff; }
#drs-rows .v.uc { background: #e39a2e; color: #1c2847; }
#drs-rows .v.wait { animation: drsblink 0.6s infinite alternate; }
@keyframes drsblink { from { opacity: 0.45; } to { opacity: 1; } }
#drs-step { left: 50%; top: 62px; transform: translateX(-50%); background: #1c2847; padding: 6px 16px; border-radius: 4px; font-size: 14px; letter-spacing: 0.16em; font-weight: bold; }
#drs-step small { display: block; font-size: 11px; letter-spacing: 0.06em; color: #c9d0e6; font-weight: normal; text-align: center; margin-top: 2px; }
#drs-snick { left: 50%; bottom: 16px; transform: translateX(-50%); background: #10182e; border: 1px solid #3b4a75; border-radius: 6px; padding: 6px 8px 4px; }
#drs-snick .k { font-size: 10.5px; letter-spacing: 0.12em; color: #c9d0e6; display: flex; justify-content: space-between; }
#drs-big { left: 50%; top: 42%; transform: translate(-50%, -50%) scale(0.9); text-align: center; opacity: 0; transition: opacity 0.25s, transform 0.25s; }
#drs-big.on { opacity: 1; transform: translate(-50%, -50%) scale(1); }
#drs-big .d { display: inline-block; font-size: 54px; font-weight: bold; letter-spacing: 0.1em; padding: 8px 28px; border-radius: 6px; background: #c13a3c; color: #fff; box-shadow: 0 4px 0 rgba(0,0,0,0.25); }
#drs-big .d.ok { background: #2f8f86; }
#drs-big .why { margin-top: 10px; font-size: 15px; letter-spacing: 0.08em; background: #1c2847; display: inline-block; padding: 5px 14px; border-radius: 4px; }
@media (max-width: 620px) { #drs-rows { top: auto; bottom: 120px; right: 8px; min-width: 180px; } #drs-big .d { font-size: 36px; } }
`;

const RED = 0xc13a3c;
const GREEN = 0x2f8f86;
const AMBER = 0xe39a2e;
const BLUE = 0x3a83c6;
const OFFER_SECS = 10;
const realPos = (p) => new THREE.Vector3(p.x, p.y - (BALL_R - BALL_REAL_R), p.z);
const lerp = (a, b, k) => a + (b - a) * k;
const clamp01 = (u) => Math.min(1, Math.max(0, u));
const ease = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));

/** What each finding reads as, and its colour: out (for the bowler), ok (for the batter), uc (umpire's call). */
const LABEL = {
  pitching: { inline: ['IN LINE', 'out'], outsideOff: ['OUTSIDE OFF', 'out'], outsideLeg: ['OUTSIDE LEG', 'ok'], full: ['FULL TOSS', 'out'] },
  impact: { inline: ['IN LINE', 'out'], umpiresCall: ["UMPIRE'S CALL", 'uc'], outside: ['OUTSIDE', 'ok'] },
  wickets: { hitting: ['HITTING', 'out'], umpiresCall: ["UMPIRE'S CALL", 'uc'], missing: ['MISSING', 'ok'] },
};
const TONE = { out: RED, ok: GREEN, uc: AMBER };

export function createDrs({ ctl, scene, camera, root, audio, aspect, fx }) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const mk = (id, cls = '') => {
    const el = document.createElement('div');
    el.id = id;
    if (cls) el.className = cls;
    root.appendChild(el);
    return el;
  };
  const offerEl = mk('drs-offer');
  const headEl = mk('drs-head');
  const rowsEl = mk('drs-rows');
  const stepEl = mk('drs-step');
  const bigEl = mk('drs-big');
  const snickEl = mk('drs-snick');
  snickEl.innerHTML = `<div class="k"><span>ULTRAEDGE</span><span id="drs-snick-t"></span></div><canvas width="520" height="84"></canvas>`;
  const snickCanvas = snickEl.querySelector('canvas');
  const show = (el, on) => (el.style.display = on ? 'block' : 'none');

  // ---------------------------------------------------------------- 3D overlays
  const g = new THREE.Group();
  g.visible = false;
  scene.add(g);
  const basic = (color, opacity = 1) => new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, depthWrite: opacity >= 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const flat = (w, d, mat, x, z, y = 0.018) => {
    const geo = new THREE.PlaneGeometry(w, d);
    geo.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    return m;
  };
  // The pitching zone: in line with the stumps from wicket to wicket, and outside leg.
  const pitchLen = PITCH.bowlerStumps - STUMPS_X;
  const pitchMid = (PITCH.bowlerStumps + STUMPS_X) / 2;
  const zone = new THREE.Group();
  const zoneMat = basic(BLUE, 0.4);
  const legMat = basic(RED, 0.3);
  zone.add(flat(pitchLen, ZONE_HALF * 2, zoneMat, pitchMid, 0));
  zone.add(flat(pitchLen, 0.7, legMat, pitchMid, -ZONE_HALF - 0.35));
  for (const z of [-ZONE_HALF, ZONE_HALF]) zone.add(flat(pitchLen, 0.022, basic(0xf6f2e6), pitchMid, z, 0.02));
  g.add(zone);
  // The wicket zone at the striker's stumps, and the umpire's-call margin around it.
  const wz = new THREE.Group();
  const wzMat = basic(BLUE, 0.35);
  const wzPlane = new THREE.Mesh(new THREE.PlaneGeometry(ZONE_HALF * 2, ZONE_TOP), wzMat);
  wzPlane.rotation.y = Math.PI / 2;
  wzPlane.position.set(STUMPS_X + 0.02, ZONE_TOP / 2, 0);
  wz.add(wzPlane);
  const ucPts = [[-1, 0], [-1, 1], [1, 1], [1, 0]].map(([sz, sy]) => new THREE.Vector3(STUMPS_X + 0.03, sy ? ZONE_TOP + BALL_REAL_R : 0.002, sz * (ZONE_HALF + BALL_REAL_R)));
  const ucLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(ucPts), new THREE.LineBasicMaterial({ color: AMBER }));
  wz.add(ucLine);
  g.add(wz);
  // The track: drawn path (red), projection (blue), the tracked ball, the marks.
  let tube = null;
  let projTube = null;
  const trackBall = new THREE.Mesh(new THREE.SphereGeometry(BALL_REAL_R * 1.5, 14, 10), basic(RED));
  const ghost = new THREE.Mesh(new THREE.SphereGeometry(BALL_REAL_R, 16, 12), basic(RED, 0.85));
  const bounceGeo = new THREE.CircleGeometry(0.085, 20);
  bounceGeo.rotateX(-Math.PI / 2);
  const bounceMark = new THREE.Mesh(bounceGeo, basic(RED));
  const impactGeo = new THREE.RingGeometry(0.05, 0.09, 24);
  impactGeo.rotateY(Math.PI / 2);
  const impactMark = new THREE.Mesh(impactGeo, new THREE.MeshBasicMaterial({ color: RED, side: THREE.DoubleSide }));
  g.add(trackBall, ghost, bounceMark, impactMark);

  function buildTube(fn, t0, t1, color, opacity) {
    const pts = [];
    for (let k = 0; k <= 60; k++) pts.push(realPos(fn(t0 + ((t1 - t0) * k) / 60)));
    const curve = new THREE.CatmullRomCurve3(pts);
    const geo = new THREE.TubeGeometry(curve, 120, 0.024, 8, false);
    const mesh = new THREE.Mesh(geo, basic(color, opacity));
    mesh.userData.total = 120 * 8 * 6;
    geo.setDrawRange(0, 0);
    g.add(mesh);
    return mesh;
  }
  const grow = (mesh, u) => mesh && mesh.geometry.setDrawRange(0, Math.floor(clamp01(u) * 120) * 8 * 6);
  const tint = (mesh, color) => mesh.material.color.setHex(color);

  // ---------------------------------------------------------------- state
  let offer = null; // { left, o, cur }
  let seq = null; // the running review
  let pulseT = 0;
  const api = {
    tView: 0,
    get offering() {
      return !!offer;
    },
    get active() {
      return !!seq;
    },
    get busy() {
      return !!offer || !!seq;
    },
  };

  const dots = (left) => (left === Infinity ? '<span>∞</span>' : [0, 1, 2].map((i) => `<span class="${i < left ? '' : 'used'}"></span>`).join(''));
  const givenText = (o) => (o.umpire.kind === 'lbw' ? 'OUT · LBW' : o.fielding?.by === 'keeper' ? 'OUT · CAUGHT BEHIND' : `OUT · CAUGHT ${(o.fielding?.name ?? '').replace('the ', '').toUpperCase()}`);

  // ---------------------------------------------------------------- the offer
  api.offer = ({ o, cur, reviewsLeft }) => {
    offer = { o, cur, left: OFFER_SECS, lastTick: OFFER_SECS + 1, reviewsLeft };
    offerEl.innerHTML = `<div class="given">${givenText(o)}</div>
      <div class="ask">REVIEW? <b>V</b></div>
      <div class="bar"><i></i></div>
      <div class="row"><span>Reviews <span class="drs-dots">${dots(reviewsLeft)}</span></span><span class="secs">10</span></div>
      <div class="row" style="justify-content:center;margin-top:8px"><button data-a="review">Review (V / Enter)</button><button class="walk" data-a="walk">Walk off (Esc)</button></div>`;
    offerEl.querySelector('[data-a=review]').onclick = () => api.review();
    offerEl.querySelector('[data-a=walk]').onclick = () => api.accept();
    show(offerEl, true);
    audio.play('drsSting', { soft: true });
  };
  function updateOffer(dt) {
    offer.left -= dt;
    const secs = Math.max(0, Math.ceil(offer.left));
    if (secs < offer.lastTick) {
      offer.lastTick = secs;
      if (secs > 0) audio.play('tick', { hot: secs <= 3 });
    }
    const bar = offerEl.querySelector('.bar i');
    bar.style.transform = `scaleX(${clamp01(offer.left / OFFER_SECS)})`;
    bar.classList.toggle('hot', offer.left <= 3);
    offerEl.querySelector('.secs').textContent = secs;
    if (offer.left <= 0) api.accept();
  }
  api.accept = () => {
    if (!offer) return;
    offer = null;
    show(offerEl, false);
    ctl.settleReview('accept');
  };

  // ---------------------------------------------------------------- the review
  api.review = () => {
    if (!offer) return;
    const { o, cur } = offer;
    offer = null;
    show(offerEl, false);
    ctl.phase = 'drs';
    seq = buildReview(o, cur);
    seq.i = -1;
    next();
    g.visible = true;
    show(headEl, true);
    show(rowsEl, true);
    show(stepEl, true);
    headEl.innerHTML = `<div class="t">DECISION REVIEW</div><div class="s">${o.umpire.kind === 'lbw' ? 'LBW' : 'CAUGHT'} · on-field decision <b style="color:#f3c94a">OUT</b> · batter's review</div>`;
    drawRows();
    audio.play('drsSting');
    pulseT = 0.6;
  };

  function buildReview(o, cur) {
    const u = o.umpire;
    const del = cur.del;
    const tR = cur.tR;
    const lbw = u.kind === 'lbw' ? u : null;
    const offered = o.kind === 'miss';
    const ev = snickEvents(o, del);
    // When the ball passes the bat: contact for an edge, the pad for an LBW, or the take for a phantom.
    const tPass = o.kind === 'hit' ? o.shot.tContact : lbw ? lbw.track.tPad : del.contactTime(o.foot ?? 'front');
    const s = { o, cur, del, tR, u, lbw, ev, tPass, rows: [], steps: [], t: 0, result: null };
    if (lbw) {
      if (offered) s.rows.push({ id: 'bat', name: 'BAT', v: null });
      s.rows.push({ id: 'pitching', name: 'PITCHING', v: null }, { id: 'impact', name: 'IMPACT', v: null }, { id: 'wickets', name: 'WICKETS', v: null });
    } else s.rows.push({ id: 'edge', name: 'EDGE', v: null });

    const setRow = (id, text, tone) => {
      const r = s.rows.find((x) => x.id === id);
      r.v = [text, tone];
      drawRows();
      audio.play('drsReveal', { good: tone === 'ok', uc: tone === 'uc' });
    };
    const wait = (id) => {
      const r = s.rows.find((x) => x.id === id);
      if (r && !r.v) r.wait = true;
      drawRows();
    };

    // 1. The replay: the delivery again from the broadcast end, at half speed.
    const tEnd = tPass + 0.35;
    s.steps.push({
      title: 'REPLAY',
      sub: 'third umpire checking',
      dur: Math.min(3.2, (tEnd + 0.3) / 0.5),
      view: (k) => ({ tView: tR - 0.3 + (tEnd + 0.3) * k, pos: [31, 6.5, 0.6], target: [-4.5, 0.4, 0.1], fov: 16.5 - 3 * ease(k) }),
    });

    // 2. UltraEdge: side-on at the bat, slow motion, with the trace.
    const P = realPos(del.pos(tPass));
    const edgeFound = ev.some((e) => e.kind === 'bat');
    s.steps.push({
      title: 'ULTRAEDGE',
      sub: lbw ? 'bat or pad first?' : 'any sound as it passes the bat?',
      dur: 5.2,
      start: () => {
        wait(lbw ? 'bat' : 'edge');
        show(snickEl, true);
        audio.play('drsWhir');
      },
      end: () => show(snickEl, false),
      view: (k) => {
        const tv = tR + tPass - 0.2 + 0.36 * k;
        return { tView: tv, pos: [P.x + 0.3, 0.85, P.z + 4.4 - 1.0 * ease(k)], target: [P.x + 0.35, 0.62, P.z], fov: 30 - 9 * ease(k) };
      },
      snick: true,
      skip: lbw && !offered,
      reveal: [[0.86, () => (lbw ? setRow('bat', lbw.batFirst ? 'BAT FIRST' : 'NO BAT', lbw.batFirst ? 'ok' : 'out') : setRow('edge', edgeFound ? 'EDGE · SPIKE' : 'NO EDGE', edgeFound ? 'out' : 'ok'))]],
    });

    if (lbw) {
      const tr = lbw.track;
      const tB = tr.tBounce ?? tr.tPad * 0.75;
      const B = tr.bounce ? realPos(tr.bounce) : realPos(del.pos(tB));
      const I = realPos(tr.pad);
      const W = new THREE.Vector3(STUMPS_X, tr.atStumps.y, tr.atStumps.z);
      s.onStart = () => {
        tube = buildTube(del.pos, 0, tr.tPad, RED, 1);
        projTube = buildTube(del.pos, tr.tPad, tr.tStumps + 0.02, BLUE, 0.75);
        bounceMark.position.set(B.x, 0.024, B.z);
        impactMark.position.copy(I);
        ghost.position.copy(W);
      };
      // 3. Ball tracking: from the hand to the pitch.
      s.steps.push({
        title: 'BALL TRACKING',
        sub: 'where did it pitch?',
        dur: 3.4,
        start: () => {
          wait('pitching');
          audio.play('drsWhir');
        },
        view: (k) => {
          const u2 = clamp01(k / 0.6);
          return { tView: tR + tB * u2, pos: [lerp(15, 6, ease(k)), lerp(3.6, 3.0, k), lerp(0.6, 0.9, k)], target: [lerp(2, B.x - 1.5, ease(k)), 0, lerp(0.2, B.z, ease(k))], fov: lerp(24, 18, ease(k)), track: (u2 * tB) / tr.tPad, ball: tB * u2 };
        },
        vis: { zone: true, tube: true, ball: true, bounce: (k) => k > 0.62 },
        reveal: [[0.66, () => {
          const [txt, tone] = LABEL.pitching[tr.pitching];
          tint(bounceMark, TONE[tone]);
          setRow('pitching', txt, tone);
        }]],
      });
      // 4. On to the pad.
      s.steps.push({
        title: 'BALL TRACKING',
        sub: 'where did it hit the batter?',
        dur: 3.0,
        start: () => wait('impact'),
        view: (k) => {
          const u2 = clamp01(k / 0.55);
          const tb = lerp(tB, tr.tPad, u2);
          return { tView: tR + tb, pos: [I.x + lerp(6.5, 3.2, ease(k)), lerp(1.6, 0.95, ease(k)), I.z + lerp(0.9, 1.3, ease(k))], target: [I.x, lerp(0.4, I.y * 0.9, ease(k)), I.z], fov: lerp(20, 16, ease(k)), track: tb / tr.tPad, ball: tb };
        },
        vis: { zone: true, tube: true, ball: true, bounce: true, impact: (k) => k > 0.6 },
        reveal: [[0.66, () => {
          const [txt, tone] = LABEL.impact[tr.impact];
          tint(impactMark, TONE[tone]);
          setRow('impact', tr.noShotOff ? 'OUTSIDE · NO SHOT' : txt, tone);
        }]],
      });
      // 5. The projection on to the stumps, from behind them.
      s.steps.push({
        title: 'BALL TRACKING',
        sub: 'would it have hit the stumps?',
        dur: 4.0,
        start: () => {
          wait('wickets');
          audio.play('drsWhir');
        },
        view: (k) => {
          const u2 = clamp01((k - 0.08) / 0.55);
          const tb = lerp(tr.tPad, tr.tStumps, u2);
          return { tView: tR + tr.tPad, pos: [STUMPS_X - lerp(3.4, 2.1, ease(k)), lerp(1.3, 0.85, ease(k)), lerp(1.4, 0.55, ease(k))], target: [STUMPS_X + 0.6, 0.38, 0.05], fov: lerp(30, 22, ease(k)), proj: u2, ball: tb, hideBall: true };
        },
        vis: { zone: true, tube: true, proj: true, ball: true, wz: true, bounce: true, impact: true, ghost: (k) => k > 0.66 },
        reveal: [[0.7, () => {
          const [txt, tone] = LABEL.wickets[tr.wickets];
          tint(ghost, TONE[tone]);
          wzMat.color.setHex(TONE[tone]);
          setRow('wickets', txt, tone);
        }]],
      });
    }

    // 6. The decision: the whole picture, a riser, then the call.
    s.steps.push({
      title: 'THIRD UMPIRE',
      sub: 'decision',
      dur: 5.2,
      start: () => {
        audio.play('drsRiser');
        s.result = ctl.m.review(o);
      },
      view: (k) => (lbw
        ? { tView: tR + lbw.track.tPad, pos: [lerp(-2, 0, k), lerp(4.2, 5.2, k), lerp(5.8, 7.2, k)], target: [-4.5, 0.2, 0], fov: 34, proj: 1, track: 1, ball: lbw.track.tStumps, hideBall: true }
        : { tView: tR + tPass + 0.15, pos: [P.x + lerp(3.5, 4.5, k), 1.6, P.z + lerp(3.2, 4.0, k)], target: [P.x - 0.6, 0.6, P.z], fov: 30 }),
      vis: lbw ? { zone: true, tube: true, proj: true, ball: true, wz: true, bounce: true, impact: true, ghost: true } : {},
      reveal: [[0.26, () => decide(s)]],
    });
    s.steps = s.steps.filter((x) => !x.skip);
    return s;
  }

  function decide(s) {
    const r = s.result;
    const notOut = r.overturned;
    const why = notOut ? 'DECISION OVERTURNED' : r.umpiresCall ? "UMPIRE'S CALL · REVIEW RETAINED" : 'ORIGINAL DECISION STANDS · REVIEW LOST';
    bigEl.innerHTML = `<div class="d ${notOut ? 'ok' : ''}">${notOut ? 'NOT OUT' : 'OUT'}</div><br><div class="why">${why}</div>`;
    show(bigEl, true);
    requestAnimationFrame(() => bigEl.classList.add('on'));
    audio.play('drsVerdict', { good: notOut });
    // The crowd is with the batter.
    if (notOut) {
      audio.play('cheer', { size: 1 });
      audio.play('applause', { size: 0.6 }, 0.6);
    } else if (r.umpiresCall) {
      audio.play('boo', { size: 1 });
      audio.play('ooh', { size: 0.8 });
    } else {
      audio.play('ooh', { size: 0.9 });
      audio.play('boo', { size: 0.55 }, 0.35);
    }
  }

  function drawRows() {
    if (!seq) return;
    rowsEl.innerHTML = seq.rows.map((r) => `<div class="r"><span>${r.name}</span><span class="v ${r.v ? r.v[1] : r.wait ? 'wait' : ''}">${r.v ? r.v[0] : r.wait ? 'CHECKING' : '—'}</span></div>`).join('');
  }

  function next() {
    const s = seq;
    s.steps[s.i]?.end?.();
    s.i++;
    s.t = 0;
    if (s.i === 0) s.onStart?.();
    const st = s.steps[s.i];
    if (!st) return finish();
    st.fired = 0;
    stepEl.innerHTML = `${st.title}<small>${st.sub}</small>`;
    st.start?.();
  }

  function finish() {
    const s = seq;
    seq = null;
    for (const el of [headEl, rowsEl, stepEl, snickEl]) show(el, false);
    bigEl.classList.remove('on');
    show(bigEl, false);
    g.visible = false;
    for (const m of [tube, projTube]) {
      if (!m) continue;
      g.remove(m);
      m.geometry.dispose();
      m.material.dispose();
    }
    tube = projTube = null;
    tint(bounceMark, RED);
    tint(impactMark, RED);
    tint(ghost, RED);
    wzMat.color.setHex(BLUE);
    ctl.settleReview(s.result ?? ctl.m.review(s.o));
  }

  // ---------------------------------------------------------------- per frame
  api.update = (dt) => {
    if (offer) return updateOffer(dt);
    if (!seq) return;
    const st = seq.steps[seq.i];
    seq.t += dt;
    const k = clamp01(seq.t / st.dur);
    while (st.reveal && st.fired < st.reveal.length && k >= st.reveal[st.fired][0]) st.reveal[st.fired++][1]();
    // The low pulse while it is being checked (not once the decision is up).
    pulseT -= dt;
    if (pulseT <= 0 && !(st.title === 'THIRD UMPIRE' && k > 0.26)) {
      audio.play('drsPulse');
      pulseT = 0.85;
    }
    if (st.snick) drawSnick(st, k);
    if (seq.t >= st.dur) next();
  };

  /** Space during a review: straight to the decision. */
  api.skip = () => {
    if (!seq) return;
    while (seq && seq.steps[seq.i] && seq.steps[seq.i].title !== 'THIRD UMPIRE') {
      const st = seq.steps[seq.i];
      while (st.reveal && st.fired < st.reveal.length) st.reveal[st.fired++][1]();
      next();
    }
  };

  /** Camera and overlays for the current moment; call before rendering. */
  api.apply = () => {
    if (!seq) return;
    const st = seq.steps[seq.i];
    if (!st) return;
    const k = clamp01(seq.t / st.dur);
    const v = st.view(k);
    api.tView = v.tView;
    camera.position.set(...v.pos);
    camera.fov = v.fov * Math.max(1, 1.45 / Math.max(0.5, aspect()));
    camera.aspect = aspect();
    camera.near = 0.05;
    camera.far = 260;
    camera.lookAt(new THREE.Vector3(...v.target));
    camera.updateProjectionMatrix();
    const vis = st.vis ?? {};
    const on = (x) => (typeof x === 'function' ? x(k) : !!x);
    zone.visible = on(vis.zone);
    wz.visible = on(vis.wz);
    bounceMark.visible = on(vis.bounce) && !!seq.lbw?.track.bounce;
    impactMark.visible = on(vis.impact);
    ghost.visible = on(vis.ghost);
    if (tube) {
      tube.visible = on(vis.tube);
      grow(tube, v.track ?? (vis.proj ? 1 : 0));
    }
    if (projTube) {
      projTube.visible = on(vis.proj);
      grow(projTube, v.proj ?? 0);
    }
    trackBall.visible = on(vis.ball) && v.ball != null;
    if (trackBall.visible) {
      trackBall.position.copy(realPos(seq.del.pos(v.ball)));
      const proj = seq.lbw && v.ball > seq.lbw.track.tPad;
      trackBall.material.color.setHex(proj ? BLUE : RED);
    }
    api.hideBall = !!(vis.ball || v.hideBall);
  };
  /** After the field is drawn: the real ball gives way to the tracked one. */
  api.afterRender = () => {
    if (seq && api.hideBall) {
      fx.ball.visible = false;
      if (fx.ballShadow) fx.ballShadow.visible = false;
      for (const tr of fx.trail ?? []) tr.visible = false;
    }
  };

  // ---------------------------------------------------------------- snickometer
  function drawSnick(st, k) {
    const s = seq;
    const c = snickCanvas.getContext('2d');
    const W = snickCanvas.width;
    const H = snickCanvas.height;
    c.fillStyle = '#10182e';
    c.fillRect(0, 0, W, H);
    c.strokeStyle = '#26345c';
    c.lineWidth = 1;
    for (let x = 0; x < W; x += 40) {
      c.beginPath();
      c.moveTo(x + 0.5, 0);
      c.lineTo(x + 0.5, H);
      c.stroke();
    }
    // The window is the same 0.36 s the camera plays.
    const t0 = s.tPass - 0.2;
    const span = 0.36;
    const tNow = t0 + span * k;
    const mid = H / 2;
    const amp = (t) => {
      // A quiet floor with a little hiss, and the events: bat is a sharp spike, pad a broad hump.
      let a = 0.035 * Math.sin(t * 5300) * Math.sin(t * 1370 + 1.3) + 0.025 * Math.sin(t * 9100 + 0.7);
      for (const e of s.ev) {
        const d = t - e.t;
        if (d < 0) continue;
        if (e.kind === 'bat') a += Math.exp(-d / 0.0035) * Math.sin(d * 11000) * 0.95;
        else a += Math.exp(-d / 0.02) * Math.sin(d * 1900) * 0.55 * Math.min(1, d / 0.004);
      }
      return a;
    };
    c.strokeStyle = '#7fd4c8';
    c.lineWidth = 1.5;
    c.beginPath();
    const xs = Math.floor(((tNow - t0) / span) * W);
    for (let x = 0; x <= xs; x++) {
      const t = t0 + (x / W) * span;
      const y = mid - amp(t) * (mid - 4);
      if (x === 0) c.moveTo(x, y);
      else c.lineTo(x, y);
    }
    c.stroke();
    // The moment the ball passes the bat.
    const xp = ((s.tPass - t0) / span) * W;
    c.strokeStyle = 'rgba(243,201,74,0.6)';
    c.setLineDash([4, 3]);
    c.beginPath();
    c.moveTo(xp, 0);
    c.lineTo(xp, H);
    c.stroke();
    c.setLineDash([]);
    c.fillStyle = '#f3c94a';
    c.font = '10px ui-monospace, Menlo, monospace';
    c.fillText(s.lbw ? 'pad' : 'bat', xp + 4, 11);
    snickEl.querySelector('#drs-snick-t').textContent = `${((tNow - s.tPass) * 1000).toFixed(0)} ms`;
  }

  /** QA: where the review is. */
  api.state = () => (offer ? { offer: true, left: offer.left } : seq ? { step: seq.i, title: seq.steps[seq.i]?.title, sub: seq.steps[seq.i]?.sub, rows: seq.rows.map((r) => [r.id, r.v?.[0] ?? null]), result: seq.result } : null);

  /** Keys while the offer or a review is up. Returns true when handled. */
  api.key = (k) => {
    if (offer) {
      if (k === 'review' || k === 'enter') api.review();
      else if (k === 'pause' || k === 'skip') api.accept();
      return true;
    }
    if (seq) {
      if (k === 'skip' || k === 'enter') api.skip();
      return true;
    }
    return false;
  };
  return api;
}
