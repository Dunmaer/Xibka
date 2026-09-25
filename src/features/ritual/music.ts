// Background music ("Grinding Inferno"): plays the whole time the site is open, apart from the
// ritual. It streams from two <audio> elements that take turns: while one reaches its end, the
// other starts from the beginning and the two are crossfaded, so the loop has no seam and the
// long track never has to be decoded into memory.

const XFADE = 6; // s

export class MusicLoop {
  private players: HTMLAudioElement[] = [];
  private gains: GainNode[] = [];
  private active = 0;
  private switching = false;
  private started = false;

  constructor(private ctx: AudioContext, out: AudioNode, url: string, volume: number) {
    const bus = ctx.createGain();
    bus.gain.value = volume;
    bus.connect(out);
    for (let i = 0; i < 2; i++) {
      const a = new Audio(url);
      a.preload = i === 0 ? 'auto' : 'metadata';
      a.crossOrigin = 'anonymous';
      const g = ctx.createGain();
      g.gain.value = 0;
      ctx.createMediaElementSource(a).connect(g).connect(bus);
      this.players.push(a);
      this.gains.push(g);
    }
    window.setInterval(() => this.watch(), 250);
  }

  get playing() {
    return this.started && !this.players[this.active].paused;
  }

  /** Call from a click/tap (browsers, iOS above all, only let media start inside a gesture). */
  start() {
    if (this.started) return;
    this.started = true;
    const [a, b] = this.players;
    // let the second player be started later without a gesture
    void b.play().then(() => b.pause()).catch(() => {});
    a.currentTime = 0;
    void a.play().catch(() => {
      this.started = false;
    });
    const g = this.gains[0].gain;
    const t = this.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(0, t);
    g.linearRampToValueAtTime(1, t + 3);
  }

  private watch() {
    if (!this.started || this.switching) return;
    const cur = this.players[this.active];
    if (!cur.duration || cur.paused || cur.currentTime < cur.duration - XFADE) return;
    // the next pass starts under the end of this one
    this.switching = true;
    const next = this.active ^ 1;
    const np = this.players[next];
    np.currentTime = 0;
    void np.play().catch(() => {});
    const t = this.ctx.currentTime;
    const gIn = this.gains[next].gain;
    const gOut = this.gains[this.active].gain;
    gIn.cancelScheduledValues(t);
    gIn.setValueAtTime(0, t);
    gIn.linearRampToValueAtTime(1, t + XFADE);
    gOut.cancelScheduledValues(t);
    gOut.setValueAtTime(gOut.value, t);
    gOut.linearRampToValueAtTime(0, t + XFADE);
    const old = this.active;
    this.active = next;
    window.setTimeout(() => {
      this.players[old].pause();
      this.switching = false;
    }, (XFADE + 0.5) * 1000);
  }
}
