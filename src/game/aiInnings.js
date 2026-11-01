import { createMatch } from './match.js';
import { SHOTS, shotFit, shotFoot } from './batting.js';
import { makeRng } from './rules.js';
import { aiBatterReviews } from './umpire.js';

/**
 * The AI's innings: you only ever bat, so when the AI bats it is simulated,
 * ball by ball through the same engine (the automated bowler bowls for your
 * side, the same fielders, the same umpires), with an automated batter.
 *
 * Its timing (the spread of its presses, seconds) is set by the difficulty,
 * so a harder level sets a bigger total and chases harder. The engine itself
 * runs at medium (the level's timing windows are yours, not the AI's).
 */
export const AI_SKILL = { easy: 0.06, medium: 0.03, hard: 0.017 };

const gauss = (r) => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());

/** The automated batter: the best-fitting shot, timed with spread `sd`; lofts when the game asks for it. */
export function aiBatter(sd, r) {
  return (m, ball) => {
    const { del } = ball;
    let best = null;
    for (const k of Object.keys(SHOTS).filter((k) => !SHOTS[k].special)) {
      const f = shotFit(SHOTS[k], del, shotFoot(SHOTS[k], del));
      const score = f * SHOTS[k].power * (k === 'defence' ? 0.45 : 1);
      if (!best || score > best.score) best = { k, f, score };
    }
    if (best.f < 0.35 && !del.hitsStumps && !del.padImpact('stance')) return null;
    const shot = SHOTS[best.k];
    const tC = del.contactTime(shotFoot(shot, del));
    const pressT = tC - shot.swing + (shot.bias ?? 0) + gauss(r) * sd;
    const ballsLeft = m.ballsLeft();
    const inHand = m.wickets - m.wkts;
    let urge;
    if (m.target != null) urge = m.need() / Math.max(1, ballsLeft / 6) > 10 ? 1 : 0.25;
    else {
      // Setting a total: build, then go at the end with wickets in hand.
      const done = 1 - ballsLeft / (m.overs * 6);
      urge = 0.15 + 0.6 * Math.max(0, done - 0.55) / 0.45 + (inHand >= 4 ? 0.15 : 0);
    }
    const lofted = best.f > 0.85 && best.k !== 'defence' && r() < urge;
    return { shotKey: best.k, lofted, pressT };
  };
}

/**
 * Plays the AI's innings. target: null to set a total, else the runs to win.
 * book: a scorebook (createScorebook(seed, { aiBats: true })) to fill in.
 * superOver: one over, two wickets. Given out, the AI batter reviews when he
 * thinks he wasn't (three reviews, one in a super over; kept on umpire's call).
 * Returns { m, overs: [{ n, marks, runs, total, wkts, falls: [text], notes: [text] }] }.
 */
export function simulateInnings({ difficulty = 'medium', seed = 1, format = 5, target = null, conditions = null, umpire = null, book = null, superOver = false }) {
  // (Your side's attack, as the scorebook names it.)
  const attack = book ? book.bowlers.map((b) => b.style) : null;
  const m = createMatch({ difficulty: 'medium', seed: seed * 101 + 17, format, target, conditions, superOver, attack, umpire: umpire && { bad: umpire.bad, drs: false } });
  const r = makeRng(seed * 31 + 5);
  // (Over a long innings a tight hard-level batter piles up too much: a touch looser there.)
  const bat = aiBatter((AI_SKILL[difficulty] ?? AI_SKILL.medium) * (difficulty === 'hard' && format > 5 && !superOver ? 1.3 : 1), r);
  const actors = ['p0', 'p1'];
  if (book) book.actor = { p0: 0, p1: 1 };
  const overs = [];
  let cur = { n: 1, marks: [], runs: 0, falls: [], notes: [] };
  m.startOver();
  while (!m.result) {
    const ball = m.nextDelivery();
    let o = m.resolve(ball, bat(m, ball));
    const striker = actors[m.strikerIdx];
    const before = book ? book.batters[book.actor[striker]] : null;
    if (umpire?.drs !== false && m.reviewable(o) && m.reviewsLeft > 0 && aiBatterReviews(o, r())) {
      const res = m.review(o);
      const who = before ? before.name : 'the batter';
      const how = o.umpire.kind === 'lbw' ? 'lbw' : 'caught';
      if (res.overturned) o = m.overturn(o);
      cur.notes.push(`${who} reviews ${how}: ${res.overturned ? 'NOT OUT, overturned' : res.umpiresCall ? "out, umpire's call (review kept)" : 'out, review lost'}`);
    }
    const rec = m.record(o);
    book?.ball({ o, striker, incoming: o.out ? striker : null, overEnd: rec.overEnd }, m);
    cur.marks.push(o.out ? 'W' : o.wide ? 'wd' : String(o.runs + o.extras));
    cur.runs += o.runs + o.extras;
    if (o.out && before) cur.falls.push(`${before.name} ${before.how} ${before.runs} (${before.balls})`);
    if (rec.overEnd || m.result) {
      overs.push({ ...cur, total: m.runs, wkts: m.wkts });
      cur = { n: cur.n + 1, marks: [], runs: 0, falls: [], notes: [] };
    }
    if (rec.overEnd && !m.result) m.startOver();
  }
  return { m, overs };
}
