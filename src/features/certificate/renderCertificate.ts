// Draws the finished certificate on a canvas (same canvas is shown on screen and exported as PNG).
import certificateUrl from '../../assets/certificate.webp';
import sealMaskUrl from '../../assets/seal-mask.png';
import { loadImage } from '../../utils/image';
import { DATE_LOCALE, STRINGS, type Lang } from '../i18n/strings';
import type { RitualParams } from '../ritual/params';
import { drawFlatCircle } from '../ritual/art/circleArt';
import { hashString, makeRng } from '../../utils/seed/seed';
import { generateCircle } from '../ritual/art/generator';
import { drawGlyph } from '../../utils/glyphs/glyphLibrary';
import { dateToGlyphs } from '../../utils/glyphs/translit';
import { decode } from '../../utils/photo';
import { cssColor } from '../ritual/art/palette';
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
  /** Optional picture of the target: the sheet only makes room for it when there is one. */
  photo?: Blob | null;
}

/** Where the portrait goes (left of the target's name) when a picture was added. */
const PORTRAIT = { x: 172, y: 376, w: 176, h: 222 };
/** The small birth seal (left of the wax seal) and the infernal signature (right of it). */
const BIRTH_SEAL = { x: 292, y: 1088, r: 66 };
const SIGNATURE = { x: 722, y: 1090, w: 176 };

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

/**
 * A soft halo behind text, made of faint copies around it. (Canvas text shadows are not used:
 * Safari on iPhone draws them shifted for centred text, which doubled the letters.)
 */
function halo(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, r: number) {
  ctx.save();
  ctx.fillStyle = color;
  for (const k of [1, 0.5]) {
    const n = k === 1 ? 12 : 6;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      ctx.fillText(text, x + Math.cos(a) * r * k, y + Math.sin(a) * r * k);
    }
  }
  ctx.restore();
}

/** Ink that sits in the paper: a hair of darker bleed + a faint light edge below. */
function inkText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string) {
  ctx.save();
  ctx.fillStyle = 'rgba(255, 244, 220, 0.35)';
  ctx.fillText(text, x, y + 1.2);
  halo(ctx, text, x, y, 'rgba(60, 10, 5, 0.035)', 1.2);
  ctx.fillStyle = color;
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
async function pressSeal(ctx: CanvasRenderingContext2D, S: number, seed: number): Promise<{ mask: HTMLCanvasElement; px: number; py: number; size: number }> {
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
  return { mask, px: Math.round(px), py: Math.round(py), size };
}

function cloneCanvas(src: HTMLCanvasElement) {
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  c.getContext('2d')!.drawImage(src, 0, 0);
  return c;
}

/**
 * An enlarged fragment of the curse's circle entering the sheet from one side, at a random
 * place for every certificate. Stored as a grey mask (white = line); the colour and the
 * shimmer are added by the 3D view (and statically for the PNG).
 */
function shimmerMask(P: RitualParams, createdAt: number, w: number, h: number): HTMLCanvasElement {
  const rng = makeRng(hashString(String(createdAt), P.seed));
  const tmp = document.createElement('canvas');
  tmp.width = w;
  tmp.height = h;
  const t = tmp.getContext('2d')!;
  // centre outside the page on a random side, radius larger than the sheet
  const side = rng.int(0, 3);
  const along = rng.range(0.1, 0.9);
  const out = rng.range(0.05, 0.3);
  const cx = side === 0 ? -out * w : side === 1 ? (1 + out) * w : along * w;
  const cy = side === 2 ? -out * h : side === 3 ? (1 + out) * h : along * h;
  const R = rng.range(0.75, 1.15) * Math.max(w, h);
  t.translate(cx, cy);
  t.rotate(rng.range(0, Math.PI * 2));
  t.scale(R, R);
  t.strokeStyle = t.fillStyle = '#fff';
  t.lineCap = 'round';
  drawFlatCircle(t, P, 4.2 / R);
  // soft halo around the lines so the colour can flow over the paper
  t.setTransform(1, 0, 0, 1, 0, 0);
  const small = document.createElement('canvas');
  small.width = Math.max(1, Math.round(w / 6));
  small.height = Math.max(1, Math.round(h / 6));
  const sc = small.getContext('2d')!;
  sc.imageSmoothingQuality = 'high';
  sc.drawImage(tmp, 0, 0, small.width, small.height);
  t.globalAlpha = 0.9;
  t.imageSmoothingQuality = 'high';
  t.drawImage(small, 0, 0, w, h);
  t.globalAlpha = 1;
  // keep the middle of the sheet (where the text is) calm
  t.setTransform(1, 0, 0, 1, 0, 0);
  t.globalCompositeOperation = 'destination-in';
  const g = t.createRadialGradient(w / 2, h * 0.45, Math.min(w, h) * 0.18, w / 2, h * 0.45, Math.max(w, h) * 0.62);
  g.addColorStop(0, 'rgba(0,0,0,0.25)');
  g.addColorStop(1, 'rgba(0,0,0,1)');
  t.fillStyle = g;
  t.fillRect(0, 0, w, h);
  const mask = document.createElement('canvas');
  mask.width = w;
  mask.height = h;
  const m = mask.getContext('2d')!;
  m.fillStyle = '#000';
  m.fillRect(0, 0, w, h);
  m.drawImage(tmp, 0, 0);
  return mask;
}

/** Points on the stamp lines (uv inside the seal crop, y down), sorted top to bottom. */
function engravePoints(mask: HTMLCanvasElement): [number, number][] {
  const w = mask.width;
  const h = mask.height;
  const data = mask.getContext('2d')!.getImageData(0, 0, w, h).data;
  const pts: [number, number][] = [];
  const step = Math.max(2, Math.round(w / 90));
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) if (data[(y * w + x) * 4 + 3] > 140) pts.push([x / w, y / h]);
  }
  return pts.sort((a, b) => a[1] - b[1]);
}

export interface CertificateLayers {
  /** Finished certificate (what is downloaded / archived). */
  final: HTMLCanvasElement;
  /** Sheet with text and watermark, seal not yet engraved. */
  base: HTMLCanvasElement;
  /** Crop of the engraved seal region. */
  sealed: HTMLCanvasElement;
  /** Crop of the stamp lines (alpha). */
  sealMask: HTMLCanvasElement;
  /** Grey mask of the enlarged circle fragment. */
  shimmer: HTMLCanvasElement;
  /** Seal crop in uv space of the sheet (x, y, w, h; y up). */
  sealRect: [number, number, number, number];
  /** Points of the stamp lines inside the crop (uv, y down), top to bottom. */
  engrave: [number, number][];
}

export async function renderCertificate(data: CertificateData, scale = 1.5): Promise<HTMLCanvasElement> {
  return (await renderCertificateLayers(data, scale)).final;
}

export async function renderCertificateLayers(data: CertificateData, scale = 1.5): Promise<CertificateLayers> {
  const { params: P, lang } = data;
  const t = STRINGS[lang];
  await ensureFonts(lang, [P.input.name, P.input.reason, P.input.punishment, t.bornLabel, '0123456789'].join(' '));
  const bg = await loadImage(certificateUrl);
  const S = scale;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(BASE_W * S);
  canvas.height = Math.round(BASE_H * S);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bg, 0, 0, canvas.width, canvas.height);
  ctx.scale(S, S);

  // Faint echo of this ritual's magic circle behind the text. Drawn on its own layer first:
  // the circle art cuts holes (destination-out) that must not punch through the paper.
  const cr = 330;
  const wm = document.createElement('canvas');
  wm.width = wm.height = Math.ceil(cr * 2.3 * S);
  const w = wm.getContext('2d')!;
  w.translate(wm.width / 2, wm.height / 2);
  w.scale(cr * S, cr * S);
  w.strokeStyle = w.fillStyle = 'rgb(120, 40, 20)';
  w.lineCap = 'round';
  drawFlatCircle(w, P, 0.004);
  ctx.save();
  ctx.globalAlpha = 0.16;
  ctx.globalCompositeOperation = 'multiply';
  ctx.drawImage(wm, (CONTENT.left + CONTENT.right) / 2 - wm.width / S / 2, 575 - wm.height / S / 2, wm.width / S, wm.height / S);
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
  // With a picture, the target, the birthday and the reason stand in a column right of it.
  const photo = data.photo ? await decode(data.photo).catch(() => null) : null;
  const colL = photo ? PORTRAIT.x + PORTRAIT.w + 26 : CONTENT.left;
  const colX = (colL + CONTENT.right) / 2;
  const colW = CONTENT.right - colL;
  if (photo) {
    drawPortrait(ctx, photo.source, photo.width, photo.height, S);
    photo.close();
    y = PORTRAIT.y + 20;
  }

  // Target
  label(ctx, t.targetLabel, colX, y, 17, FONT.label);
  const name = fitBlock(ctx, P.input.name, colW, 2, photo ? 50 : 56, 26, (s) => `700 ${s}px ${FONT.body}`);
  ctx.font = `700 ${name.size}px ${FONT.body}`;
  y += name.size * 0.95 + 6;
  for (const ln of name.lines) {
    inkText(ctx, ln, colX, y, INK);
    y += name.size * 1.02;
  }
  // Date of birth, written plainly under the name
  if (P.input.birthday) {
    ctx.font = `italic 500 22px ${FONT.body}`;
    inkText(ctx, `${t.bornLabel}: ${formatBirth(P.input.birthday, lang)}`, colX, y + 4, INK_SOFT);
    y += 30;
  }
  y += 18;

  // Reason
  label(ctx, t.reasonFieldLabel, colX, y, 17, FONT.label);
  const reason = fitBlock(ctx, P.input.reason, colW - 30, 4, 30, 17, (s) => `italic 500 ${s}px ${FONT.body}`);
  ctx.font = `italic 500 ${reason.size}px ${FONT.body}`;
  y += reason.size * 1.05 + 4;
  for (const ln of reason.lines) {
    inkText(ctx, ln, colX, y, INK_SOFT);
    y += reason.size * 1.18;
  }
  y += 22;
  if (photo) y = Math.max(y, PORTRAIT.y + PORTRAIT.h + 34);

  // Punishment — the loudest thing on the page
  const pBottom = 858;
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
    halo(ctx, ln, cx, y, 'rgba(140, 0, 0, 0.045)', 3.5);
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
  const dateStr = formatDate(date, lang);
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

  // The birthday adds its own small seal and a signature in the infernal script
  if (P.input.birthday) {
    birthSeal(ctx, P.input.birthday, S);
    infernalSignature(ctx, P.input.birthday);
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const base = canvas;
  const sealedFull = cloneCanvas(base);
  const seal = await pressSeal(sealedFull.getContext('2d')!, S, P.seed);
  const sealed = document.createElement('canvas');
  sealed.width = sealed.height = seal.size;
  sealed.getContext('2d')!.drawImage(sealedFull, seal.px, seal.py, seal.size, seal.size, 0, 0, seal.size, seal.size);

  const shimmer = shimmerMask(P, data.createdAt, Math.round(base.width / 2), Math.round(base.height / 2));

  // Static version of the shimmering fragment for the PNG: the curse's inks soaked into the paper.
  const final = sealedFull;
  {
    const f = final.getContext('2d')!;
    const tint = document.createElement('canvas');
    tint.width = final.width;
    tint.height = final.height;
    const tc = tint.getContext('2d')!;
    const pal = P.palette;
    const grad = tc.createLinearGradient(0, 0, final.width, final.height);
    grad.addColorStop(0, cssColor(pal.a));
    grad.addColorStop(0.5, cssColor(pal.b));
    grad.addColorStop(1, cssColor(pal.c));
    tc.fillStyle = grad;
    tc.fillRect(0, 0, final.width, final.height);
    tc.globalCompositeOperation = 'destination-in';
    // use the grey mask as alpha
    const alpha = document.createElement('canvas');
    alpha.width = shimmer.width;
    alpha.height = shimmer.height;
    const ac = alpha.getContext('2d')!;
    const id = shimmer.getContext('2d')!.getImageData(0, 0, shimmer.width, shimmer.height);
    for (let i = 0; i < id.data.length; i += 4) {
      id.data[i + 3] = id.data[i];
      id.data[i] = id.data[i + 1] = id.data[i + 2] = 255;
    }
    ac.putImageData(id, 0, 0);
    tc.drawImage(alpha, 0, 0, final.width, final.height);
    // only on the paper itself
    tc.drawImage(base, 0, 0);
    f.save();
    f.globalCompositeOperation = 'multiply';
    f.globalAlpha = 0.46;
    f.drawImage(tint, 0, 0);
    f.globalCompositeOperation = 'soft-light';
    f.globalAlpha = 0.5;
    f.drawImage(tint, 0, 0);
    f.restore();
    // the seal sits on top of the tint
    f.drawImage(sealed, seal.px, seal.py);
  }

  const W = base.width;
  const H = base.height;
  return {
    final,
    base,
    sealed,
    sealMask: seal.mask,
    shimmer,
    sealRect: [seal.px / W, 1 - (seal.py + seal.size) / H, seal.size / W, seal.size / H],
    engrave: engravePoints(seal.mask),
  };
}

/** The picture in an oval cameo: toned like an old print, soaked into the paper, framed. */
function drawPortrait(ctx: CanvasRenderingContext2D, src: CanvasImageSource, iw: number, ih: number, S: number) {
  const { x, y, w, h } = PORTRAIT;
  const c = document.createElement('canvas');
  c.width = Math.round(w * S);
  c.height = Math.round(h * S);
  const g = c.getContext('2d')!;
  // cover-fit, a little above the centre (faces)
  const k = Math.max(c.width / iw, c.height / ih);
  const dw = iw * k;
  const dh = ih * k;
  g.drawImage(src, (c.width - dw) / 2, (c.height - dh) * 0.35, dw, dh);
  // sepia tone with a touch of contrast (pixel by pixel: canvas filters are missing in Safari)
  const id = g.getImageData(0, 0, c.width, c.height);
  const d = id.data;
  for (let i = 0; i < d.length; i += 4) {
    let v = (0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2]) / 255;
    v = Math.min(1, Math.max(0, (v - 0.5) * 1.15 + 0.52));
    d[i] = 255 * Math.min(1, v * 1.02 + 0.06);
    d[i + 1] = 255 * Math.min(1, v * 0.86 + 0.04);
    d[i + 2] = 255 * Math.min(1, v * 0.66 + 0.02);
  }
  g.putImageData(id, 0, 0);
  // burnt, darkening edge
  const vg = g.createRadialGradient(c.width / 2, c.height / 2, Math.min(c.width, c.height) * 0.3, c.width / 2, c.height / 2, Math.max(c.width, c.height) * 0.62);
  vg.addColorStop(0, 'rgba(90, 40, 20, 0)');
  vg.addColorStop(1, 'rgba(70, 25, 10, 0.55)');
  g.fillStyle = vg;
  g.fillRect(0, 0, c.width, c.height);
  // oval cut
  g.globalCompositeOperation = 'destination-in';
  g.fillStyle = '#000';
  g.beginPath();
  g.ellipse(c.width / 2, c.height / 2, c.width / 2 - 1, c.height / 2 - 1, 0, 0, Math.PI * 2);
  g.fill();

  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.globalAlpha = 0.92;
  ctx.drawImage(c, x, y, w, h);
  ctx.restore();
  // frame: two ink ovals and small diamonds at the ends
  ctx.save();
  ctx.strokeStyle = '#5c0a0a';
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(92, 10, 10, 0.55)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(x + w / 2, y + h / 2, w / 2 + 7, h / 2 + 7, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = CRIMSON;
  for (const yy of [y - 7, y + h + 7]) {
    ctx.beginPath();
    ctx.moveTo(x + w / 2, yy - 7);
    ctx.lineTo(x + w / 2 + 6, yy);
    ctx.lineTo(x + w / 2, yy + 7);
    ctx.lineTo(x + w / 2 - 6, yy);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/** A small, translucent magic circle grown from the date of birth (its own seed and colour). */
function birthSeal(ctx: CanvasRenderingContext2D, birthday: string, S: number) {
  const glyphs = dateToGlyphs(birthday);
  const design = generateCircle({ seed: hashString(`birth␟${birthday}`), name: glyphs, reason: glyphs, punishment: glyphs });
  const { x, y, r } = BIRTH_SEAL;
  const unit = r / 1.45; // leaves room for satellites and blades
  const c = document.createElement('canvas');
  c.width = c.height = Math.ceil(r * 2.1 * S);
  const g = c.getContext('2d')!;
  g.translate(c.width / 2, c.height / 2);
  g.scale(unit * S, unit * S);
  const p = design.palette;
  const ink = `rgb(${Math.round(p.a[0] * 120)}, ${Math.round(p.a[1] * 120)}, ${Math.round(p.a[2] * 120)})`;
  g.strokeStyle = g.fillStyle = ink;
  g.lineCap = 'round';
  // the fine detail would only turn to mush this small: frame, figure, core and satellites
  drawFlatCircle(g, { design }, 0.011, true, (l) => /^(frame$|frameText|figure|core|sat|vtx|med|weave|band0)/.test(l.id));
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.globalAlpha = 0.7;
  ctx.drawImage(c, x - c.width / S / 2, y - c.height / S / 2, c.width / S, c.height / S);
  ctx.restore();
}

/** The birthday signed in infernal letters, with a flourish (like the signature on the note). */
function infernalSignature(ctx: CanvasRenderingContext2D, birthday: string) {
  const seq = dateToGlyphs(birthday);
  const letters = seq.filter((gl) => gl >= 0).length;
  const gaps = seq.length - letters;
  const adv = Math.min(26, SIGNATURE.w / (letters + gaps * 0.6));
  const width = adv * (letters + gaps * 0.6);
  ctx.save();
  ctx.translate(SIGNATURE.x - width / 2, SIGNATURE.y);
  ctx.rotate(-0.07);
  ctx.fillStyle = 'rgba(120, 8, 6, 0.85)';
  let x = 0;
  for (const gl of seq) {
    if (gl < 0) {
      x += adv * 0.6;
      continue;
    }
    ctx.save();
    ctx.translate(x + adv / 2, 0);
    drawGlyph(ctx, gl, adv * 2);
    ctx.restore();
    x += adv;
  }
  ctx.strokeStyle = 'rgba(120, 8, 6, 0.7)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-14, adv * 1.15);
  ctx.bezierCurveTo(width * 0.3, adv * 1.6, width * 0.7, adv * 0.6, width + 12, adv * 1.25);
  ctx.stroke();
  ctx.restore();
}

/** A date of birth without time; Armenian is spelled out by hand (see formatDate). */
function formatBirth(iso: string, lang: Lang): string {
  const [yy, mm, dd] = iso.split('-').map(Number);
  if (!yy || !mm || !dd) return iso;
  const date = new Date(yy, mm - 1, dd);
  if (lang === 'hy') return `${yy} թ. ${HY_MONTHS[mm - 1]} ${dd}`;
  try {
    return new Intl.DateTimeFormat(DATE_LOCALE[lang], { dateStyle: 'long' }).format(date);
  } catch {
    return date.toLocaleDateString();
  }
}

const HY_MONTHS = [
  'հունվարի', 'փետրվարի', 'մարտի', 'ապրիլի', 'մայիսի', 'հունիսի',
  'հուլիսի', 'օգոստոսի', 'սեպտեմբերի', 'հոկտեմբերի', 'նոյեմբերի', 'դեկտեմբերի',
];

/** Long date + time; Armenian is spelled out by hand because many browsers lack hy-AM data. */
export function formatDate(date: Date, lang: Lang): string {
  const hm = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  if (lang === 'hy') return `${date.getFullYear()} թ. ${HY_MONTHS[date.getMonth()]} ${date.getDate()}, ${hm}`;
  try {
    return new Intl.DateTimeFormat(DATE_LOCALE[lang], { dateStyle: 'long', timeStyle: 'short' }).format(date);
  } catch {
    return date.toLocaleString();
  }
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
