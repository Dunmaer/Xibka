// Flat (2D) rendering of a curse's circle, used on the certificate.
import type { RitualParams } from '../params';
import type { Pen } from './generator';

/**
 * Draws every layer of the circle with the context's current fill/stroke colour.
 * Holes that the layers cut (erase) become transparent, so draw onto a separate canvas
 * and composite it where needed.
 */
export function drawFlatCircle(ctx: CanvasRenderingContext2D, P: RitualParams, lw: number, skipHanging = true) {
  const color = ctx.strokeStyle;
  const pen: Pen = {
    ctx,
    lw,
    ink: () => {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
    },
    erase: () => {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = '#000';
      ctx.fillStyle = '#000';
    },
  };
  for (const l of P.design.layers) {
    if (skipHanging && l.hang) continue;
    ctx.save();
    if (l.orbit) {
      ctx.translate(Math.cos(l.orbit.a) * l.orbit.r, Math.sin(l.orbit.a) * l.orbit.r);
      ctx.rotate(l.orbit.a + Math.PI / 2);
    }
    pen.ink('a');
    l.draw(pen);
    ctx.restore();
  }
}
