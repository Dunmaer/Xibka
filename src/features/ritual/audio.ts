// Sound that is not inside the videos. Two sets (src/config.ts → SOUND_SET):
//  - 'new': the whole soundscape is played here (see soundscape.ts), the videos stay muted
//  - 'old': the videos' own sound, plus the "tail": the last noise of pribliji.mp4,
//    time-stretched into a seamless loop, so the ambience keeps breathing after the video ends
// In both sets the seal engraving is synthesised here: scratch/crackle + low rumble, a soft
// thud and a chime. Everything goes through one master gain that follows the sound toggle.
import { SOUND_SET } from '../../config';
import { Soundscape } from './soundscape';
import { MusicLoop } from './music';

/** Background music level (25 % of the track's own loudness). */
const MUSIC_VOLUME = 0.25;

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
  private scape: Soundscape | null = null;
  private music: MusicLoop | null = null;
  /** Which sound set plays; with 'new' the videos stay muted. */
  readonly set = SOUND_SET;

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
        if (this.set === 'new') {
          this.scape = new Soundscape(this.ctx, this.master, BASE);
          void this.scape.start();
          const probe = document.createElement('audio');
          const ext = probe.canPlayType('audio/webm; codecs="opus"') ? 'webm' : 'm4a';
          this.music = new MusicLoop(this.ctx, this.scape.post, `${BASE}media/music.${ext}`, MUSIC_VOLUME);
          window.setInterval(() => this.scape?.tick(), 500);
          // no thunder from a tab in the background
          document.addEventListener('visibilitychange', () => {
            if (!this.ctx) return;
            if (document.hidden) void this.ctx.suspend();
            else void this.ctx.resume();
          });
        } else this.loading = this.loadTail();
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      this.music?.start();
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

  // ---- new set: cues from the ritual (no-ops with the old set)

  /** Every frame of the ritual (F = pribliji frame, keeps counting after the video). */
  frame(F: number, prevF: number) {
    this.scape?.frame(F, prevF);
  }

  /** A piece of the circle snapped into place. */
  layerLocked(pan: number, size: number) {
    this.scape?.layerLocked(pan, size);
  }

  /** A tunnel piece rushes past the camera. */
  passerNear(pan: number) {
    this.scape?.passerNear(pan);
  }

  /** Skip / debug jump to a frame. */
  jump(F: number) {
    this.scape?.jump(F);
    if (F >= 258) void this.startTail(0.8);
  }

  /** Back to the empty altar. */
  reset() {
    this.scape?.reset();
    this.stopTail();
  }

  // ---- old set

  /** Fades the stretched ending in (as the video's own sound ends). */
  async startTail(fadeIn = 1.4, volume = 0.75) {
    if (this.set !== 'old' || !this.ctx || !this.master) return;
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

  /** Engraving the seal: `duration` seconds of scratching, then a thud + chime. */
  engrave(duration: number) {
    if (!this.ctx || !this.master) return;
    if (!this.noise) this.noise = makeNoise(this.ctx);
    playEngrave(this.ctx, this.scape?.input ?? this.master, this.noise, this.ctx.currentTime + 0.02, duration);
  }
}

function makeNoise(ctx: BaseAudioContext) {
  const len = ctx.sampleRate * 2;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

/** The synthesised seal engraving (kept from the first version in both sound sets). */
export function playEngrave(ctx: BaseAudioContext, out: AudioNode, noise: AudioBuffer, t0: number, duration: number) {
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
  // then two or three dark bell notes, each quieter than the one before, never the same tune
  const scale = [233.1, 277.2, 311.1, 370.0, 415.3, 466.2, 554.4]; // D# minor pentatonic-ish
  const count = Math.random() < 0.5 ? 2 : 3;
  let idx = 2 + Math.floor(Math.random() * 3);
  for (let n = 0; n < count; n++) {
    const at = t1 + 0.02 + n * (0.42 + Math.random() * 0.12);
    const level = [1, 0.55, 0.28][n];
    const base = scale[idx];
    for (const [k, v] of [[1, 0.07], [1.5, 0.05], [2, 0.035], [3, 0.02]] as const) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = base * k;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(v * level, at + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 3.2 - n * 0.5);
      o.connect(g).connect(out);
      o.start(at);
      o.stop(at + 3.3);
    }
    // next note: a step or two up or down the scale, always a different one
    const step = (Math.random() < 0.5 ? -1 : 1) * (1 + Math.floor(Math.random() * 2));
    idx = idx + step >= 0 && idx + step < scale.length ? idx + step : idx - step;
  }
}
