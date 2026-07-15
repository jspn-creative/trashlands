/** Tiny synth effects — no audio assets needed for v1. */
export class Sound {
  enabled = true;
  /** "" = classic pops; "bubble" = the blorpy set (M3); "clang" = scrap-metal set (M12). */
  popStyle = "";
  private ctx: AudioContext | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private ambient: { src: AudioBufferSourceNode; lfo: OscillatorNode } | null = null;

  unlock(): void {
    if (!this.ctx) {
      this.ctx = new AudioContext();
    }
    if (this.ctx.state === "suspended") {
      void this.ctx.resume();
    }
  }

  private ready(): AudioContext | null {
    const ctx = this.ctx;
    if (!this.enabled || !ctx || ctx.state !== "running") return null;
    return ctx;
  }

  private tone(
    ctx: AudioContext,
    type: OscillatorType,
    from: number,
    to: number,
    dur: number,
    vol: number,
    delay = 0,
  ): void {
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + dur);
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur + 0.02);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  private ensureNoise(ctx: AudioContext): void {
    if (this.noiseBuf) return;
    const len = Math.floor(ctx.sampleRate * 0.25);
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }

  private crunch(ctx: AudioContext, dur: number, vol: number): void {
    this.ensureNoise(ctx);
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(900, t);
    filter.frequency.exponentialRampToValueAtTime(120, t + dur);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter).connect(gain).connect(ctx.destination);
    src.start(t);
    src.stop(t + dur);
  }

  /** Pitch drops with size class, rises with the combo multiplier. */
  pop(cls: number, comboMult = 1): void {
    const ctx = this.ready();
    if (!ctx) return;
    const comboLift = 1 + (comboMult - 1) * 0.12;
    if (this.popStyle === "bubble") {
      // Blorp: pitch chirps upward instead of down, wetter and rounder.
      const f0 = Math.max(90, 320 - cls * 55) * comboLift;
      this.tone(ctx, "sine", f0, f0 * 2.1, 0.1, 0.15);
      this.tone(ctx, "sine", f0 * 0.5, f0 * 1.1, 0.14, 0.07, 0.02);
    } else if (this.popStyle === "clang") {
      // Scrap metal: a short square-wave clank plus a ringing overtone.
      const f0 = Math.max(140, 600 - cls * 90) * comboLift;
      this.tone(ctx, "square", f0, f0 * 0.7, 0.07, 0.1);
      this.tone(ctx, "triangle", f0 * 2.4, f0 * 1.6, 0.16, 0.06, 0.01);
    } else {
      const startFreq = Math.max(120, 560 - cls * 95) * comboLift;
      this.tone(ctx, "sine", startFreq, startFreq * 0.55, 0.12, 0.14);
    }
    if (cls >= 3) this.crunch(ctx, 0.14 + cls * 0.02, 0.05 + cls * 0.02);
  }

  /** The combo multiplier just ticked up a tier. */
  comboUp(mult: number): void {
    const ctx = this.ready();
    if (!ctx) return;
    const base = 320 + mult * 70;
    this.tone(ctx, "square", base, base, 0.06, 0.055);
    this.tone(ctx, "square", base * 1.26, base * 1.26, 0.09, 0.055, 0.06);
  }

  /** Zone-clean fanfare: quick rising arpeggio + sparkle. */
  zoneClear(): void {
    const ctx = this.ready();
    if (!ctx) return;
    this.tone(ctx, "sine", 523, 523, 0.12, 0.12);
    this.tone(ctx, "sine", 659, 659, 0.12, 0.12, 0.09);
    this.tone(ctx, "sine", 784, 784, 0.2, 0.13, 0.18);
    this.tone(ctx, "triangle", 1568, 2093, 0.25, 0.05, 0.18);
  }

  /** Big satisfying gulp for consuming a rival blob. */
  eatBlob(): void {
    const ctx = this.ready();
    if (!ctx) return;
    this.tone(ctx, "sine", 300, 70, 0.28, 0.22);
    this.tone(ctx, "sine", 450, 110, 0.2, 0.12, 0.05);
    this.crunch(ctx, 0.3, 0.12);
  }

  /** The player got eaten. */
  death(): void {
    const ctx = this.ready();
    if (!ctx) return;
    this.tone(ctx, "sawtooth", 220, 55, 0.5, 0.1);
    this.tone(ctx, "sine", 330, 82, 0.5, 0.12);
  }

  /** Final-seconds countdown blip. */
  tick(): void {
    const ctx = this.ready();
    if (!ctx) return;
    this.tone(ctx, "square", 880, 860, 0.07, 0.05);
  }

  /** Match-over whistle. */
  whistle(): void {
    const ctx = this.ready();
    if (!ctx) return;
    this.tone(ctx, "sine", 700, 1050, 0.16, 0.1);
    this.tone(ctx, "sine", 1050, 700, 0.3, 0.1, 0.18);
  }

  /** Soft breathing wind bed for zen mode (M5). */
  startAmbient(): void {
    const ctx = this.ready();
    if (!ctx || this.ambient) return;
    this.ensureNoise(ctx);
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 240;
    const gain = ctx.createGain();
    gain.gain.value = 0.02;
    // Slow swell so it feels like distant surf, not a fan.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.09;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.011;
    lfo.connect(lfoGain).connect(gain.gain);
    src.connect(filter).connect(gain).connect(ctx.destination);
    src.start();
    lfo.start();
    this.ambient = { src, lfo };
  }

  stopAmbient(): void {
    if (!this.ambient) return;
    try {
      this.ambient.src.stop();
      this.ambient.lfo.stop();
    } catch {
      // Already stopped — nothing to clean up.
    }
    this.ambient = null;
  }

  /** Jellyfish zap (The Deep End hazard). */
  sting(): void {
    const ctx = this.ready();
    if (!ctx) return;
    this.tone(ctx, "sawtooth", 780, 160, 0.16, 0.07);
    this.tone(ctx, "sine", 1300, 340, 0.12, 0.06);
  }

  /** Rolling ocean wave (Boardwalk Dump hazard). */
  wave(): void {
    const ctx = this.ready();
    if (!ctx) return;
    this.crunch(ctx, 1.2, 0.16);
    this.tone(ctx, "sine", 90, 45, 1.1, 0.07);
  }

  /** Seagull squawk — two harsh descending cries. */
  squawk(): void {
    const ctx = this.ready();
    if (!ctx) return;
    this.tone(ctx, "sawtooth", 1250, 850, 0.14, 0.06);
    this.tone(ctx, "sawtooth", 1350, 800, 0.18, 0.06, 0.2);
  }

  /** Blob-vs-blob bounce thud. */
  bounce(): void {
    const ctx = this.ready();
    if (!ctx) return;
    this.tone(ctx, "sine", 150, 70, 0.12, 0.1);
  }

  /** Asteroid impact — a low rocky crunch (Junk Orbit hazard). */
  asteroidHit(): void {
    const ctx = this.ready();
    if (!ctx) return;
    this.crunch(ctx, 0.22, 0.15);
    this.tone(ctx, "sawtooth", 130, 55, 0.2, 0.09);
  }

  /** Magnet power-up pickup — a magnetic "clunk-hum". */
  magnetOn(): void {
    const ctx = this.ready();
    if (!ctx) return;
    this.tone(ctx, "square", 180, 260, 0.14, 0.08);
    this.tone(ctx, "sine", 520, 520, 0.2, 0.05, 0.05);
  }

  /** Turbo power-up pickup — a rising whoosh. */
  turboOn(): void {
    const ctx = this.ready();
    if (!ctx) return;
    this.tone(ctx, "sawtooth", 260, 900, 0.22, 0.09);
  }

  /** Trash Shield power-up pickup — a bright protective chime. */
  shieldOn(): void {
    const ctx = this.ready();
    if (!ctx) return;
    this.tone(ctx, "sine", 660, 660, 0.1, 0.1);
    this.tone(ctx, "sine", 880, 880, 0.16, 0.08, 0.06);
  }

  /** Shrink Ray fires — a descending zap on whoever it shrinks. */
  shrinkZap(): void {
    const ctx = this.ready();
    if (!ctx) return;
    this.tone(ctx, "sawtooth", 1100, 220, 0.28, 0.1);
    this.tone(ctx, "square", 900, 180, 0.2, 0.06, 0.03);
  }

  /** UFO tractor beam hum — a wobbling sci-fi warble (Junk Orbit hazard). */
  tractorBeam(): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(220, t);
    osc.frequency.linearRampToValueAtTime(340, t + 0.6);
    osc.frequency.linearRampToValueAtTime(220, t + 1.2);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 7;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 40;
    lfo.connect(lfoGain).connect(osc.frequency);
    gain.gain.setValueAtTime(0.001, t);
    gain.gain.linearRampToValueAtTime(0.09, t + 0.1);
    gain.gain.setValueAtTime(0.09, t + 1.0);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 1.3);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    lfo.start(t);
    osc.stop(t + 1.35);
    lfo.stop(t + 1.35);
  }
}
