// Everything about a ritual that is derived from the curse text. Same text -> same ritual.
import { archiveId, curseSeed, makeRng, type CurseInput } from '../../utils/seed/seed';
import { toGlyphs } from '../../utils/glyphs/translit';
import { generateCircle, type CircleDesign } from './art/generator';
import type { Palette } from './art/palette';

export interface RitualParams {
  seed: number;
  archiveId: string;
  input: CurseInput;
  glyphs: { name: number[]; reason: number[]; punishment: number[] };
  design: CircleDesign;
  palette: Palette;
  spinDir: 1 | -1;
  spinScale: number;
  bloom: number;
  particleDensity: number;
  lineWeight: number;
}

/** A tall screen (phones): the large structures are then laid out along the height. */
function isPortrait() {
  if (typeof window === 'undefined') return false;
  if (import.meta.env.DEV) {
    const q = new URLSearchParams(location.search);
    if (q.has('portrait')) return q.get('portrait') !== '0';
  }
  return window.innerHeight > window.innerWidth;
}

export function makeRitualParams(input: CurseInput): RitualParams {
  const seed = curseSeed(input);
  const rng = makeRng(seed);
  const glyphs = {
    name: toGlyphs(input.name),
    reason: toGlyphs(input.reason),
    punishment: toGlyphs(input.punishment),
  };
  const design = generateCircle({ seed, ...glyphs, portrait: isPortrait() });
  return {
    seed,
    archiveId: archiveId(seed),
    input,
    glyphs,
    design,
    palette: design.palette,
    spinDir: rng.sign(),
    spinScale: rng.range(0.8, 1.25),
    bloom: rng.range(0.85, 1.2),
    particleDensity: rng.range(0.8, 1.2),
    lineWeight: rng.range(0.9, 1.15),
  };
}
