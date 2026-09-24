// Draws the finished certificate on a canvas (same canvas is shown on screen and exported as PNG).
import certificateUrl from '../../assets/certificate.webp';
import sealMaskUrl from '../../assets/seal-mask.png';
import { loadImage } from '../../utils/image';
import { DATE_LOCALE, STRINGS, type Lang } from '../i18n/strings';
import type { RitualParams } from '../ritual/params';
import { drawFlatCircle } from '../ritual/art/circleArt';
import { makeRng } from '../../utils/seed/seed';
import { ensureFonts, FONT } from '../../utils/fonts';

// Geometry measured on certificate.webp (979 x 1360, the cut-out of Sertificate.png).
const BASE_W = 979;
const BASE_H = 1360;
const SEAL = { x: 492, y: 1111, r: 70 };
const CONTENT = { left: 158, right: 821, top: 150, bottom: 985 };

export interface CertificateData {
  params: RitualParams;
  lang: Lang;
  createdAt: number;
}

const INK = '#2e1a12';
const INK_SOFT = 'rgba(58, 34, 22, 0.86)';
const CRIMSON = '#7d0c0c';
const LABEL = '#8b1a12';

function fitFont(ctx: CanvasRenderingContext2D, text: string, maxW: number, size: number, min: number, font: (s: number) => string) {
  let s = size;
  ctx.font = font(s);
  while (s > min && ctx.measureText(text).width > maxW) {
    s -= 1;
    ctx.font = font(s);
  }
  return s;
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(t).width <= maxW || !cur) cur = t;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
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

/** Wraps text into at most `maxLines`, shrinking the font until it fits. */
function fitBlock(
  ctx: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number, size: number, min: number,
  font: (s: number) => string,
) {
  for (let s = size; s >= min; s -= 1) {
    ctx.font = font(s);
    const lines = wrapLines(ctx, text, maxW);
    if (lines.length <= maxLines) return { lines, size: s };
  }
  ctx.font = font(min);
  const lines = wrapLines(ctx, text, maxW);
  const cut = lines.slice(0, maxLines);
  if (lines.length > maxLines) cut[maxLines - 1] = cut[maxLines - 1].replace(/.{0,1}$/, '…');
  return { lines: cut, size: min };
}

function divider(ctx: CanvasRenderingContext2D, cx: number, y: number, half: number, color: string) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.4;
  const g = ctx.createLinearGradient(cx - half, 0, cx + half, 0);
  g.addColorStop(0, 'rgba(125,12,12,0)');
  g.addColorStop(0.5, color);
  g.addColorStop(1, 'rgba(125,12,12,0)');
  ctx.strokeStyle = g;
  ctx.beginPath();
  ctx.moveTo(cx - half, y);
  ctx.lineTo(cx - 14, y);
  ctx.moveTo(cx + 14, y);
  ctx.lineTo(cx + half, y);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx, y - 7);
  ctx.lineTo(cx + 7, y);
  ctx.lineTo(cx, y + 7);
  ctx.lineTo(cx - 7, y);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** Ink that sits in the paper: a hair of darker bleed + a faint light edge below. */
function inkText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string) {
  ctx.save();
  ctx.fillStyle = 'rgba(255, 244, 220, 0.35)';
  ctx.fillText(text, x, y + 1.2);
  ctx.fillStyle = color;
  ctx.shadowColor = 'rgba(60, 10, 5, 0.25)';
  ctx.shadowBlur = 1.5;
  ctx.fillText(text, x, y);
  ctx.restore();
}

/** Letter-spaced small caps label. */
function label(ctx: CanvasRenderingContext2D, text: string, cx: number, y: number, size: number, font: string) {
  ctx.save();
  ctx.font = `600 ${size}px ${font}`;
  ctx.fillStyle = LABEL;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const spaced = text.toUpperCase().split('').join(' ');
  ctx.fillText(spaced, cx, y);
  ctx.restore();
}

/** Blurred copy of a canvas via the shadow trick (works in every browser). */
function blurred(src: HTMLCanvasElement, blur: number, color: string, dx = 0, dy = 0) {
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  const g = c.getContext('2d')!;
  const off = src.width * 4;
  g.shadowColor = color;
  g.shadowBlur = blur;
  g.shadowOffsetX = off + dx;
  g.shadowOffsetY = dy;
  g.drawImage(src, -off, 0);
  return c;
}

/**
 * Presses Pechat.png into the wax: grooves are darker wax, their upper-left walls fall into
 * shadow and the lower-right walls catch the light, like a real impression.
 */
async function pressSeal(ctx: CanvasRenderingContext2D, S: number, seed: number) {
  const img = await loadImage(sealMaskUrl);
  const rng = makeRng(seed).fork(31);
  const R = SEAL.r * S;
  const size = Math.ceil(R * 2 + 16 * S);
  const mk = () => {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    return c;
  };
  // 1. the stamp shape
  const mask = mk();
  const m = mask.getContext('2d')!;
  m.translate(size / 2, size / 2);
  m.rotate(rng.range(-0.25, 0.25));
  const d = R * 1.86;
  m.drawImage(img, -d / 2, -d / 2, d, d);
  // keep only the flat face of the wax, soft at its rim
  m.setTransform(1, 0, 0, 1, 0, 0);
  m.globalCompositeOperation = 'destination-in';
  const face = m.createRadialGradient(size / 2, size / 2, R * 0.8, size / 2, size / 2, R * 1.02);
  face.addColorStop(0, 'rgba(0,0,0,1)');
  face.addColorStop(1, 'rgba(0,0,0,0)');
  m.fillStyle = face;
  m.fillRect(0, 0, size, size);

  // 2. inverse (everything that is NOT groove)
  const inv = mk();
  const iv = inv.getContext('2d')!;
  iv.fillStyle = '#000';
  iv.fillRect(0, 0, size, size);
  iv.globalCompositeOperation = 'destination-out';
  iv.drawImage(mask, 0, 0);

  const px = SEAL.x * S - size / 2;
  const py = SEAL.y * S - size / 2;

  // 3. groove floor: deeper, darker wax
  const floor = mk();
  const f = floor.getContext('2d')!;
  f.drawImage(mask, 0, 0);
  f.globalCompositeOperation = 'source-in';
  f.fillStyle = 'rgba(70, 0, 6, 0.62)';
  f.fillRect(0, 0, size, size);
  ctx.drawImage(floor, px, py);

  // 4. shadow on the upper-left walls
  const sh = blurred(inv, 2.2 * S, 'rgba(15, 0, 0, 0.95)', 1.6 * S, 1.6 * S);
  const shc = sh.getContext('2d')!;
  shc.globalCompositeOperation = 'destination-in';
  shc.drawImage(mask, 0, 0);
  ctx.save();
  ctx.globalAlpha = 0.85;
  ctx.drawImage(sh, px, py);
  ctx.restore();

  // 5. light catching the lower-right walls
  const hi = blurred(inv, 1.2 * S, 'rgba(255, 150, 140, 1)', -1.1 * S, -1.1 * S);
  const hic = hi.getContext('2d')!;
  hic.globalCompositeOperation = 'destination-in';
  hic.drawImage(mask, 0, 0);
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.globalCompositeOperation = 'screen';
  ctx.drawImage(hi, px, py);
  ctx.restore();

  // 6. a whisper of gloss on the raised wax just outside the grooves (bottom-right rims)
  const rim = blurred(mask, 1.5 * S, 'rgba(255, 190, 180, 1)', 1.2 * S, 1.2 * S);
  const rc = rim.getContext('2d')!;
  rc.globalCompositeOperation = 'destination-out';
  rc.drawImage(mask, 0, 0);
  ctx.save();
  ctx.globalAlpha = 0.22;
  ctx.globalCompositeOperation = 'screen';
  ctx.drawImage(rim, px, py);
  ctx.restore();
}

export async function renderCertificate(data: CertificateData, scale = 1.5): Promise<HTMLCanvasElement> {
  const { params: P, lang } = data;
  const t = STRINGS[lang];
  await ensureFonts(lang, [P.input.name, P.input.reason, P.input.punishment].join(' '));
  const bg = await loadImage(certificateUrl);
  const S = scale;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(BASE_W * S);
  canvas.height = Math.round(BASE_H * S);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bg, 0, 0, canvas.width, canvas.height);
  ctx.scale(S, S);

  // Faint echo of this ritual's magic circle behind the text.
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.translate((CONTENT.left + CONTENT.right) / 2, 575);
  const cr = 330;
  ctx.scale(cr, cr);
  ctx.strokeStyle = 'rgba(120, 40, 20, 0.16)';
  ctx.fillStyle = 'rgba(120, 40, 20, 0.16)';
  ctx.lineCap = 'round';
  drawFlatCircle(ctx, P, 0.004);
  ctx.restore();

  const cx = (CONTENT.left + CONTENT.right) / 2;
  const maxW = CONTENT.right - CONTENT.left;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  // Title
  const titleFont = FONT.title[lang];
  const ts = fitFont(ctx, t.certificateTitle, maxW - 20, 52, 26, (s) => `700 ${s}px ${titleFont}`);
  ctx.font = `700 ${ts}px ${titleFont}`;
  inkText(ctx, t.certificateTitle, cx, 262, '#5c0a0a');
  divider(ctx, cx, 292, 230, CRIMSON);

  // Intro line
  ctx.font = `italic 500 26px ${FONT.body}`;
  const introSize = fitFont(ctx, t.certificateIntro, maxW, 26, 16, (s) => `italic 500 ${s}px ${FONT.body}`);
  ctx.font = `italic 500 ${introSize}px ${FONT.body}`;
  inkText(ctx, t.certificateIntro, cx, 340, INK_SOFT);

  let y = 392;
  // Target
  label(ctx, t.targetLabel, cx, y, 17, FONT.label);
  const name = fitBlock(ctx, P.input.name, maxW, 2, 56, 26, (s) => `700 ${s}px ${FONT.body}`);
  ctx.font = `700 ${name.size}px ${FONT.body}`;
  y += name.size * 0.95 + 6;
  for (const ln of name.lines) {
    inkText(ctx, ln, cx, y, INK);
    y += name.size * 1.02;
  }
  y += 18;

  // Reason
  label(ctx, t.reasonFieldLabel, cx, y, 17, FONT.label);
  const reason = fitBlock(ctx, P.input.reason, maxW - 30, 4, 30, 17, (s) => `italic 500 ${s}px ${FONT.body}`);
  ctx.font = `italic 500 ${reason.size}px ${FONT.body}`;
  y += reason.size * 1.05 + 4;
  for (const ln of reason.lines) {
    inkText(ctx, ln, cx, y, INK_SOFT);
    y += reason.size * 1.18;
  }
  y += 22;

  // Punishment — the loudest thing on the page
  const pBottom = 872;
  label(ctx, t.punishmentFieldLabel, cx, y, 18, FONT.label);
  const room = Math.max(60, pBottom - y - 10);
  let pun = fitBlock(ctx, P.input.punishment, maxW, 3, 70, 22, (s) => `700 ${s}px ${FONT.body}`);
  while (pun.size > 22 && pun.lines.length * pun.size * 1.05 > room) {
    pun = fitBlock(ctx, P.input.punishment, maxW, 3, pun.size - 2, 22, (s) => `700 ${s}px ${FONT.body}`);
  }
  ctx.font = `700 ${pun.size}px ${FONT.body}`;
  y += pun.size * 0.98 + 6;
  for (const ln of pun.lines) {
    ctx.save();
    // soaked-in blood red with a dark core
    ctx.fillStyle = 'rgba(255, 235, 210, 0.4)';
    ctx.fillText(ln, cx, y + 1.5);
    ctx.shadowColor = 'rgba(140, 0, 0, 0.45)';
    ctx.shadowBlur = 6;
    const g = ctx.createLinearGradient(0, y - pun.size, 0, y);
    g.addColorStop(0, '#9e1010');
    g.addColorStop(1, '#5a0404');
    ctx.fillStyle = g;
    ctx.fillText(ln, cx, y);
    ctx.restore();
    y += pun.size * 1.05;
  }

  // Date + archive number
  const date = new Date(data.createdAt);
  let dateStr: string;
  try {
    dateStr = new Intl.DateTimeFormat(DATE_LOCALE[lang], { dateStyle: 'long', timeStyle: 'short' }).format(date);
  } catch {
    dateStr = date.toLocaleString();
  }
  const metaY = 905;
  ctx.font = `600 19px ${FONT.body}`;
  ctx.textAlign = 'left';
  inkText(ctx, `${t.dateLabel}: ${dateStr}`, CONTENT.left + 6, metaY, INK_SOFT);
  ctx.textAlign = 'right';
  inkText(ctx, `${t.archiveIdLabel} ${P.archiveId}`, CONTENT.right - 6, metaY, INK_SOFT);
  ctx.textAlign = 'center';
  divider(ctx, cx, 928, 300, 'rgba(125,12,12,0.7)');
  const al = fitFont(ctx, t.archiveLine, maxW, 21, 14, (s) => `italic 600 ${s}px ${FONT.body}`);
  ctx.font = `italic 600 ${al}px ${FONT.body}`;
  inkText(ctx, t.archiveLine, cx, 962, '#6b1410');

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  await pressSeal(ctx, S, P.seed);
  return canvas;
}

export function canvasToBlob(canvas: HTMLCanvasElement, type = 'image/png', quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), type, quality),
  );
}

export async function makeThumbnail(canvas: HTMLCanvasElement, width = 260): Promise<Blob> {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = Math.round((canvas.height / canvas.width) * width);
  const g = c.getContext('2d')!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(canvas, 0, 0, c.width, c.height);
  try {
    return await canvasToBlob(c, 'image/webp', 0.82);
  } catch {
    return canvasToBlob(c, 'image/jpeg', 0.85);
  }
}
