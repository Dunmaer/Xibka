// Dev gallery: renders the flat magic circle for a handful of sample curses.
// Open http://localhost:5173/dev/circles.html while `npm run dev` is running.
import { makeRitualParams } from '../src/features/ritual/params';
import { buildLayers } from '../src/features/ritual/art/circleArt';

const samples = [
  { name: 'Viktor', reason: 'ate my yoghurt', punishment: 'eternal hiccups' },
  { name: 'Марина Петровна', reason: 'поставила двойку', punishment: 'икота' },
  { name: 'Արամ', reason: 'ուշացավ', punishment: 'անքնություն' },
  { name: 'Boss', reason: 'Friday meetings', punishment: 'Mondays forever' },
  { name: 'Neighbour', reason: 'drilling at 7am', punishment: 'lost keys' },
  { name: 'Кот Барсик', reason: 'разбил вазу', punishment: 'пылесос' },
];

const grid = document.getElementById('grid')!;
const params = new URLSearchParams(location.search);
const only = params.get('layer');

for (const s of samples) {
  const P = makeRitualParams(s);
  const size = 900;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.translate(size / 2, size / 2);
  const k = size / 2 / 1.16;
  ctx.scale(k, k);
  ctx.strokeStyle = ctx.fillStyle = '#ffb877';
  ctx.lineCap = 'round';
  for (const l of buildLayers(P)) {
    if (only && l.id !== only) continue;
    ctx.save();
    l.draw({ ctx, lw: 0.0042 * P.lineWeight });
    ctx.restore();
  }
  const fig = document.createElement('figure');
  fig.appendChild(c);
  const cap = document.createElement('figcaption');
  cap.textContent = `${s.name} · ${P.palette.name} · star ${P.starPoints}/${P.starStep} · bands ${P.outerBand}/${P.midBand}/${P.innerBand} · discs ${P.innerDisc}/${P.coreDisc}`;
  fig.appendChild(cap);
  grid.appendChild(fig);
}
document.body.dataset.ready = '1';
