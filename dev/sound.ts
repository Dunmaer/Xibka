// Renders the whole ritual's soundtrack offline, with the same code the page uses, so it can
// be listened to (and checked) without clicking through the ritual.
// Open http://localhost:5173/dev/sound.html while `npm run dev` is running. ?len=60 = seconds.
import { Soundscape } from '../src/features/ritual/soundscape';
import { playEngrave } from '../src/features/ritual/audio';
import { makeRitualParams } from '../src/features/ritual/params';
import { F as K } from '../src/features/ritual/timeline';

const q = new URLSearchParams(location.search);
const LEN = Number(q.get('len') ?? 48);
// ?mute=… see below
const SR = 48000;
const RITUAL_AT = 8; // s: F = 0

async function render() {
  const ctx = new OfflineAudioContext(2, LEN * SR, SR);
  let clock = 0;
  const scape = new Soundscape(ctx, ctx.destination, import.meta.env.BASE_URL, () => clock);
  await scape.ready;
  // ?mute=thunder1,spell,beds — leave parts out, to hear (or measure) the rest
  const mute = new Set((q.get('mute') ?? '').split(',').filter(Boolean));
  const hooks = scape as unknown as { play: (n: string, ...a: unknown[]) => void; crack: (...a: unknown[]) => void; amb: GainNode };
  const play = hooks.play.bind(scape);
  hooks.play = (n, ...a) => void (!mute.has(n) && play(n, ...a));
  if (mute.has('crack')) hooks.crack = () => {};
  await scape.start();
  if (mute.has('beds')) hooks.amb.disconnect();
  if (!mute.has('music')) {
    // the page streams the music; here it is simply decoded and played from the start
    const data = await (await fetch(`${import.meta.env.BASE_URL}media/music.webm`)).arrayBuffer();
    const src = ctx.createBufferSource();
    src.buffer = await ctx.decodeAudioData(data);
    const g = ctx.createGain();
    g.gain.value = 0.25;
    src.connect(g).connect(scape.post);
    src.start(0);
  }

  // what the engine would report: layers snapping in, tunnel pieces rushing past
  const P = makeRitualParams({ name: 'Viktor', reason: 'ate my yoghurt from the office fridge', punishment: 'eternal hiccups' });
  const locks = P.design.layers.map((l) => ({ f: l.arrive, pan: l.orbit ? Math.cos(l.orbit.a) * 0.8 : 0, size: l.radius }));
  const passers = Array.from({ length: 30 }, () => {
    const spawn = K.passersFrom + Math.random() * (K.passersTo - K.passersFrom);
    return { f: spawn + 0.8 * (30 + Math.random() * 32), pan: Math.random() * 2 - 1 };
  });

  const noise = ctx.createBuffer(1, SR * 2, SR);
  noise.getChannelData(0).forEach((_, i, d) => (d[i] = Math.random() * 2 - 1));

  let prevF = -1;
  for (let t = 0; t < LEN; t += 1 / 24) {
    clock = t;
    scape.tick(t);
    if (t < RITUAL_AT) continue;
    const F = Math.round((t - RITUAL_AT) * 24);
    scape.frame(F, prevF);
    for (const l of locks) if (prevF < l.f && F >= l.f) scape.layerLocked(l.pan, l.size);
    for (const p of passers) if (prevF < p.f && F >= p.f) scape.passerNear(p.pan);
    if (prevF < K.engraveStart && F >= K.engraveStart) playEngrave(ctx, scape.input, noise, t + 0.02, (K.engraveEnd - K.engraveStart) / 24);
    if (F >= 400) scape.reset();
    prevF = F;
  }
  return ctx.startRendering();
}

function toWav(buf: AudioBuffer): Blob {
  const n = buf.length;
  const out = new DataView(new ArrayBuffer(44 + n * 4));
  const str = (o: number, s: string) => [...s].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  out.setUint32(4, 36 + n * 4, true);
  str(8, 'WAVEfmt ');
  out.setUint32(16, 16, true);
  out.setUint16(20, 1, true);
  out.setUint16(22, 2, true);
  out.setUint32(24, SR, true);
  out.setUint32(28, SR * 4, true);
  out.setUint16(32, 4, true);
  out.setUint16(34, 16, true);
  str(36, 'data');
  out.setUint32(40, n * 4, true);
  const L = buf.getChannelData(0);
  const R = buf.getChannelData(1);
  for (let i = 0; i < n; i++) {
    out.setInt16(44 + i * 4, Math.max(-1, Math.min(1, L[i])) * 32767, true);
    out.setInt16(46 + i * 4, Math.max(-1, Math.min(1, R[i])) * 32767, true);
  }
  return new Blob([out], { type: 'audio/wav' });
}

render().then((buf) => {
  let peak = 0;
  for (let c = 0; c < 2; c++) for (const v of buf.getChannelData(c)) peak = Math.max(peak, Math.abs(v));
  const url = URL.createObjectURL(toWav(buf));
  (document.getElementById('player') as HTMLAudioElement).src = url;
  const dl = document.getElementById('dl') as HTMLAnchorElement;
  dl.href = url;
  dl.textContent = 'Download WAV';
  document.getElementById('status')!.textContent = `${LEN} s rendered, peak ${(20 * Math.log10(peak)).toFixed(1)} dBFS`;
  document.body.dataset.ready = '1';
});
