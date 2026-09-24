// Sound that is not inside the videos:
//  - the "tail": the last noise of pribliji.mp4, time-stretched into a seamless loop, so the
//    ambience keeps breathing after the video ends while the circle keeps moving
//  - the seal engraving: synthesised scratch/crackle + low rumble, a soft thud and a chime
// Everything goes through one master gain that follows the sound toggle.

const BASE = import.meta.env.BASE_URL;

type Ctx = AudioContext;

export class RitualAudio {
  private ctx: Ctx | null = null;
  private master: GainNode | null = null;
  private tailBuffer: AudioBuffer | null = null;
  private tailSource: AudioBufferSourceNode | null = null;
  private tailGain: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private enabled = true;
  private loading: Promise<void> | null = null;

  /** Call from a click/tap: creates/resumes the audio context. */
  unlock() {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.enabled ? 1 : 0;
        this.master.connect(this.ctx.destination);
        this.loading = this.loadTail();
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch {
      this.ctx = null;
    }
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    if (this.ctx && this.master) this.master.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.08);
  }

  private async loadTail() {
    if (!this.ctx) return;
    const probe = document.createElement('audio');
    const ext = probe.canPlayType('audio/webm; codecs="opus"') ? 'webm' : 'm4a';
    try {
      const res = await fetch(`${BASE}media/tail.${ext}`);
      const buf = await res.arrayBuffer();
      this.tailBuffer = await this.ctx.decodeAudioData(buf);
    } catch {
      this.tailBuffer = null;
    }
  }

  /** Fades the stretched ending in (as the video's own sound ends). */
  async startTail(fadeIn = 1.4, volume = 0.75) {
    if (!this.ctx || !this.master) return;
    await this.loading;
    if (!this.tailBuffer || this.tailSource) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.tailBuffer;
    src.loop = true;
    // skip encoder padding at both ends
    src.loopStart = 0.03;
    src.loopEnd = this.tailBuffer.duration - 0.03;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, ctx.currentTime);
    g.gain.linearRampToValueAtTime(volume, ctx.currentTime + fadeIn);
    src.connect(g).connect(this.master);
    src.start(ctx.currentTime, 0.03);
    this.tailSource = src;
    this.tailGain = g;
  }

  stopTail(fade = 0.8) {
    if (!this.ctx || !this.tailSource || !this.tailGain) return;
    const t = this.ctx.currentTime;
    this.tailGain.gain.cancelScheduledValues(t);
    this.tailGain.gain.setValueAtTime(this.tailGain.gain.value, t);
    this.tailGain.gain.linearRampToValueAtTime(0, t + fade);
    this.tailSource.stop(t + fade + 0.05);
    this.tailSource = null;
    this.tailGain = null;
  }

  private noiseBuffer(): AudioBuffer | null {
    if (!this.ctx) return null;
    if (!this.noise) {
      const len = this.ctx.sampleRate * 2;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    return this.noise;
  }

  /** Engraving the seal: `duration` seconds of scratching, then a thud + chime. */
  engrave(duration: number) {
    const ctx = this.ctx;
    const out = this.master;
    const noise = this.noiseBuffer();
    if (!ctx || !out || !noise) return;
    const t0 = ctx.currentTime + 0.02;
    const t1 = t0 + duration;

    // scratch: band-passed noise with a jittery amplitude (the burin biting the wax)
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.4;
    bp.frequency.setValueAtTime(2600, t0);
    bp.frequency.linearRampToValueAtTime(1500, t1);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0, t0);
    const steps = Math.floor(duration * 28);
    for (let i = 0; i <= steps; i++) {
      const t = t0 + (i / steps) * duration;
      const env = Math.sin((Math.PI * i) / steps) * 0.7 + 0.3;
      amp.gain.linearRampToValueAtTime((0.05 + Math.random() * 0.13) * env, t);
    }
    amp.gain.linearRampToValueAtTime(0, t1 + 0.1);
    src.connect(bp).connect(amp).connect(out);
    src.start(t0);
    src.stop(t1 + 0.2);

    // crackles
    for (let i = 0; i < duration * 14; i++) {
      const t = t0 + Math.random() * duration;
      const c = ctx.createBufferSource();
      c.buffer = noise;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 3000 + Math.random() * 3000;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.12 + Math.random() * 0.12, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03 + Math.random() * 0.04);
      c.connect(hp).connect(g).connect(out);
      c.start(t, Math.random());
      c.stop(t + 0.1);
    }

    // low rumble of the vibrating sheet
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(46, t0);
    osc.frequency.linearRampToValueAtTime(38, t1);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0, t0);
    og.gain.linearRampToValueAtTime(0.18, t0 + 0.4);
    og.gain.linearRampToValueAtTime(0.12, t1 - 0.2);
    og.gain.linearRampToValueAtTime(0, t1 + 0.3);
    osc.connect(og).connect(out);
    osc.start(t0);
    osc.stop(t1 + 0.4);

    // the seal is set: a soft thud and a dark chime
    const thud = ctx.createOscillator();
    thud.type = 'sine';
    thud.frequency.setValueAtTime(90, t1);
    thud.frequency.exponentialRampToValueAtTime(38, t1 + 0.35);
    const tg = ctx.createGain();
    tg.gain.setValueAtTime(0.0001, t1);
    tg.gain.exponentialRampToValueAtTime(0.45, t1 + 0.01);
    tg.gain.exponentialRampToValueAtTime(0.0001, t1 + 0.6);
    thud.connect(tg).connect(out);
    thud.start(t1);
    thud.stop(t1 + 0.7);
    for (const [f, v] of [[311, 0.07], [466, 0.05], [622, 0.035], [932, 0.02]] as const) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t1 + 0.02);
      g.gain.exponentialRampToValueAtTime(v, t1 + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, t1 + 3.2);
      o.connect(g).connect(out);
      o.start(t1 + 0.02);
      o.stop(t1 + 3.3);
    }
  }
}
