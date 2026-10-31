/**
 * Sound for the Chase, synthesised with WebAudio: no samples, so the project
 * still imports no assets. Everything is a few oscillators and filtered noise:
 *
 *   bat      willow on leather: a hard click plus a short woody resonance (q = 0..1)
 *   edge     a thin high tick          pad    a dull thud        bounce  ball on the pitch
 *   stumps   wood clatter              glove  keeper / catch pop  step    run-up footfall
 *   grunt    the bowler's delivery grunt (formant-filtered saw + breath)
 *   appeal   "howzat" (rising then falling formant shout)
 *   crowd    a murmur bed that never stops; cheer / roar / ooh / applause swell over it
 *
 * The context starts on the first key or tap (browsers require a gesture).
 * M mutes; the choice is remembered in localStorage when it is available.
 */
export function createAudio() {
  let ctx = null;
  let master = null;
  let bed = null;
  let noiseBuf = null;
  let clapBuf = null;
  let muted = false;
  let meter = null;
  const played = {}; // name -> count (QA)
  try {
    muted = localStorage.getItem('chase-muted') === '1';
  } catch {}

  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.9;
      const comp = ctx.createDynamicsCompressor();
      master.connect(comp).connect(ctx.destination);
      meter = ctx.createAnalyser();
      meter.fftSize = 1024;
      comp.connect(meter);
      noiseBuf = makeNoise(2.5);
      clapBuf = makeClaps(3.0);
      startBed();
    }
    if (ctx.state === 'suspended') ctx.resume();
  }

  function makeNoise(sec) {
    const b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * sec), ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }
  /** Many hands: short decaying clicks scattered over the buffer. */
  function makeClaps(sec) {
    const sr = ctx.sampleRate;
    const b = ctx.createBuffer(1, Math.floor(sr * sec), sr);
    const d = b.getChannelData(0);
    for (let k = 0; k < sec * 260; k++) {
      const at = Math.floor(Math.random() * (d.length - 800));
      const amp = 0.25 + Math.random() * 0.6;
      for (let i = 0; i < 600; i++) d[at + i] += (Math.random() * 2 - 1) * amp * Math.exp(-i / 90);
    }
    return b;
  }

  const now = () => ctx.currentTime;
  function env(g, t, a, peak, d) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }
  function noise(t, dur, { type = 'bandpass', freq = 1000, Q = 1, peak = 0.5, attack = 0.002, buf = noiseBuf, rate = 1, dest = master } = {}) {
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = Q;
    const g = ctx.createGain();
    env(g, t, attack, peak, dur);
    src.connect(f).connect(g).connect(dest);
    const room = buf.duration - attack - dur - 0.1;
    if (room > 0) src.start(t, Math.random() * room);
    else {
      src.loop = true;
      src.start(t);
    }
    src.stop(t + attack + dur + 0.05);
    return { f, g };
  }
  function tone(t, dur, { type = 'sine', f0 = 440, f1 = f0, peak = 0.3, attack = 0.002, dest = master } = {}) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + attack + dur);
    const g = ctx.createGain();
    env(g, t, attack, peak, dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + attack + dur + 0.05);
    return o;
  }
  /** A voice: saw through two formants, with a pitch contour [[dt, hz], ...]. */
  function voice(t, dur, contour, formants, peak, breath = 0.15) {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(contour[0][1], t);
    for (const [dt, hz] of contour.slice(1)) o.frequency.linearRampToValueAtTime(hz, t + dt);
    const g = ctx.createGain();
    env(g, t, 0.03, peak, dur);
    for (const [fq, q, gain] of formants) {
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = fq;
      f.Q.value = q;
      const fg = ctx.createGain();
      fg.gain.value = gain;
      o.connect(f).connect(fg).connect(g);
    }
    g.connect(master);
    o.start(t);
    o.stop(t + dur + 0.1);
    if (breath) noise(t, dur * 0.8, { freq: 1400, Q: 0.8, peak: breath, attack: 0.02 });
  }

  // Crowd bed: two bands of slowly breathing noise, always on under the play.
  function startBed() {
    bed = ctx.createGain();
    bed.gain.value = 0.05;
    bed.connect(master);
    for (const [fq, q, lvl] of [[420, 0.7, 1], [1250, 1.2, 0.45]]) {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuf;
      src.loop = true;
      src.playbackRate.value = 0.5;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = fq;
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = lvl;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.13 + Math.random() * 0.1;
      const lg = ctx.createGain();
      lg.gain.value = lvl * 0.35;
      lfo.connect(lg).connect(g.gain);
      src.connect(f).connect(g).connect(bed);
      src.start();
      lfo.start();
    }
  }
  /** Crowd swell over the bed: a band of noise plus clapping, `size` 0..1. */
  function crowd(t, size, dur, { clap = 0.6, bright = 1 } = {}) {
    noise(t, dur, { freq: 700 + 500 * bright, Q: 0.6, peak: 0.12 + 0.5 * size, attack: 0.25 + 0.2 * (1 - size), rate: 0.7 });
    noise(t + 0.05, dur * 0.8, { freq: 2200, Q: 0.9, peak: 0.05 + 0.18 * size, attack: 0.3, rate: 0.8 });
    if (clap) noise(t + 0.3, dur + 0.8, { type: 'highpass', freq: 900, Q: 0.5, peak: clap * (0.15 + 0.4 * size), attack: 0.25, buf: clapBuf });
  }

  const SOUNDS = {
    bat(t, { q = 0.7 } = {}) {
      noise(t, 0.018, { type: 'highpass', freq: 2500, Q: 0.7, peak: 0.5 + 0.5 * q });
      noise(t, 0.09 + 0.06 * q, { freq: 1050 + 300 * q, Q: 6, peak: 0.35 + 0.5 * q });
      tone(t, 0.07, { f0: 640 + 160 * q, f1: 420, peak: 0.12 + 0.2 * q });
      tone(t, 0.06, { f0: 160, f1: 70, peak: 0.25 });
    },
    edge(t) {
      noise(t, 0.03, { freq: 3600, Q: 5, peak: 0.45 });
      tone(t, 0.035, { f0: 1900, f1: 1300, peak: 0.08, type: 'triangle' });
    },
    pad(t) {
      noise(t, 0.08, { type: 'lowpass', freq: 380, Q: 0.8, peak: 0.6 });
      tone(t, 0.07, { f0: 110, f1: 60, peak: 0.35 });
    },
    bounce(t) {
      tone(t, 0.06, { f0: 150, f1: 70, peak: 0.28 });
      noise(t, 0.05, { type: 'lowpass', freq: 900, peak: 0.25 });
    },
    stumps(t) {
      for (const [dt, fq] of [[0, 2400], [0.03, 1650], [0.075, 2900], [0.13, 1300]]) noise(t + dt, 0.05, { freq: fq, Q: 9, peak: 0.45 });
      tone(t, 0.08, { f0: 780, f1: 520, peak: 0.12, type: 'triangle' });
    },
    glove(t, { peak = 0.45 } = {}) {
      noise(t, 0.05, { type: 'lowpass', freq: 1100, peak });
      tone(t, 0.05, { f0: 240, f1: 140, peak: peak * 0.6 });
    },
    step(t, { peak = 0.12 } = {}) {
      noise(t, 0.04, { type: 'lowpass', freq: 260 + Math.random() * 80, peak });
    },
    grunt(t, { big = false } = {}) {
      const f0 = 130 + Math.random() * 25;
      voice(t, big ? 0.38 : 0.28, [[0, f0 * 1.15], [0.06, f0], [0.3, f0 * 0.72]], [[620, 6, 1], [1150, 8, 0.6], [2600, 6, 0.15]], big ? 0.5 : 0.35, 0.12);
    },
    appeal(t) {
      // Bowler and the cordon together: three voices a little apart.
      for (let k = 0; k < 3; k++) {
        const f0 = 190 + k * 35 + Math.random() * 15;
        voice(t + k * 0.05, 0.85, [[0, f0], [0.22, f0 * 1.45], [0.75, f0 * 0.85]], [[750, 5, 1], [1250, 6, 0.7], [2500, 5, 0.2]], 0.22, 0.05);
      }
    },
    ooh(t, { size = 0.6 } = {}) {
      for (let k = 0; k < 5; k++) {
        const f0 = 150 + k * 37 + Math.random() * 20;
        voice(t + Math.random() * 0.12, 1.1, [[0, f0 * 1.1], [0.35, f0 * 1.2], [1.0, f0 * 0.8]], [[330, 5, 1], [800, 6, 0.4]], 0.05 + 0.06 * size, 0);
      }
      crowd(t, size * 0.4, 1.2, { clap: 0, bright: 0.2 });
    },
    cheer(t, { size = 0.7 } = {}) {
      crowd(t, size, 2.4 + 1.6 * size);
    },
    roar(t) {
      crowd(t, 1, 3.6, { clap: 0.8, bright: 1.2 });
      SOUNDS.ooh(t, { size: 0.3 });
    },
    applause(t, { size = 0.35 } = {}) {
      noise(t, 1.8 + size * 2, { type: 'highpass', freq: 900, Q: 0.5, peak: 0.15 + 0.4 * size, attack: 0.2, buf: clapBuf });
    },
  };

  return {
    ensure,
    play(name, opts = {}, delay = 0) {
      if (!ctx || muted || !SOUNDS[name]) return;
      played[name] = (played[name] ?? 0) + 1;
      SOUNDS[name](now() + 0.005 + Math.max(0, delay), opts);
    },
    toggleMute() {
      muted = !muted;
      if (master) master.gain.setTargetAtTime(muted ? 0 : 0.9, now(), 0.05);
      try {
        localStorage.setItem('chase-muted', muted ? '1' : '0');
      } catch {}
      return muted;
    },
    /** Duck the crowd bed while paused. */
    setPaused(p) {
      if (bed) bed.gain.setTargetAtTime(p ? 0.0 : 0.05, now(), 0.2);
    },
    played,
    /** Output RMS right now (QA: proves something is actually sounding). */
    level() {
      if (!meter) return 0;
      const d = new Float32Array(meter.fftSize);
      meter.getFloatTimeDomainData(d);
      return Math.sqrt(d.reduce((a, v) => a + v * v, 0) / d.length);
    },
    get muted() {
      return muted;
    },
  };
}
