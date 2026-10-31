/**
 * Turn one nets ball and your answers into small, bounded nudges.
 *
 *   sample   what happened (see sampleOf in calibration.js):
 *            { rawErr, err, sigma, perfect, miss, timing, kind, edge, fit, shotKey,
 *              lofted, length, ballZ, out, fieldType, runs, q }
 *   answers  { timing: -1 | 0 | 1 | null   (felt early / right / late)
 *              outcome: -1 | 0 | 1 | null  (too harsh / fair / too kind)
 *              ideal: [shotKey], good: [shotKey]    (the shots the ball wanted / that are OK)
 *              dir: radians | null                  (where the shot should have gone)
 *              power: -1 | 0 | 1 | null             (too soft / right / too hard)
 *              height: -1 | 0 | 1 | null            (too flat / right / too high)
 *              spread: 1 | 0 | -1 | null }          (too wide / right / too narrow)
 *
 * Returns [{ id, to, reason }]; the caller applies them through tuning.set,
 * which clamps to each parameter's range. Every rule is a small step so no
 * single ball moves the game much; a pattern of answers does.
 */
export function nudges(sample, answers, get) {
  const out = [];
  const push = (id, to, reason) => out.push({ id, to, reason });
  const mul = (id, f, reason) => push(id, get(id) * f, reason);
  const add = (id, d, reason) => push(id, get(id) + d, reason);

  // ---- timing: where does "right" sit for you?
  const s = answers.timing;
  if (s !== null && s !== undefined && sample.rawErr !== null && Math.abs(sample.rawErr) < sample.miss * 1.5) {
    const target = (sample.rawErr - s * 0.6 * sample.sigma) * 1000; // ms
    const cur = get('timing.offsetMs');
    const next = cur + 0.25 * (target - cur);
    if (Math.abs(next - cur) >= 0.5) push('timing.offsetMs', next, `you felt ${['early', 'right', 'late'][s + 1]} at ${Math.round(sample.rawErr * 1000)} ms raw`);
    if (s === 0 && sample.timing !== 'PERFECT' && Math.abs(sample.err) < sample.sigma * 1.6) mul('timing.windowScale', 1.03, 'called it right, the game said ' + sample.timing.toLowerCase());
    if (s !== 0 && sample.timing === 'PERFECT') mul('timing.windowScale', 0.97, 'felt off, the game said perfect');
  }

  // ---- outcome: too harsh (-1) eases what punished you; too kind (+1) tightens it
  const o = answers.outcome;
  if (o === -1 || o === 1) {
    const f = o === -1 ? 0.92 : 1.08;
    const fs = o === -1 ? 0.97 : 1.03;
    const word = o === -1 ? 'too harsh' : 'too kind';
    const cell = (k) => `shot.${k}.len.${sample.length}`;
    if (sample.kind === 'miss' || sample.kind === 'playedOn') {
      if (sample.fit >= 0.4 || o === 1) mul('k.missCoef', f, `${word}: beaten`);
      else {
        // You think this shot suits this ball better than the table does.
        add(cell(sample.shotKey), 0.08, `${word}: beaten with a shot the game thought wrong`);
        widenLine(sample, push, get, 0.03);
      }
    } else if (sample.edge) {
      mul('k.edgeTiming', f, `${word}: ${sample.edge} edge`);
      mul('k.edgeFit', f, `${word}: ${sample.edge} edge`);
    } else if (sample.out === 'caught') {
      mul('scale.catchSkill', fs, `${word}: caught`);
      if (sample.lofted) mul('k.loftQ', o === -1 ? 1.03 : 0.97, `${word}: lofted and caught`);
    } else if (sample.kind === 'hit') {
      if (o === -1 && sample.q > 0.6 && sample.runs <= 1) {
        mul('k.groundQ', 1.03, 'too harsh: middled for little');
        mul('scale.fielderSpeed', 0.97, 'too harsh: middled for little');
      } else if (o === 1 && (sample.runs >= 4 || sample.fieldType === 'drop') && sample.q < 0.55) {
        mul('k.groundQ', 0.97, 'too kind: a mistimed shot paid well');
        mul('scale.fielderSpeed', 1.03, 'too kind: a mistimed shot paid well');
      } else if (sample.fit < 0.5) {
        add(cell(sample.shotKey), o === -1 ? 0.05 : -0.05, `${word}: shot vs this length`);
      }
    }
  }

  // ---- an edge: direction, range, speed and height of that kind of edge
  if (sample.edge && sample.az !== null && sample.az !== undefined) {
    const e = `edge.${sample.edge}`;
    const nm = `${sample.edge} edges`;
    if (answers.power === -1) mul(`${e}.speed`, 1.05, `${nm} come off too soft`);
    if (answers.power === 1) mul(`${e}.speed`, 0.95, `${nm} come off too hard`);
    if (answers.height === -1) add(`${e}.elev`, (3 * Math.PI) / 180, `${nm} fly too flat`);
    if (answers.height === 1) add(`${e}.elev`, (-3 * Math.PI) / 180, `${nm} fly too high`);
    if (answers.spread === 1) mul(`${e}.azHalf`, 0.9, `${nm} vary too widely`);
    if (answers.spread === -1) mul(`${e}.azHalf`, 1.1, `${nm} too predictable`);
    const dir = answers.dir;
    if (dir !== null && dir !== undefined) {
      const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
      const deg = (a) => `${Math.round((Math.abs(a) * 180) / Math.PI)}°`;
      // A top edge flies to either side: its direction is a distance from straight.
      const off = sample.edge === 'top' ? Math.abs(wrap(dir)) - Math.abs(sample.aimAz) : wrap(dir - sample.aimAz);
      const step = Math.max(-0.14, Math.min(0.14, 0.25 * off));
      if (Math.abs(step) > 0.005) add(`${e}.az`, step, `${nm} should go ${deg(off)} ${sample.edge === 'top' ? (off > 0 ? 'squarer' : 'straighter') : off > 0 ? 'more to the off' : 'more to the leg'}`);
    }
  }

  // ---- power and trajectory of a clean hit
  if (!sample.edge && sample.az !== null && sample.az !== undefined && sample.shotKey) {
    const k = sample.shotKey;
    if (answers.power === -1) mul(`shot.${k}.power`, 1.05, 'came off too soft');
    if (answers.power === 1) mul(`shot.${k}.power`, 0.95, 'came off too hard');
    const step = ((sample.lofted || k === 'scoop' ? 3 : 2) * Math.PI) / 180;
    if (answers.height === -1) add(`shot.${k}.elev`, step, 'trajectory too flat');
    if (answers.height === 1) add(`shot.${k}.elev`, -step, 'trajectory too high');
  }

  // ---- how wide shots vary: the random scatter (all shots) and this shot's timing drag
  if (!sample.edge && sample.az !== null && sample.az !== undefined && sample.shotKey) {
    if (answers.spread === 1) {
      mul('k.spread', 0.9, 'shots vary too widely');
      mul(`shot.${sample.shotKey}.drift`, 0.95, 'shots vary too widely');
    }
    if (answers.spread === -1) {
      mul('k.spread', 1.1, 'shots too predictable');
      mul(`shot.${sample.shotKey}.drift`, 1.05, 'shots too predictable');
    }
  }

  // ---- direction: where the shot should have gone (clean hits only; edges are luck)
  const dir = answers.dir;
  if (!sample.edge && dir !== null && dir !== undefined && sample.az !== null && sample.az !== undefined && sample.shotKey) {
    const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
    const miss = wrap(dir - sample.az); // + means it should have gone more to the off side
    const deg = (a) => `${Math.round((a * 180) / Math.PI)}°`;
    if (Math.abs(miss) > 0.03) {
      // You timed it right but the timing drag pulled it off line: less drag for this shot.
      let drag = sample.driftAz;
      if (s === 0 && Math.abs(sample.driftAz) > 0.05 && Math.sign(miss) === -Math.sign(sample.driftAz)) {
        mul(`shot.${sample.shotKey}.drift`, 0.85, `timing felt right but drag pulled it ${deg(Math.abs(sample.driftAz))} off`);
        drag *= 0.85;
      }
      // The systematic part: the aim moves a quarter of the way toward where you
      // say it belongs (net of the timing drag), at most 8° a ball.
      const aimOff = wrap(dir - drag - sample.aimAz);
      const step = Math.max(-0.14, Math.min(0.14, 0.25 * aimOff));
      if (Math.abs(step) > 0.005) add(`shot.${sample.shotKey}.az`, step, `aim should be ${deg(Math.abs(aimOff))} more to the ${aimOff > 0 ? 'off' : 'leg'} side`);
      // The random part: if the scatter is what took it off line, scatter less.
      const sc = sample.scatter ?? 0;
      if (Math.abs(sc) > 0.03 && Math.sign(sc) === -Math.sign(miss) && Math.abs(aimOff) < Math.abs(miss) * 0.6)
        mul('k.spread', 0.95, `random scatter put it ${deg(Math.abs(sc))} off line`);
    }
  }

  // ---- the right shots for this ball: ideal ones, and others that are OK
  const ideals = [].concat(answers.ideal ?? []);
  const goods = [].concat(answers.good ?? []);
  if (sample.length) {
    for (const k of ideals) {
      add(`shot.${k}.len.${sample.length}`, 0.1, `you marked ${k} ideal for a ${sample.length} ball`);
      widenLine({ ...sample, shotKey: k }, push, get, 0.04);
    }
    for (const k of goods) {
      if (get(`shot.${k}.len.${sample.length}`) < 0.65) add(`shot.${k}.len.${sample.length}`, 0.06, `you marked ${k} OK for a ${sample.length} ball`);
      widenLine({ ...sample, shotKey: k }, push, get, 0.025);
    }
    const marked = ideals.length + goods.length > 0;
    if (marked && sample.shotKey && !ideals.includes(sample.shotKey) && !goods.includes(sample.shotKey) && (o === 1 || (o === 0 && sample.q > 0.6)))
      add(`shot.${sample.shotKey}.len.${sample.length}`, -0.05, `${sample.shotKey} was rewarded but is not a shot for this ball`);
  }
  return out;
}

/** Move the nearer end of a shot's line band toward where the ball actually was. */
function widenLine(sample, push, get, step) {
  if (sample.ballZ === null || sample.ballZ === undefined) return;
  const a = get(`shot.${sample.shotKey}.line0`);
  const b = get(`shot.${sample.shotKey}.line1`);
  if (sample.ballZ < a) push(`shot.${sample.shotKey}.line0`, Math.max(sample.ballZ, a - step), 'line band toward the ball');
  else if (sample.ballZ > b) push(`shot.${sample.shotKey}.line1`, Math.min(sample.ballZ, b + step), 'line band toward the ball');
}
