// Everything about a ritual that is derived from the curse text. Same text -> same ritual.
import { archiveId, curseSeed, makeRng, type CurseInput } from '../../utils/seed/seed';
import { toGlyphs } from '../../utils/glyphs/translit';
import { BAND_BLOCKS, DISC_BLOCKS } from './art/patterns';

export interface Palette {
  name: string;
  deep: [number, number, number];
  mid: [number, number, number];
  hot: [number, number, number];
  glow: [number, number, number];
}

const PALETTES: Palette[] = [
  { name: 'ember', deep: [0.35, 0.03, 0.0], mid: [1.0, 0.3, 0.06], hot: [1.0, 0.86, 0.6], glow: [1.0, 0.22, 0.03] },
  { name: 'crimson', deep: [0.3, 0.0, 0.02], mid: [1.0, 0.16, 0.1], hot: [1.0, 0.8, 0.66], glow: [0.85, 0.05, 0.06] },
  { name: 'gold', deep: [0.3, 0.1, 0.0], mid: [1.0, 0.55, 0.14], hot: [1.0, 0.95, 0.78], glow: [1.0, 0.42, 0.05] },
  { name: 'blood', deep: [0.25, 0.0, 0.0], mid: [0.95, 0.12, 0.04], hot: [1.0, 0.7, 0.45], glow: [0.75, 0.04, 0.0] },
  { name: 'hellviolet', deep: [0.22, 0.0, 0.12], mid: [1.0, 0.2, 0.24], hot: [1.0, 0.8, 0.86], glow: [0.8, 0.06, 0.32] },
];

export interface RitualParams {
  seed: number;
  archiveId: string;
  input: CurseInput;
  glyphs: { name: number[]; reason: number[]; punishment: number[] };
  palette: Palette;
  starPoints: number;
  starStep: number;
  outerBand: string;
  midBand: string;
  innerBand: string;
  innerDisc: string;
  coreDisc: string;
  gearTeeth: number;
  spokes: number;
  anchors: number;
  spin: number[]; // per layer, rad/s
  spinScale: number;
  bloom: number;
  particleDensity: number;
  fireAccent: number; // frame offset for the fire accents
  lineWeight: number;
}

export function makeRitualParams(input: CurseInput): RitualParams {
  const seed = curseSeed(input);
  const rng = makeRng(seed);
  const bandNames = [...Object.keys(BAND_BLOCKS), 'cartouches'];
  const discNames = Object.keys(DISC_BLOCKS);

  const starPoints = rng.pick([5, 6, 7, 8, 9]);
  const starStep = starPoints === 6 ? 2 : starPoints === 8 ? rng.pick([3, 3, 2]) : Math.floor(starPoints / 2);

  // Pick three different band blocks.
  const shuffled = [...bandNames].sort(() => rng() - 0.5);
  const dir = rng.sign();
  const spinScale = rng.range(0.8, 1.25);
  const palIdx = rng() < 0.08 ? 4 : Math.floor(rng() * 4); // violet only occasionally

  return {
    seed,
    archiveId: archiveId(seed),
    input,
    glyphs: {
      name: toGlyphs(input.name),
      reason: toGlyphs(input.reason),
      punishment: toGlyphs(input.punishment),
    },
    palette: PALETTES[palIdx],
    starPoints,
    starStep,
    outerBand: shuffled[0],
    midBand: shuffled[1],
    innerBand: shuffled[2],
    innerDisc: rng.pick(discNames.filter((d) => d !== 'spiral')),
    coreDisc: rng.chance(0.75) ? 'spiral' : rng.pick(discNames),
    gearTeeth: rng.pick([36, 42, 48, 60]),
    spokes: rng.pick([3, 4, 5, 6, 7]),
    anchors: rng.pick([4, 6, 8, 12]),
    // foundation, star, band, gear, inner, core, halo
    spin: [0.05, -0.09, 0.13, -0.21, 0.3, -0.5, 0.07].map((s) => s * dir * rng.range(0.85, 1.15)),
    spinScale,
    bloom: rng.range(0.85, 1.2),
    particleDensity: rng.range(0.8, 1.2),
    fireAccent: rng.int(-2, 3),
    lineWeight: rng.range(0.9, 1.15),
  };
}
