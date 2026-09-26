// Dev gallery: the generated magic circle for a set of sample curses, in their own colours.
// Open http://localhost:5173/dev/circles.html while `npm run dev` is running.
// ?n=24 — how many circles; ?seed=word — a different sample set.
import { makeRitualParams } from '../src/features/ritual/params';
import type { Ink, Pen } from '../src/features/ritual/art/generator';
import { cssColor } from '../src/features/ritual/art/palette';

const q = new URLSearchParams(location.search);
const N = Number(q.get('n') ?? 12);
const salt = q.get('seed') ?? '';
const names = ['Viktor', 'Марина Петровна', 'Արամ', 'Boss', 'Neighbour', 'Кот Барсик', 'Karen', 'Лёша', 'Dr. Evil', 'Գոռ', 'Ivan', 'Anna', 'Sam', 'Olga', 'Tigran', 'Mia'];
const reasons = ['ate my yoghurt', 'поставила двойку', 'ուշացավ', 'Friday meetings', 'drilling at 7am', 'разбил вазу', 'spoilers', 'не вернул долг'];
const puns = ['eternal hiccups', 'икота', 'անքնություն', 'Mondays forever', 'lost keys', 'пылесос', 'wet socks', 'вечный дедлайн'];

const grid = document.getElementById('grid')!;
for (let i = 0; i < N; i++) {
  const s = { name: names[i % names.length] + salt, reason: reasons[(i * 3) % reasons.length], punishment: puns[(i * 5) % puns.length] };
  const P = makeRitualParams(s);
  const size = 700;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, size, size);
  ctx.translate(size / 2, size / 2);
  const k = size / 2 / 1.55;
  ctx.scale(k, k);
  ctx.lineCap = 'round';
  for (const l of P.design.layers) {
    const pal = l.palette;
    const col: Record<Ink, string> = { a: cssColor(pal.a), b: cssColor(pal.b), c: cssColor(pal.c) };
    const pen: Pen = {
      ctx,
      lw: 0.0042,
      ink: (ch) => {
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = ctx.fillStyle = col[ch];
      },
      erase: () => {
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = ctx.fillStyle = '#000';
      },
    };
    ctx.save();
    if (l.orbit) {
      ctx.translate(Math.cos(l.orbit.a) * l.orbit.r, Math.sin(l.orbit.a) * l.orbit.r);
      ctx.rotate(l.orbit.a + Math.PI / 2);
    }
    if (l.at) ctx.translate(l.at[0], l.at[1]);
    pen.ink('a');
    ctx.globalAlpha = l.hang ? 0.5 : 1;
    l.draw(pen);
    ctx.restore();
  }
  const fig = document.createElement('figure');
  fig.appendChild(c);
  const cap = document.createElement('figcaption');
  cap.textContent = `${s.name} · ${P.design.architecture} · ${P.design.layers.length} layers`;
  fig.appendChild(cap);
  grid.appendChild(fig);
}
document.body.dataset.ready = '1';
