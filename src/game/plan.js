/**
 * An actor's (or the ball's) schedule: segments [t0, t1) each with a pure
 * function of game time, plus an idle function for the gaps. The controller
 * appends segments as the match unfolds; any time, past or future, can be
 * evaluated, which is how flights are aimed at where a hand *will* be.
 * Later segments win where they overlap. Rests (open-ended) hold a position
 * between moves, so nothing ever falls back to a stale idle and teleports.
 */
export class Plan {
  constructor(idle) {
    this.segs = [];
    this.idle = idle;
  }
  add(t0, t1, fn, tag) {
    if (!(t1 > t0)) return;
    this.segs.push({ t0, t1, fn, tag });
  }
  /**
   * Open-ended rest from t0: where the actor stays until told otherwise. It ends
   * any earlier rest at t0, and segments added after it still win over it.
   */
  rest(t0, fn) {
    for (const s of this.segs) if (s.open && s.t1 > t0) s.t1 = t0;
    this.segs.push({ t0, t1: Infinity, fn, open: true });
  }
  /** Drop every segment that starts at or after t (a plan change). */
  cutFrom(t) {
    this.segs = this.segs.filter((s) => s.t0 < t);
  }
  /** Forget segments that ended long ago. */
  prune(t) {
    if (this.segs.length > 24) this.segs = this.segs.filter((s) => s.t1 > t - 30);
  }
  seg(t) {
    for (let i = this.segs.length - 1; i >= 0; i--) {
      const s = this.segs[i];
      if (t >= s.t0 && t < s.t1) return s;
    }
    return null;
  }
  at(t) {
    const s = this.seg(t);
    return s ? s.fn(t) : this.idle(t);
  }
  /** An evaluator over the segments as they stand now (to layer a gesture on top). */
  snapshot() {
    const segs = this.segs.slice();
    return (t) => {
      for (let i = segs.length - 1; i >= 0; i--) if (t >= segs[i].t0 && t < segs[i].t1) return segs[i].fn(t);
      return this.idle(t);
    };
  }
  /** End time of the last segment. */
  end() {
    return this.segs.reduce((m, s) => Math.max(m, s.t1), -Infinity);
  }
}
