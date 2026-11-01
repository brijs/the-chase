import { G, OVAL, ellipseK, standHeight } from './rules.js';
import { BALL_R } from '../config.js';

/**
 * The ball after it leaves the bat: gravity, bounces on the outfield and a
 * rolling drag, integrated at 240 Hz and stored as samples every 1/120 s so the
 * renderer and the fielders read the same path. Stops at the boards; a six
 * flies on over them and lands in the stands (bouncing down the terraces),
 * which only the picture uses: the runs and the fielding are settled by then.
 *
 * Returns { samples: [{ t, x, y, z, air, speed, crowd? }], six, four, tRope, tStop, tLand }.
 * `air` stays true until the first bounce.
 *
 * env (the match conditions): wind { x, z } m/s, which the drag works against
 * while the ball is in the air, and roll, the outfield's rolling resistance
 * (1 normal, more is a slow outfield).
 */
export function simulateBatted(p0, { az, speed, elev }, { wind = { x: 0, z: 0 }, roll = 1, maxT = 9 } = {}) {
  const h = 1 / 240;
  let x = p0.x, y = Math.max(BALL_R, p0.y), z = p0.z;
  const ch = Math.cos(elev) * speed;
  let vx = Math.cos(az) * ch, vy = Math.sin(elev) * speed, vz = Math.sin(az) * ch;
  let air = true;
  let rolling = false;
  let t = 0;
  let tRope = null;
  let six = false, four = false;
  let stopped = false;
  let over = false;
  const samples = [];
  for (let i = 0; t <= maxT; i++) {
    if (i % 2 === 0) samples.push({ t, x, y, z, air, speed: Math.hypot(vx, vz) });
    if (stopped) break;
    if (!rolling) {
      vy -= G * h;
      x += vx * h;
      y += vy * h;
      z += vz * h;
      // A touch of air drag on a hard hit, relative to the moving air.
      const rx = vx - wind.x, rz = vz - wind.z;
      const k = 0.006 * h * Math.hypot(rx, vy, rz);
      vx -= k * rx; vz -= k * rz;
      if (y <= BALL_R) {
        y = BALL_R;
        if (air) air = false;
        if (-vy > 1.2) {
          // Grass keeps a skidding ball's pace and kills a steep one.
          const vh = Math.hypot(vx, vz);
          const loss = 1 - 0.45 * Math.min(1, (-vy / Math.max(0.1, vh)) * 1.2);
          vy = -vy * 0.36;
          vx *= loss;
          vz *= loss;
        } else {
          vy = 0;
          rolling = true;
        }
      }
    } else {
      const sp = Math.hypot(vx, vz);
      const dec = (2.6 + sp * 0.14) * roll * h;
      if (sp <= dec || sp < 0.15) {
        vx = 0; vz = 0;
        stopped = true;
      } else {
        vx *= 1 - dec / sp;
        vz *= 1 - dec / sp;
      }
      x += vx * h;
      z += vz * h;
    }
    t += h;
    if (tRope === null && ellipseK(x, z, OVAL.rope) >= 1) {
      tRope = t;
      if (air) six = true;
      else four = true;
    }
    // The boards: a carried six goes over them; anything else stops dead there.
    if (!over && ellipseK(x, z, OVAL.boards) >= 1) {
      if (y < 0.72 + BALL_R) {
        vx *= -0.12; vz *= -0.12;
        x -= (x - OVAL.cx) * 0.01; z -= z * 0.01;
        if (rolling || y <= BALL_R + 0.01) stopped = true;
      } else over = true;
    }
    // Over the boards: on into the crowd, a bounce or two down the steps.
    if (over) return intoCrowd(samples, { t, x, y, z, vx, vy, vz }, h, tRope ?? t, six, four);
  }
  return { samples, six, four, tRope, tStop: t, gone: false };
}

/** A carried six from the moment it clears the boards until it comes to rest in the stands (at most 4.5 s after the rope). */
function intoCrowd(samples, b, h, tRope, six, four) {
  let { t, x, y, z, vx, vy, vz } = b;
  let tLand = null;
  let bounces = 0;
  // (Samples stay on the 1/120 s grid sampleAt indexes.)
  while (t < tRope + 4.5) {
    vy -= G * h;
    const nx = x + vx * h, ny = y + vy * h, nz = z + vz * h;
    const floor = standHeight(nx, nz) + BALL_R;
    if (ny <= floor) {
      // A riser in the way (it climbed more than a step's worth): it hits the face and drops back.
      if (floor - Math.max(y, standHeight(x, z) + BALL_R) > 0.2) {
        vx *= -0.25; vz *= -0.25;
      } else {
        x = nx; z = nz;
        y = floor;
        tLand ??= t;
        bounces++;
        vy = Math.abs(vy) * 0.3;
        vx *= 0.55; vz *= 0.55;
        if (vy < 0.6 || bounces > 3) {
          samples.push({ t, x, y, z, air: false, speed: 0, crowd: true, gone: true });
          return { samples, six, four, tRope, tStop: t, tLand, gone: true };
        }
      }
    } else {
      x = nx; y = ny; z = nz;
    }
    t += h;
    if (Math.round(t / h) % 2 === 0) samples.push({ t, x, y, z, air: tLand == null, speed: Math.hypot(vx, vz), crowd: true });
  }
  samples.push({ t, x, y, z, air: false, speed: 0, crowd: true, gone: true });
  return { samples, six, four, tRope, tStop: t, tLand: tLand ?? t, gone: true };
}

/** Sample at time t (linear between stored samples). */
export function sampleAt(sim, t) {
  const s = sim.samples;
  if (t <= 0) return s[0];
  const i = Math.min(s.length - 1, Math.floor(t * 120));
  const a = s[i];
  const b = s[Math.min(s.length - 1, i + 1)];
  const u = Math.min(1, Math.max(0, t * 120 - i));
  return { t, x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, z: a.z + (b.z - a.z) * u, air: a.air, speed: a.speed, gone: b.gone };
}
