// The blood-red "signature" in the infernal script: the first letters of the target's name with
// a flourish under them. The same mark is written on the note and signs the certificate.
import { toGlyphs } from '../../../utils/glyphs/translit';
import { drawGlyph } from '../../../utils/glyphs/glyphLibrary';

const STEP = 46;
const SIZE = 82;

export function signatureGlyphs(name: string): number[] {
  return toGlyphs(name).filter((g) => g >= 0).slice(0, 4);
}

/** Width of the letters at `unit` scale (the flourish reaches a little further on both sides). */
export function signatureWidth(glyphs: number[], unit = 1): number {
  return Math.max(0, glyphs.length - 1) * STEP * unit;
}

/** Draws at the current origin: letters centred on y = 0 from x = 0, the flourish below. */
export function drawSignature(ctx: CanvasRenderingContext2D, glyphs: number[], unit = 1) {
  ctx.save();
  ctx.fillStyle = 'rgba(120, 8, 6, 0.85)';
  glyphs.forEach((g, i) => {
    ctx.save();
    ctx.translate(i * STEP * unit, 0);
    drawGlyph(ctx, g, SIZE * unit);
    ctx.restore();
  });
  ctx.strokeStyle = 'rgba(120, 8, 6, 0.7)';
  ctx.lineWidth = 3 * unit;
  ctx.beginPath();
  ctx.moveTo(-30 * unit, 50 * unit);
  ctx.bezierCurveTo(60 * unit, 70 * unit, glyphs.length * 30 * unit, 30 * unit, (glyphs.length * STEP + 20) * unit, 56 * unit);
  ctx.stroke();
  ctx.restore();
}
