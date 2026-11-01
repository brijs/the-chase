/**
 * Sound for the Chase, synthesised with WebAudio: no samples, so the project
 * still imports no assets. Everything is a few oscillators and filtered noise:
 *
 *   bat      willow on leather: a hard click plus a short woody resonance (q = 0..1)
 *   edge     a thin high tick          pad    a dull thud        bounce  ball on the pitch
 *   stumps   wood clatter              glove  keeper / catch pop  step    run-up footfall
 *   grunt    the bowler's delivery grunt (formant-filtered saw + breath)
 *   appeal   "howzat" (rising then falling formant shout)
 *   crowd    many synthesised voices, not noise: a chattering bed that never stops,
 *            and shouted cheers / roars / oohs (plus claps and whistles) over it,
 *            all through a big-stand reverb; boo for a decision they don't like
 *   review   the DRS: countdown tick, sting, a low pulse while it is checked,
 *            scanner whir, a bleep per finding, a riser and the verdict hit
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
  let chatterBuf = null; // the stands talking (a seamless loop)
  let shoutBuf = null; // the stands shouting (a seamless loop)
  let stands = null; // crowd bus: dry plus the stadium reverb
  let muted = false;
  let meter = null;
  let out = null; // the final mix (QA records from here)
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
      const comp = (out = ctx.createDynamicsCompressor());
      master.connect(comp).connect(ctx.destination);
      meter = ctx.createAnalyser();
      meter.fftSize = 1024;
      comp.connect(meter);
      noiseBuf = makeNoise(2.5);
      clapBuf = makeClaps(3.0);
      makeStands();
      // The voices take a few hundred ms to render: a few people per tick, so
      // the first key press doesn't hitch. The bed fades in when it is ready.
      crowdBuffer(6, 44, false, (b) => {
        chatterBuf = b;
        startBed();
        crowdBuffer(5, 56, true, (s) => (shoutBuf = s));
      });
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
  function voice(t, dur, contour, formants, peak, breath = 0.15, dest = master) {
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
    g.connect(dest);
    o.start(t);
    o.stop(t + dur + 0.1);
    if (breath) noise(t, dur * 0.8, { freq: 1400, Q: 0.8, peak: breath, attack: 0.02 });
  }

  /** A big open stand: dry crowd plus a long, dark, wide reverb tail. */
  function makeStands() {
    const sr = ctx.sampleRate;
    const n = Math.floor(sr * 2.6);
    const ir = ctx.createBuffer(2, n, sr);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < n; i++) {
        // Later reflections are duller: the low-pass closes as the tail decays.
        const k = 0.5 * Math.exp(-i / (sr * 0.9)) + 0.04;
        lp += k * (Math.random() * 2 - 1 - lp);
        d[i] = lp * Math.exp(-i / (sr * 0.55)) * (i < sr * 0.02 ? i / (sr * 0.02) : 1);
      }
    }
    const conv = ctx.createConvolver();
    conv.buffer = ir;
    const wet = ctx.createGain();
    wet.gain.value = 0.55;
    stands = ctx.createGain();
    stands.connect(master);
    stands.connect(conv).connect(wet).connect(master);
  }

  /**
   * A crowd as many people: each one a buzzing voice (saw plus breath) through
   * two vowel formants that glide syllable to syllable, speaking in phrases with
   * pauses, at some distance and somewhere left-right in the stands. Rendered
   * once (at a low rate: a crowd has nothing above ~5 kHz) into a stereo loop.
   *   shout = false   speaking pitch, short syllables, plenty of pauses (the bed)
   *   shout = true    raised pitch, long open vowels, hardly a breath (cheers)
   */
  const VOWELS = [[730, 1090], [530, 1840], [270, 2290], [570, 840], [300, 870], [660, 1720], [440, 1020], [490, 1350]];
  const OPEN = [[730, 1090], [660, 1720], [570, 840], [640, 1190]]; // "ah", "ay", "oh", "uh": what crowds shout
  function crowdBuffer(sec, people, shout, done) {
    const sr = 22050;
    const fade = Math.floor(sr * 0.6);
    const len = Math.floor(sr * sec);
    const n = len + fade;
    const L = new Float32Array(n);
    const R = new Float32Array(n);
    const rnd = (a, b) => a + Math.random() * (b - a);
    const TAU = Math.PI * 2;
    let k = 0;
    const person = () => {
      const high = Math.random() < 0.35;
      const base = (high ? rnd(175, 245) : rnd(92, 140)) * (shout ? rnd(1.45, 1.85) : 1);
      const fs = high ? 1.15 : 1;
      const pan = Math.random();
      const near = rnd(0.25, 1) ** 1.5; // most of a crowd is far away
      const gl = Math.cos((pan * Math.PI) / 2) * near;
      const gr = Math.sin((pan * Math.PI) / 2) * near;
      const vowels = shout ? OPEN : VOWELS;
      let phase = Math.random();
      let talking = Math.random() < (shout ? 0.9 : 0.55);
      let phraseEnd = Math.floor(rnd(0, 1.5) * sr);
      let sylStart = 0;
      let sylLen = 1;
      let sylEnd = 0;
      let f0 = base;
      let tf0 = base;
      let f1 = 600;
      let f2 = 1300;
      let tf1 = f1;
      let tf2 = f2;
      let amp = 0;
      let a1 = 0, a2 = 0, b1 = 0, c1 = 0, c2 = 0, d1 = 0; // resonator coefficients
      let x1 = 0, x2 = 0, y1 = 0, y2 = 0; // resonator state
      const vib = rnd(4, 6.5);
      for (let i = 0; i < n; i++) {
        if (i >= phraseEnd) {
          talking = !talking;
          const s = talking ? (shout ? rnd(1.5, 4) : rnd(0.6, 2.6)) : shout ? rnd(0.08, 0.35) : rnd(0.3, 1.8);
          phraseEnd = i + Math.floor(s * sr);
        }
        if (i >= sylEnd) {
          sylStart = i;
          sylLen = Math.floor(sr * (shout ? rnd(0.4, 1.2) : rnd(0.09, 0.26)));
          sylEnd = i + sylLen;
          const v = vowels[Math.floor(Math.random() * vowels.length)];
          tf1 = v[0] * fs;
          tf2 = v[1] * fs;
          tf0 = base * (shout ? rnd(0.95, 1.25) : rnd(0.82, 1.2));
        }
        if ((i & 15) === 0) {
          f1 += (tf1 - f1) * 0.25;
          f2 += (tf2 - f2) * 0.25;
          // Two-pole resonators, normalised to unit gain at the formant.
          const r1 = Math.exp((-Math.PI * 90) / sr);
          const r2 = Math.exp((-Math.PI * 130) / sr);
          const t1 = (TAU * f1) / sr;
          const t2 = (TAU * f2) / sr;
          a1 = 2 * r1 * Math.cos(t1);
          a2 = r1 * r1;
          b1 = (1 - r1) * 2 * Math.sin(t1);
          c1 = 2 * r2 * Math.cos(t2);
          c2 = r2 * r2;
          d1 = (1 - r2) * 2 * Math.sin(t2) * 0.55;
        }
        const u = (i - sylStart) / sylLen;
        const syl = shout ? Math.min(1, u * 8) * Math.min(1, (1 - u) * 5) : Math.sin(Math.PI * u) ** 0.7;
        amp += ((talking ? syl : 0) - amp) * 0.01;
        f0 += (tf0 - f0) * 0.0015;
        phase += (f0 * (1 + 0.012 * Math.sin((TAU * vib * i) / sr))) / sr;
        if (phase >= 1) phase -= 1;
        const src = 1 - 2 * phase + (Math.random() * 2 - 1) * (shout ? 0.35 : 0.25);
        const x = b1 * src + a1 * x1 - a2 * x2;
        x2 = x1;
        x1 = x;
        const y = d1 * src + c1 * y1 - c2 * y2;
        y2 = y1;
        y1 = y;
        const out = (x + y) * amp;
        L[i] += out * gl;
        R[i] += out * gr;
      }
    };
    const tick = () => {
      for (const end = Math.min(people, k + 4); k < end; k++) person();
      if (k < people) setTimeout(tick, 0);
      else done(finish());
    };
    setTimeout(tick, 0);
    const finish = () => {
      // Seamless loop: fold the extra tail over the head.
      for (let i = 0; i < fade; i++) {
        const w = i / fade;
        L[i] = L[i] * w + L[len + i] * (1 - w);
        R[i] = R[i] * w + R[len + i] * (1 - w);
      }
      let peak = 1e-6;
      for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
      const b = ctx.createBuffer(2, len, sr);
      const gain = 0.9 / peak;
      b.getChannelData(0).set(L.subarray(0, len).map((v) => v * gain));
      b.getChannelData(1).set(R.subarray(0, len).map((v) => v * gain));
      return b;
    };
  }

  /** Loop `buf` from a random point through a low-pass, shaped by a gain envelope. */
  function loopVoices(buf, t, dur, { peak, attack = 0.15, cutoff = 3000, rate = 1, dest = stands }) {
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.playbackRate.value = rate;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    f.Q.value = 0.5;
    const g = ctx.createGain();
    env(g, t, attack, peak, dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * buf.duration);
    src.stop(t + attack + dur + 0.1);
    return { f, g };
  }

  // Crowd bed: the stands chattering, plus the low air of a big ground; always on.
  function startBed() {
    bed = ctx.createGain();
    bed.gain.setValueAtTime(0, now());
    bed.gain.setTargetAtTime(BED, now(), 0.6);
    bed.connect(stands);
    const talk = ctx.createBufferSource();
    talk.buffer = chatterBuf;
    talk.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 2600;
    talk.connect(f).connect(bed);
    talk.start();
    const air = ctx.createBufferSource();
    air.buffer = noiseBuf;
    air.loop = true;
    const fa = ctx.createBiquadFilter();
    fa.type = 'lowpass';
    fa.frequency.value = 320;
    const ga = ctx.createGain();
    ga.gain.value = 0.35;
    air.connect(fa).connect(ga).connect(bed);
    air.start();
  }
  const BED = 0.08;

  /** A few fans whistling: quick rising glides, some of them the two-note wolf whistle. */
  function whistles(t, count) {
    for (let k = 0; k < count; k++) {
      const at = t + 0.2 + Math.random() * 1.4;
      const f = 1900 + Math.random() * 900;
      const o = ctx.createOscillator();
      o.type = 'sine';
      const g = ctx.createGain();
      if (Math.random() < 0.4) {
        o.frequency.setValueAtTime(f * 0.8, at);
        o.frequency.exponentialRampToValueAtTime(f * 1.25, at + 0.18);
        o.frequency.setValueAtTime(f * 0.75, at + 0.32);
        o.frequency.exponentialRampToValueAtTime(f * 1.15, at + 0.45);
        o.frequency.exponentialRampToValueAtTime(f * 0.6, at + 0.75);
        env(g, at, 0.04, 0.05, 0.75);
      } else {
        o.frequency.setValueAtTime(f, at);
        o.frequency.linearRampToValueAtTime(f * 1.06, at + 0.6);
        env(g, at, 0.05, 0.04, 0.6 + Math.random() * 0.6);
      }
      o.connect(g).connect(stands);
      o.start(at);
      o.stop(at + 1.6);
    }
  }

  /** The stands rise: shouting voices (brighter when bigger), clapping, `size` 0..1. */
  function crowd(t, size, dur, { clap = 0.6, bright = 1, whistle = 0 } = {}) {
    if (shoutBuf) {
      loopVoices(shoutBuf, t, dur, { peak: 0.15 + 0.85 * size, attack: 0.12 + 0.25 * (1 - size), cutoff: 1500 + 2600 * size * bright });
      // The near rows, a beat behind: thickens it into a mass.
      loopVoices(shoutBuf, t + 0.08, dur * 0.85, { peak: 0.08 + 0.45 * size, attack: 0.2, cutoff: 1200 + 1800 * bright, rate: 0.93 });
    }
    if (chatterBuf) loopVoices(chatterBuf, t, dur * 0.7, { peak: 0.1 + 0.2 * size, attack: 0.2, cutoff: 2200 });
    if (clap) noise(t + 0.3, dur + 0.8, { type: 'highpass', freq: 900, Q: 0.5, peak: clap * (0.12 + 0.32 * size), attack: 0.25, buf: clapBuf, dest: stands });
    if (whistle) whistles(t, whistle);
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
      // The whole ground draws breath: a dark, falling "oooh".
      if (shoutBuf) {
        const { f } = loopVoices(shoutBuf, t, 1.2, { peak: 0.1 + 0.4 * size, attack: 0.18, cutoff: 1100, rate: 0.82 });
        f.frequency.setValueAtTime(1100, t);
        f.frequency.exponentialRampToValueAtTime(500, t + 1.4);
      }
      for (let k = 0; k < 6; k++) {
        const f0 = 150 + k * 31 + Math.random() * 20;
        voice(t + Math.random() * 0.15, 1.1, [[0, f0 * 1.1], [0.35, f0 * 1.2], [1.0, f0 * 0.8]], [[330, 5, 1], [800, 6, 0.4]], 0.02 + 0.03 * size, 0, stands);
      }
    },
    cheer(t, { size = 0.7 } = {}) {
      crowd(t, size, 2.4 + 1.6 * size, { whistle: size > 0.6 ? 2 : 0 });
    },
    roar(t) {
      crowd(t, 1, 3.6, { clap: 0.8, bright: 1.2, whistle: 4 });
    },
    boo(t, { size = 0.8 } = {}) {
      // A long, low, falling "boooo" from the stands: the shout bed through a dark "oo" formant.
      const dur = 2.2 + 1.2 * size;
      if (shoutBuf) {
        const { f } = loopVoices(shoutBuf, t, dur, { peak: 0.12 + 0.5 * size, attack: 0.35, cutoff: 700, rate: 0.72 });
        f.frequency.setValueAtTime(700, t);
        f.frequency.exponentialRampToValueAtTime(380, t + dur);
      }
      for (let k = 0; k < 8; k++) {
        const f0 = 105 + k * 14 + Math.random() * 12;
        voice(t + Math.random() * 0.3, dur * (0.7 + Math.random() * 0.3), [[0, f0 * 1.05], [dur * 0.5, f0], [dur, f0 * 0.82]], [[300, 6, 1], [700, 6, 0.25]], 0.02 + 0.035 * size, 0, stands);
      }
    },
    // ---- the review
    tick(t, { hot = false } = {}) {
      tone(t, 0.05, { type: 'square', f0: hot ? 1320 : 880, f1: hot ? 1300 : 870, peak: hot ? 0.12 : 0.08 });
      noise(t, 0.01, { type: 'highpass', freq: 4000, peak: 0.08 });
    },
    drsSting(t, { soft = false } = {}) {
      // A whoosh up into a bright two-note chime.
      const k = soft ? 0.5 : 1;
      const { f } = noise(t, 0.5, { freq: 600, Q: 1.5, peak: 0.25 * k, attack: 0.35 });
      f.frequency.setValueAtTime(400, t);
      f.frequency.exponentialRampToValueAtTime(5000, t + 0.6);
      for (const [dt, f0] of [[0.5, 659], [0.5, 988], [0.62, 1319]]) tone(t + dt, 0.6, { type: 'triangle', f0, peak: 0.09 * k, attack: 0.01 });
    },
    drsPulse(t) {
      // A heartbeat: lub-dub, low.
      tone(t, 0.14, { f0: 70, f1: 45, peak: 0.42, attack: 0.008 });
      tone(t + 0.19, 0.12, { f0: 62, f1: 42, peak: 0.3, attack: 0.008 });
    },
    drsWhir(t) {
      // The scanner sweeping: a filtered whir with a slow rising tone.
      const { f } = noise(t, 1.0, { freq: 1800, Q: 8, peak: 0.07, attack: 0.1 });
      f.frequency.setValueAtTime(900, t);
      f.frequency.exponentialRampToValueAtTime(3200, t + 1.0);
      tone(t, 1.0, { type: 'sawtooth', f0: 220, f1: 330, peak: 0.02, attack: 0.15 });
    },
    drsReveal(t, { good = false, uc = false } = {}) {
      const [a, b] = uc ? [660, 660] : good ? [740, 988] : [880, 587];
      tone(t, 0.09, { type: 'square', f0: a, peak: 0.07 });
      tone(t + 0.1, 0.16, { type: 'square', f0: b, peak: 0.07 });
    },
    drsRiser(t) {
      const { f } = noise(t, 1.3, { freq: 500, Q: 3, peak: 0.16, attack: 1.2 });
      f.frequency.setValueAtTime(300, t);
      f.frequency.exponentialRampToValueAtTime(6000, t + 1.35);
      tone(t, 1.3, { type: 'sawtooth', f0: 110, f1: 440, peak: 0.05, attack: 1.2 });
    },
    drsVerdict(t, { good = false } = {}) {
      // A hit: thump plus a chord, major for not out, a darker one for out.
      tone(t, 0.3, { f0: 90, f1: 40, peak: 0.55 });
      noise(t, 0.25, { type: 'lowpass', freq: 1200, peak: 0.35 });
      for (const f0 of good ? [523, 659, 784] : [440, 523, 622]) tone(t, 1.1, { type: 'triangle', f0, peak: 0.07, attack: 0.01 });
    },
    applause(t, { size = 0.35 } = {}) {
      noise(t, 1.8 + size * 2, { type: 'highpass', freq: 900, Q: 0.5, peak: 0.15 + 0.4 * size, attack: 0.2, buf: clapBuf, dest: stands });
      if (chatterBuf) loopVoices(chatterBuf, t, 1.6 + size * 2, { peak: 0.1 * size, attack: 0.3, cutoff: 2400 });
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
      if (bed) bed.gain.setTargetAtTime(p ? 0.0 : BED, now(), 0.2);
    },
    played,
    /** Output RMS right now (QA: proves something is actually sounding). */
    level() {
      if (!meter) return 0;
      const d = new Float32Array(meter.fftSize);
      meter.getFloatTimeDomainData(d);
      return Math.sqrt(d.reduce((a, v) => a + v * v, 0) / d.length);
    },
    /** QA: the context and the final mix node, to record what the game sounds like. */
    get tap() {
      return ctx && { ctx, out };
    },
    get muted() {
      return muted;
    },
  };
}
