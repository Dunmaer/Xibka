// The visitor's note: bumajka.png with their words handwritten on the ruled lines,
// plus a second mask with the same words in infernal letters (they burn through later).
import paperUrl from '../../../assets/paper.webp';
import type { CurseInput } from '../../../utils/seed/seed';
import type { Dict } from '../../i18n/strings';
import { toGlyphs } from '../../../utils/glyphs/translit';
import { drawGlyph, glyphWidth } from '../../../utils/glyphs/glyphLibrary';
import { loadImage } from '../../../utils/image';

// Measured on bumajka.png (1500 x 1049): ruled lines and the red margin.
const RULES = [96, 185, 262, 330, 399, 467, 537, 609, 678, 753, 822, 892, 965];
const MARGIN_X = 247;
const RIGHT_X = 1440;

export const HAND_FONT = '"Caveat", "Noto Serif Armenian", cursive';

export interface PaperArt {
  paper: HTMLCanvasElement;
  runes: HTMLCanvasElement;
  aspect: number;
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(test).width <= maxW || !cur) cur = test;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  // Hard-break single words that are still too long.
  return lines.flatMap((l) => {
    if (ctx.measureText(l).width <= maxW) return [l];
    const out: string[] = [];
    let chunk = '';
    for (const ch of l) {
      if (ctx.measureText(chunk + ch).width > maxW && chunk) {
        out.push(chunk);
        chunk = ch;
      } else chunk += ch;
    }
    if (chunk) out.push(chunk);
    return out;
  });
}

export async function renderPaper(input: CurseInput, t: Dict): Promise<PaperArt> {
  const img = await loadImage(paperUrl);
  const W = img.naturalWidth || 1500;
  const H = img.naturalHeight || 1049;
  const paper = document.createElement('canvas');
  paper.width = W;
  paper.height = H;
  const ctx = paper.getContext('2d')!;
  ctx.drawImage(img, 0, 0, W, H);

  const ink = 'rgba(24, 26, 64, 0.93)';
  const label = 'rgba(120, 30, 30, 0.85)';
  const maxW = RIGHT_X - MARGIN_X - 40;
  const baseline = (r: number) => RULES[Math.min(r, RULES.length - 1)] - 12;

  // Title, centred on the first rule, in dark red ink.
  ctx.save();
  ctx.font = `700 92px ${HAND_FONT}`;
  ctx.fillStyle = 'rgba(110, 12, 10, 0.9)';
  ctx.textAlign = 'center';
  ctx.translate((MARGIN_X + RIGHT_X) / 2, baseline(1) + 6);
  ctx.rotate(-0.012);
  ctx.fillText(t.paperTitle, 0, 0);
  ctx.restore();

  let row = 3;
  const writeField = (lab: string, value: string, size: number, maxLines: number) => {
    ctx.font = `600 ${Math.round(size * 0.6)}px ${HAND_FONT}`;
    ctx.fillStyle = label;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.fillText(`${lab}:`, MARGIN_X + 22, baseline(row));
    const labW = ctx.measureText(`${lab}: `).width + 10;
    let s = size;
    let lines: string[] = [];
    for (; s > 30; s -= 4) {
      ctx.font = `700 ${s}px ${HAND_FONT}`;
      lines = wrap(ctx, value, maxW - labW);
      if (lines.length <= maxLines) break;
    }
    if (lines.length > maxLines) {
      lines = lines.slice(0, maxLines);
      lines[maxLines - 1] = lines[maxLines - 1].replace(/.{0,2}$/, '…');
    }
    ctx.fillStyle = ink;
    lines.forEach((ln, i) => {
      // slight hand jitter
      ctx.save();
      ctx.translate(MARGIN_X + 22 + labW, baseline(row + i));
      ctx.rotate((((i * 37 + value.length) % 7) - 3) * 0.002);
      ctx.fillText(ln, 0, 0);
      ctx.restore();
    });
    row += Math.max(1, lines.length) + 1;
  };

  writeField(t.paperName, input.name, 84, 2);
  writeField(t.paperReason, input.reason, 66, 3);
  writeField(t.paperPunishment, input.punishment, 76, 2);

  // A blood-red "signature": the first letters of the name in the infernal script.
  const sig = toGlyphs(input.name).filter((g) => g >= 0).slice(0, 4);
  ctx.save();
  ctx.fillStyle = 'rgba(120, 8, 6, 0.85)';
  ctx.translate(RIGHT_X - 70 - sig.length * 46, RULES[11] - 30);
  ctx.rotate(-0.08);
  sig.forEach((g, i) => {
    ctx.save();
    ctx.translate(i * 46, 0);
    drawGlyph(ctx, g, 82);
    ctx.restore();
  });
  ctx.strokeStyle = 'rgba(120, 8, 6, 0.7)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-30, 50);
  ctx.bezierCurveTo(60, 70, sig.length * 30, 30, sig.length * 46 + 20, 56);
  ctx.stroke();
  ctx.restore();

  // Rune mask: the name + punishment in infernal letters, written big across the sheet.
  const runes = document.createElement('canvas');
  runes.width = 1024;
  runes.height = Math.round((1024 * H) / W);
  const r = runes.getContext('2d')!;
  r.fillStyle = '#fff';
  r.shadowColor = 'rgba(255,255,255,0.55)';
  r.shadowBlur = 5;
  const lineGlyphs = [toGlyphs(input.name), toGlyphs(input.punishment)];
  lineGlyphs.forEach((g, li) => {
    const seq = g.length ? g : [0];
    const hMax = runes.height * 0.26;
    const total = seq.reduce((acc, gi) => acc + (gi < 0 ? hMax * 0.4 : glyphWidth(gi, hMax) * 1.15), 0);
    const scale = Math.min(1, (runes.width * 0.86) / total);
    const h = hMax * scale;
    let x = (runes.width - total * scale) / 2;
    const y = runes.height * (li === 0 ? 0.36 : 0.7);
    for (const gi of seq) {
      if (gi < 0) {
        x += h * 0.4;
        continue;
      }
      const w = glyphWidth(gi, h) * 1.15;
      r.save();
      r.translate(x + w / 2, y);
      drawGlyph(r, gi, h);
      r.restore();
      x += w;
    }
  });

  return { paper, runes, aspect: W / H };
}
