// The new sound set (cut from Sounds/ by scripts/prepare_assets.py):
//  - beds that never stop: cave wind and crackling fire; a roaring fire and the even drone of
//    the magic circle come and go with the ritual
//  - the background lives: thunder rolls and the cave moans at random moments
//  - one-shots tied to what is on screen: a rush into the impact, the paper catching fire,
//    thunder + eruption when the circle locks, sparkles as its pieces snap in, flutters as the
//    tunnel pieces fly past, a flutter as the certificate rises
// Loop beds are rebuilt after decoding with an equal-power crossfade of their own ends, so the
// loops have no seam (codec padding never reaches the loop point).
import { F as K } from './timeline';

const NAMES = ['cave', 'fire', 'roar', 'drone', 'flare', 'burst', 'thunder1', 'thunder2', 'thunder3', 'moan', 'whoosh', 'spell', 'flutter'] as const;
type Name = (typeof NAMES)[number];
type Bed = 'cave' | 'fire' | 'roar' | 'drone';

/** Crossfade (s) used to close each bed into a loop. */
const LOOP_XFADE: Record<Bed, number> = { cave: 2.2, fire: 2.5, roar: 1.6, drone: 2.4 };
/** Where the crack sits inside each thunder file (s), for the synthesised transient. */
const CRACK: Record<string, number> = { thunder1: 0.32, thunder2: 1.52, thunder3: 0.28 };

type Phase = 'idle' | 'ritual' | 'dive' | 'final' | 'rest';
/** Bed levels per phase (linear gain on beds normalised to about -21 dBFS RMS). */
const LEVELS: Record<Phase, Record<Bed, number>> = {
  idle: { cave: 0.62, fire: 0.42, roar: 0, drone: 0 },
  ritual: { cave: 0.68, fire: 0.6, roar: 0.22, drone: 0 },
  dive: { cave: 0.45, fire: 0.5, roar: 0.36, drone: 0.5 },
  final: { cave: 0.5, fire: 0.36, roar: 0.16, drone: 0.52 },
  // the main animation is over: the circle only hums (5x quieter)
  rest: { cave: 0.5, fire: 0.36, roar: 0.16, drone: 0.1 },
};

interface PlayOpts {
  gain?: number;
  rate?: number;
  pan?: number;
  offset?: number;
  /** Play only this long (s), with a short fade at the end. */
  dur?: number;
  reverse?: boolean;
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);

export class Soundscape {
  private buffers = new Map<Name, AudioBuffer>();
  private reversedWhoosh: AudioBuffer | null = null;
  private noise: AudioBuffer;
  private beds = new Map<Bed, GainNode>();
  private amb: GainNode;
  private fx: GainNode;
  private phase: Phase = 'idle';
  private started = false;
  private nextThunder = 0;
  private nextMoan = 0;
  private lastSpark = -1;
  private lastFlutter = -1;
  readonly ready: Promise<void>;
  /** Where other sounds (the seal engraving) join the mix, so the limiter covers them too. */
  readonly input: AudioNode;
  /** The limiter at the end of the chain (the music joins here, past the compressor). */
  readonly post: AudioNode;

  constructor(
    private ctx: BaseAudioContext,
    out: AudioNode,
    private base: string,
    /** Scheduling clock; an offline render passes its own. */
    private clock: () => number = () => ctx.currentTime + 0.03,
  ) {
    // everything is glued by a gentle compressor, so thunder over the eruption never clips
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.knee.value = 10;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.3;
    const gain = ctx.createGain();
    gain.gain.value = 1.1;
    // and a limiter at the very end catches the peaks the compressor lets through
    const limit = ctx.createDynamicsCompressor();
    limit.threshold.value = -3;
    limit.knee.value = 0;
    limit.ratio.value = 20;
    limit.attack.value = 0.001;
    limit.release.value = 0.15;
    const trim = ctx.createGain();
    trim.gain.value = 0.9;
    comp.connect(gain).connect(limit).connect(trim).connect(out);
    this.post = limit;
    this.amb = ctx.createGain();
    this.fx = ctx.createGain();
    this.amb.connect(comp);
    this.fx.connect(comp);
    this.input = comp;
    const len = Math.round(ctx.sampleRate * 0.5);
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.ready = this.load();
  }

  private now() {
    return this.clock();
  }

  private async fetchDecode(name: Name, ext: string): Promise<AudioBuffer> {
    const res = await fetch(`${this.base}media/sfx/${name}.${ext}`);
    if (!res.ok) throw new Error(`${name}.${ext}: ${res.status}`);
    const data = await res.arrayBuffer();
    return await this.ctx.decodeAudioData(data);
  }

  private async load() {
    const probe = typeof document !== 'undefined' ? document.createElement('audio') : null;
    const first = probe?.canPlayType('audio/webm; codecs="opus"') ? 'webm' : 'm4a';
    await Promise.all(
      NAMES.map(async (name) => {
        let buf: AudioBuffer | null = null;
        for (const ext of first === 'webm' ? ['webm', 'm4a'] : ['m4a', 'webm']) {
          try {
            buf = await this.fetchDecode(name, ext);
            break;
          } catch {
            // try the other format
          }
        }
        if (!buf) return;
        this.buffers.set(name, name in LOOP_XFADE ? this.makeLoop(buf, LOOP_XFADE[name as Bed]) : buf);
      }),
    );
    const w = this.buffers.get('whoosh');
    if (w) this.reversedWhoosh = this.reverse(w);
  }

  /** Closes a bed into a seamless loop: its tail is crossfaded (equal power) into its head. */
  private makeLoop(buf: AudioBuffer, xfade: number): AudioBuffer {
    const sr = buf.sampleRate;
    const trim = Math.round(0.06 * sr); // skips codec padding and edge clicks
    const n = buf.length - 2 * trim;
    const x = Math.min(Math.round(xfade * sr), Math.floor(n / 3));
    const L = n - x;
    const out = this.ctx.createBuffer(buf.numberOfChannels, L, sr);
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const src = buf.getChannelData(c).subarray(trim, trim + n);
      const o = out.getChannelData(c);
      o.set(src.subarray(0, L));
      for (let i = 0; i < x; i++) {
        const t = (i / x) * (Math.PI / 2);
        o[i] = src[i] * Math.sin(t) + src[L + i] * Math.cos(t);
      }
    }
    return out;
  }

  private reverse(buf: AudioBuffer): AudioBuffer {
    const out = this.ctx.createBuffer(buf.numberOfChannels, buf.length, buf.sampleRate);
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const s = buf.getChannelData(c);
      const o = out.getChannelData(c);
      for (let i = 0, n = s.length; i < n; i++) o[i] = s[n - 1 - i];
    }
    return out;
  }

  /** Starts the beds (they then run forever) and the random background life. */
  async start() {
    await this.ready;
    if (this.started) return;
    this.started = true;
    const t = this.now();
    for (const bed of ['cave', 'fire', 'roar', 'drone'] as const) {
      const buf = this.buffers.get(bed);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.connect(this.amb);
      this.beds.set(bed, g);
      if (!buf) continue;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.connect(g);
      // start somewhere inside the loop, so a reload never sounds the same
      src.start(t, Math.random() * buf.duration);
    }
    this.applyLevels(2.5);
    this.nextThunder = t + rand(4, 9);
    this.nextMoan = t + rand(8, 16);
  }

  private applyLevels(tau: number, at = this.now()) {
    const lv = LEVELS[this.phase];
    for (const [bed, g] of this.beds) g.gain.setTargetAtTime(lv[bed], at, tau / 3);
  }

  private setPhase(p: Phase, tau: number, at?: number) {
    if (this.phase === p) return;
    this.phase = p;
    this.applyLevels(tau, at);
  }

  private play(name: Name | 'whooshRev', at: number, o: PlayOpts = {}) {
    const buf = name === 'whooshRev' ? this.reversedWhoosh : this.buffers.get(name);
    if (!buf) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = o.rate ?? 1;
    const g = ctx.createGain();
    const gain = o.gain ?? 1;
    g.gain.setValueAtTime(gain, at);
    let node: AudioNode = src.connect(g);
    if (o.pan && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, o.pan));
      node = node.connect(p);
    }
    node.connect(this.fx);
    const offset = o.offset ?? 0;
    if (o.dur) {
      const end = at + o.dur;
      g.gain.setValueAtTime(gain, end - Math.min(0.4, o.dur * 0.4));
      g.gain.linearRampToValueAtTime(0, end);
      src.start(at, offset, o.dur * (o.rate ?? 1) + 0.05);
    } else src.start(at, offset);
  }

  /** A sharp crack on top of a thunder file (noise burst + low thump). */
  private crack(at: number, gain: number, pan: number) {
    const ctx = this.ctx;
    const n = ctx.createBufferSource();
    n.buffer = this.noise;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1100;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.5 * gain, at + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.16);
    let node: AudioNode = n.connect(hp).connect(g);
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      node = node.connect(p);
    }
    node.connect(this.fx);
    n.start(at, Math.random() * 0.3, 0.2);
    this.boom(at, 0.55 * gain, 70, 34, 0.7);
  }

  private boom(at: number, gain: number, f0: number, f1: number, len: number) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(f0, at);
    o.frequency.exponentialRampToValueAtTime(f1, at + len);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(gain, at + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, at + len);
    o.connect(g).connect(this.fx);
    o.start(at);
    o.stop(at + len + 0.05);
  }

  private thunder(at: number, gain: number, which?: 'thunder1' | 'thunder2' | 'thunder3') {
    const name = which ?? (['thunder1', 'thunder1', 'thunder2', 'thunder3'] as const)[Math.floor(Math.random() * 4)];
    const rate = which ? 1 : rand(0.86, 1.08);
    const pan = which ? 0 : rand(-0.7, 0.7);
    this.play(name, at, { gain, rate, pan });
    this.crack(at + CRACK[name] / rate, gain, pan);
  }

  /** Random background life: thunder and the moaning cave. Call it often (it looks ahead). */
  tick(now = this.now()) {
    if (!this.started) return;
    const ahead = now + 2.5;
    while (this.nextThunder < ahead) {
      const final = this.phase === 'final' || this.phase === 'rest';
      this.thunder(Math.max(now, this.nextThunder), final ? rand(0.35, 0.55) : rand(0.55, 0.9));
      this.nextThunder += final ? rand(14, 28) : this.phase === 'idle' ? rand(9, 20) : rand(6, 13);
    }
    while (this.nextMoan < ahead) {
      this.play('moan', Math.max(now, this.nextMoan), { gain: rand(0.3, 0.5), rate: rand(0.78, 1.04), pan: rand(-0.8, 0.8) });
      this.nextMoan += rand(15, 30);
    }
  }

  /** Timeline cues, keyed to the frame numbers of pribliji (F keeps counting after the video). */
  frame(F: number, prevF: number) {
    if (!this.started) return;
    const now = this.now();
    const at = (f: number) => prevF < f && F >= f && F - f < 8;
    /** Time (context clock) of a future frame. */
    const timeOf = (f: number) => now + (f - F) / 24;
    this.tick(now);
    if (at(0)) this.setPhase('ritual', 6);
    if (at(135)) this.play('whooshRev', Math.max(now, timeOf(K.assembled) - 4.62), { gain: 0.38 });
    if (at(166)) {
      this.thunder(now, 0.7, 'thunder2');
      this.nextThunder = Math.max(this.nextThunder, now + 7);
    }
    if (at(K.circlesOn)) {
      this.setPhase('dive', 3.5);
      this.play('spell', now, { gain: 0.2, rate: 0.62 });
      this.play('flutter', now + 0.05, { gain: 0.16, rate: 0.8 });
    }
    if (at(K.zoomStart)) this.play('whoosh', now, { gain: 0.36, rate: 1.05 });
    // a breath before the impact: the beds sink for a moment so the strike hits harder
    if (at(K.assembled - 5)) this.amb.gain.setTargetAtTime(0.35, now, 0.06);
    if (at(K.paperBurnStart)) this.play('burst', now, { gain: 0.32, rate: 1.12 });
    if (at(K.assembled)) this.impact(now);
    if (at(K.uiOn)) this.setPhase('rest', 6);
    if (at(K.certBirth)) {
      this.play('flutter', now, { gain: 0.24, rate: 0.9 });
      this.play('spell', now + 0.35, { gain: 0.18, rate: 0.75 });
    }
  }

  /** The circle is complete: thunder, eruption and a flare of the fire. */
  private impact(now: number) {
    this.amb.gain.setTargetAtTime(1, now + 0.25, 0.4);
    this.thunder(now, 1, 'thunder1');
    this.play('burst', now, { gain: 0.85 });
    this.play('flare', now + 0.08, { gain: 0.5 });
    this.boom(now, 0.7, 58, 28, 1.3);
    this.nextThunder = Math.max(this.nextThunder, now + 12);
    // the roar flares up, then everything settles into the final bed
    const roar = this.beds.get('roar');
    roar?.gain.setTargetAtTime(0.75, now, 0.05);
    this.phase = 'final';
    this.applyLevels(5, now + 0.6);
  }

  /** A piece of the circle snaps into place (pan -1..1, size = its radius). */
  layerLocked(pan: number, size: number) {
    if (!this.started) return;
    const now = this.now();
    if (now - this.lastSpark < 0.07) return;
    this.lastSpark = now;
    const rate = 0.85 + (1 - Math.min(1.2, size) / 1.2) * 0.55 + rand(-0.06, 0.06);
    this.play('spell', now, { gain: rand(0.06, 0.1), rate, pan: pan * 0.8, dur: 1.1 });
  }

  /** A tunnel piece rushes past the camera. */
  passerNear(pan: number) {
    if (!this.started) return;
    const now = this.now();
    if (now - this.lastFlutter < 0.12 || Math.random() < 0.35) return;
    this.lastFlutter = now;
    this.play('flutter', now, { gain: rand(0.07, 0.12), rate: rand(1.15, 1.6), pan: pan * 0.9, dur: 1.2 });
  }

  /** A skip / debug jump: set the beds for that moment without firing the cues in between. */
  jump(F: number) {
    this.amb.gain.setTargetAtTime(1, this.now(), 0.2);
    this.setPhase(F >= K.uiOn ? 'rest' : F >= K.assembled ? 'final' : F >= K.circlesOn ? 'dive' : F >= 0 ? 'ritual' : 'idle', 1.5);
  }

  /** Back to the empty altar: the magic fades, the cave and the fire stay. */
  reset() {
    this.amb.gain.setTargetAtTime(1, this.now(), 0.3);
    this.setPhase('idle', 2.5);
  }
}
