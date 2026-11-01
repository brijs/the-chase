import { BALL_REAL_R, STUMPS_X } from './rules.js';
import { BALL_R, PITCH } from '../config.js';

/**
 * The on-field umpire and the review system's evidence (pure, Node-testable).
 *
 * Ball tracking for LBW, as the playing conditions define it:
 *   pitching   the centre of the ball where it pitched. Outside leg stump
 *              (leg side of the zone) is never out; in line or outside off is.
 *   impact     the centre of the ball where it first meets the batter. In the
 *              zone is in line; centre outside but part of the ball in is
 *              umpire's call; wholly outside is not out (outside off counts as
 *              in line when no shot was offered).
 *   wickets    the projected path at the stumps. Centre inside the wicket zone
 *              (outer edges of the stumps, ground to the top of the bails) is
 *              hitting; any part of the ball clipping it is umpire's call;
 *              otherwise missing.
 * The zone is the line between the outer edges of the stumps (STUMP_POS ±
 * stump radius) from wicket to wicket.
 *
 * Umpire's call means the on-field decision stands, and a review that ends on
 * umpire's call is not lost.
 *
 * The umpire gets some wrong: `bad` (0..1, default 0.25 in the game) scales how
 * often a close call goes the wrong way. A plumb one is rarely missed; a near
 * miss, a faint edge or a feather off the bat before the pad is where the
 * mistakes are.
 */
export const ZONE_HALF = 0.114 + 0.03; // outer edge of the outer stumps
export const ZONE_TOP = PITCH.stumpH + 0.03; // top of the bails
const R = BALL_REAL_R;
const realY = (p) => p.y - (BALL_R - BALL_REAL_R);

/** Ball tracking for a ball that hit the pad. offered: the batter played a shot. */
export function trackLbw(del, foot, offered) {
  const pad = del.padImpact(foot);
  if (!pad) return null;
  // Pitching: where it bounced, if it bounced before the pad (a full toss has no pitching point).
  const bounced = del.T1 < pad.t;
  const bz = del.bounce.z;
  const pitching = !bounced ? 'full' : bz < -ZONE_HALF ? 'outsideLeg' : bz > ZONE_HALF ? 'outsideOff' : 'inline';
  // Impact.
  const iz = pad.p.z;
  const side = iz < 0 ? 'leg' : 'off';
  let impact = Math.abs(iz) <= ZONE_HALF ? 'inline' : Math.abs(iz) <= ZONE_HALF + R ? 'umpiresCall' : 'outside';
  const noShotOff = !offered && side === 'off' && impact !== 'inline';
  if (noShotOff) impact = 'inline';
  // Wickets: the projected path through the stumps plane.
  const at = del.atStumps;
  const wz = at.z;
  const wy = realY(at);
  const wickets = Math.abs(wz) <= ZONE_HALF && wy <= ZONE_TOP ? 'hitting' : Math.abs(wz) <= ZONE_HALF + R && wy <= ZONE_TOP + R ? 'umpiresCall' : 'missing';
  // How far from out it was (m), for the umpire's chance of getting it wrong.
  const miss =
    (pitching === 'outsideLeg' ? -ZONE_HALF - bz : 0) +
    (impact === 'outside' ? Math.abs(iz) - ZONE_HALF - R : 0) +
    (wickets === 'missing' ? Math.max(Math.abs(wz) - ZONE_HALF - R, wy - ZONE_TOP - R, 0) : 0);
  return {
    pitching,
    impact,
    impactSide: side,
    noShotOff,
    wickets,
    miss,
    tPad: pad.t,
    pad: pad.p,
    tBounce: bounced ? del.T1 : null,
    bounce: bounced ? del.bounce : null,
    tStumps: del.tStumps,
    atStumps: { x: STUMPS_X, y: wy, z: wz },
  };
}

/**
 * Ball tracking for any ball (the replay's review): where it pitched, where it
 * stopped being a free ball (pad, bat, or the stumps' plane) and whether its
 * path would have gone on to hit the stumps. Pad balls get the full LBW track.
 */
export function trackAny(del, o) {
  if (o.pad) {
    const t = trackLbw(del, o.foot ?? 'stance', o.kind !== 'leave');
    if (t) return { ...t, end: 'pad' };
  }
  const tEnd = o.kind === 'hit' || o.kind === 'playedOn' ? (o.tContact ?? o.shot?.tContact) : del.tStumps;
  const bounced = del.T1 < tEnd;
  const bz = del.bounce.z;
  const at = del.atStumps;
  const wy = realY(at);
  return {
    pitching: !bounced ? 'full' : bz < -ZONE_HALF ? 'outsideLeg' : bz > ZONE_HALF ? 'outsideOff' : 'inline',
    impact: null,
    wickets: Math.abs(at.z) <= ZONE_HALF && wy <= ZONE_TOP ? 'hitting' : Math.abs(at.z) <= ZONE_HALF + R && wy <= ZONE_TOP + R ? 'umpiresCall' : 'missing',
    tPad: tEnd,
    pad: del.pos(tEnd),
    tBounce: bounced ? del.T1 : null,
    bounce: bounced ? del.bounce : null,
    tStumps: del.tStumps,
    atStumps: { x: STUMPS_X, y: wy, z: at.z },
    end: o.kind === 'hit' || o.kind === 'playedOn' ? 'bat' : 'stumps',
  };
}

/** What ball tracking says: 'out', 'notOut' or 'umpiresCall' (the on-field call stands). */
export function lbwVerdict(track) {
  if (track.pitching === 'outsideLeg' || track.impact === 'outside' || track.wickets === 'missing') return 'notOut';
  if (track.impact === 'inline' && track.wickets === 'hitting') return 'out';
  return 'umpiresCall';
}

/**
 * The on-field LBW decision. Returns { given: bool, truth, track, batFirst, ... }.
 *   batFirst  a feather off the inside of the bat before the pad (not out,
 *             whatever tracking says), only when a shot was played close to it
 * With bad = 0 the umpire is perfect and clipping counts as out (no rng drawn).
 */
export function decideLbw({ del, foot, offered, err = null, window = null, bad = 0, rng }) {
  const track = trackLbw(del, foot, offered);
  if (!track) return null;
  let truth = lbwVerdict(track);
  let batFirst = false;
  if (bad > 0 && offered && err != null && window && Math.abs(err) < window.miss * 1.6 && rng() < 0.12) {
    batFirst = true;
    truth = 'notOut';
  }
  let given;
  if (bad <= 0) given = truth !== 'notOut';
  else if (truth === 'out') given = rng() >= bad * 0.4;
  else if (truth === 'umpiresCall') given = rng() < 0.5;
  else {
    // Not out: the closer it was, the likelier the finger goes up anyway.
    const close = batFirst ? 1 : Math.max(0, 1 - track.miss / 0.22);
    given = rng() < bad * close;
  }
  return { kind: 'lbw', given, truth, track, batFirst };
}

/**
 * A caught decision off an edge. faint: a fine edge with little deflection (the
 * kind an umpire can miss, and the kind worth reviewing). Thick edges are
 * always given. Returns { given, truth: 'out', faint }.
 */
export function decideEdgeCatch({ shot, fielding, bad = 0, rng }) {
  const behind = fielding.by === 'keeper' || /slip|gully|third/i.test(fielding.name ?? '');
  const defl = Math.abs(Math.atan2(Math.sin(shot.az - Math.PI), Math.cos(shot.az - Math.PI)));
  const faint = behind && (shot.edge === 'outside' || shot.edge === 'inside') && defl < 0.38;
  const given = !faint || bad <= 0 ? true : rng() >= bad * 0.7;
  return { kind: 'caught', given, truth: 'out', faint, deflection: defl };
}

/**
 * Beaten outside the bat and taken by the keeper: no edge, but how close it
 * passed (m) decides whether the umpire hears one that wasn't there.
 * Returns null (no appeal worth hearing) or { given, truth: 'notOut', margin }.
 */
export function decidePhantomEdge({ bad = 0, rng }) {
  if (bad <= 0) return null;
  const margin = 0.008 + rng() * 0.16;
  const close = Math.max(0, 1 - (margin - 0.008) / 0.085);
  if (close <= 0) return null;
  const given = rng() < bad * close * 0.8;
  return given ? { kind: 'caught', given: true, truth: 'notOut', faint: true, margin } : null;
}

/**
 * The snickometer trace around the moment the ball passes the bat: a noisy
 * flat line with events. Returns [{ t, kind: 'bat' | 'pad' }] (times relative
 * to release) for the review to draw.
 */
export function snickEvents(o, del) {
  const ev = [];
  const sh = o.shot;
  const lbw = o.umpire?.kind === 'lbw' ? o.umpire : null;
  // Any touch of the bat: a feather for an edge, the full crack for a middled one.
  if ((o.kind === 'hit' || o.kind === 'playedOn') && sh) ev.push({ t: sh.tContact, kind: 'bat', big: !sh.edge });
  if (lbw) {
    if (lbw.batFirst) ev.push({ t: lbw.track.tPad - 0.012, kind: 'bat' });
    ev.push({ t: lbw.track.tPad, kind: 'pad' });
  }
  return ev;
}

/**
 * The AI captain in the field: reviews a not-out when it is sure enough. A
 * missed edge the keeper heard, a plumb one missed: usually. Umpire's call:
 * sometimes. A near miss: now and then, a punt. r is 0..1.
 */
export function aiFieldersReview(o, r) {
  const u = o.umpire;
  if (!u || u.given || o.out) return false;
  if (u.kind === 'caught') return r < 0.75;
  if (u.truth === 'out') return r < 0.8;
  if (u.truth === 'umpiresCall') return r < 0.45;
  return r < 0.12 * Math.max(0, 1 - u.track.miss / 0.22);
}

/** The AI batter given out: reviews when he knows he wasn't (outside leg, no edge), seldom when plumb. */
export function aiBatterReviews(o, r) {
  const u = o.umpire;
  if (!u || !u.given) return false;
  return r < (u.truth === 'notOut' ? 0.75 : u.truth === 'umpiresCall' ? 0.4 : 0.06);
}
