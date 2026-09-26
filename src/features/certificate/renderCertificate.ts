// Draws the finished certificate on a canvas (same canvas is shown on screen and exported as PNG).
import certificateUrl from '../../assets/certificate.webp';
import sealMaskUrl from '../../assets/seal-mask.png';
import { loadImage } from '../../utils/image';
import { DATE_LOCALE, STRINGS, type Lang } from '../i18n/strings';
import type { RitualParams } from '../ritual/params';
import { drawFlatCircle } from '../ritual/art/circleArt';
import { hashString, makeRng } from '../../utils/seed/seed';
import { drawGlyph } from '../../utils/glyphs/glyphLibrary';
import { drawSigil, makeSigil } from '../ritual/art/sigils';
import { drawSignature, signatureGlyphs, signatureWidth } from '../ritual/art/signature';
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

/** The portrait (left of the target's name) when a picture was added; its top is computed. */
const PORTRAIT = { x: 172, w: 176, h: 222 };
/** Right of the wax seal: the signature, over the small birth stamp. */
const SIGNATURE = { x: 704, y: 1076 };
const BIRTH_STAMP = { x: 728, y: 1098, r: 58 };
/** Left of the wax seal: the date of birth and its curse. */
const BIRTH_NOTE = { x: 270, y: 1040, w: 184 };

const INK = '#2e1a12';
const INK_SOFT = 'rgba(58, 34, 22, 0.86)';
const CRIMSON = '#7d0c0c';
const LABEL = '#8b1a12';

/**
 * Small print (meta row, archive line, birthday note). Armenian comes from Noto Serif Armenian
 * first — even (lining) digits, a lighter weight and no slant — Cormorant's old-style digits
 * and the heavy fallback weight made those lines hard to read.
 */
function smallFont(lang: Lang, weight: number, size: number, italic = false) {
  // (Noto's Armenian letters stand much taller than Cormorant's: scaled down to about the
  // height of the "№" next to them)
  if (lang === 'hy') return `${Math.max(400, weight - 200)} ${Math.round(size * 0.8)}px "Noto Serif Armenian", "Cormorant Garamond", serif`;
  return `${italic ? 'italic ' : ''}${weight} ${size}px ${FONT.body}`;
}

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
  await ensureFonts(lang, [P.input.name, P.input.reason, P.input.punishment, t.bornLabel, t.birthCurse, '0123456789'].join(' '));
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
  // With a picture, the target and the reason stand in a column right of it, and the two are
  // centred together between the intro line and the punishment.
  const photo = data.photo ? await decode(data.photo).catch(() => null) : null;
  const colL = photo ? PORTRAIT.x + PORTRAIT.w + 26 : CONTENT.left;
  const colX = (colL + CONTENT.right) / 2;
  const colW = CONTENT.right - colL;
  const nameFit = fitBlock(ctx, P.input.name, colW, 2, photo ? 50 : 56, 26, (s) => `700 ${s}px ${FONT.body}`);
  const reasonFit = fitBlock(ctx, P.input.reason, colW - 30, 4, 30, 17, (s) => `italic 500 ${s}px ${FONT.body}`);
  /** Target + reason, from the first label's baseline; `draw = false` only measures. */
  const column = (y0: number, draw: boolean) => {
    let yy = y0;
    if (draw) label(ctx, t.targetLabel, colX, yy, 17, FONT.label);
    ctx.font = `700 ${nameFit.size}px ${FONT.body}`;
    yy += nameFit.size * 0.95 + 6;
    for (const ln of nameFit.lines) {
      if (draw) inkText(ctx, ln, colX, yy, INK);
      yy += nameFit.size * 1.02;
    }
    yy += 18;
    if (draw) label(ctx, t.reasonFieldLabel, colX, yy, 17, FONT.label);
    ctx.font = `italic 500 ${reasonFit.size}px ${FONT.body}`;
    yy += reasonFit.size * 1.05 + 4;
    reasonFit.lines.forEach((ln, i) => {
      if (draw) inkText(ctx, ln, colX, yy, INK_SOFT);
      if (i < reasonFit.lines.length - 1) yy += reasonFit.size * 1.18;
    });
    return yy; // baseline of the last line
  };
  if (photo) {
    const top = 362; // just under the intro line
    const colH = column(0, false) + 14 + 8; // + label cap height + descenders
    const blockH = Math.max(colH, PORTRAIT.h + 18);
    drawPortrait(ctx, photo.source, photo.width, photo.height, S, top + (blockH - PORTRAIT.h) / 2);
    photo.close();
    column(top + (blockH - colH) / 2 + 14, true);
    y = top + blockH + 34;
  } else {
    y = column(y, true) + reasonFit.size * 1.18 + 22;
  }

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
  const metaL = `${t.dateLabel}: ${dateStr}`;
  const metaR = `${t.archiveIdLabel} ${P.archiveId}`;
  // both ends of the row must never meet (long Armenian dates): shrink the row until they fit
  let metaSize = 19;
  ctx.font = smallFont(lang, 600, metaSize);
  while (metaSize > 13 && ctx.measureText(metaL).width + ctx.measureText(metaR).width > maxW - 36) {
    metaSize -= 1;
    ctx.font = smallFont(lang, 600, metaSize);
  }
  ctx.textAlign = 'left';
  inkText(ctx, metaL, CONTENT.left + 6, metaY, INK_SOFT);
  ctx.textAlign = 'right';
  inkText(ctx, metaR, CONTENT.right - 6, metaY, INK_SOFT);
  ctx.textAlign = 'center';
  divider(ctx, cx, 928, 300, 'rgba(125,12,12,0.7)');
  const al = fitFont(ctx, t.archiveLine, maxW, 21, 14, (s) => smallFont(lang, 600, s, true));
  ctx.font = smallFont(lang, 600, al, true);
  inkText(ctx, t.archiveLine, cx, 962, '#6b1410');

  // Right of the wax seal: the small stamp of the birthday under the signature from the note;
  // left of it: the date of birth and its curse
  if (P.input.birthday) {
    birthStamp(ctx, P.input.birthday, S);
    birthNote(ctx, P.input.birthday, lang);
  }
  const sig = signatureGlyphs(P.input.name);
  if (sig.length) {
    const unit = 0.74;
    ctx.save();
    ctx.translate(SIGNATURE.x - signatureWidth(sig, unit) / 2, SIGNATURE.y);
    ctx.rotate(-0.08);
    drawSignature(ctx, sig, unit);
    ctx.restore();
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
function drawPortrait(ctx: CanvasRenderingContext2D, src: CanvasImageSource, iw: number, ih: number, S: number, y: number) {
  const { x, w, h } = PORTRAIT;
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
  // (a faded old colour print: the real colours stay, washed towards sepia)
  const KEEP = 0.5;
  for (let i = 0; i < d.length; i += 4) {
    let v = (0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2]) / 255;
    v = Math.min(1, Math.max(0, (v - 0.5) * 1.1 + 0.52));
    const sr = 255 * Math.min(1, v * 1.02 + 0.06);
    const sg = 255 * Math.min(1, v * 0.86 + 0.04);
    const sb = 255 * Math.min(1, v * 0.66 + 0.02);
    d[i] = sr + (d[i] * 0.92 + 14 - sr) * KEEP;
    d[i + 1] = sg + (d[i + 1] * 0.9 + 10 - sg) * KEEP;
    d[i + 2] = sb + (d[i + 2] * 0.85 + 4 - sb) * KEEP;
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

  // a clean paper ground first (the circle's watermark must not run across the face), then the
  // print, slightly soaked into the sheet
  ctx.save();
  ctx.fillStyle = 'rgba(240, 225, 196, 0.92)';
  ctx.beginPath();
  ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 0.94;
  ctx.drawImage(c, x, y, w, h);
  ctx.globalCompositeOperation = 'multiply';
  ctx.globalAlpha = 0.18;
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

/**
 * The birthday's own small stamp: a deliberately simple seal (it is tiny) grown from the
 * digits of the date — a ring of its letters, a star, a centre — pressed a little askew.
 */
function birthStamp(ctx: CanvasRenderingContext2D, birthday: string, S: number) {
  const rng = makeRng(hashString(`birth␟${birthday}`));
  const [, mm, dd] = birthday.split('-').map(Number);
  const glyphs = dateToGlyphs(birthday).filter((g) => g >= 0);
  const hue = rng.range(0, 360);
  const { x, y, r } = BIRTH_STAMP;
  const c = document.createElement('canvas');
  c.width = c.height = Math.ceil(r * 2.3 * S);
  const g = c.getContext('2d')!;
  g.translate(c.width / 2, c.height / 2);
  g.scale(S, S);
  g.rotate(rng.range(-0.45, 0.45));
  g.strokeStyle = g.fillStyle = `hsl(${hue.toFixed(0)}, 55%, 28%)`;
  g.lineCap = g.lineJoin = 'round';
  const ring = (rr: number, w: number) => {
    g.lineWidth = w;
    g.beginPath();
    g.arc(0, 0, rr, 0, Math.PI * 2);
    g.stroke();
  };
  ring(r * 0.97, 2.4);
  ring(r * 0.9, 1);
  ring(r * 0.66, 1.4);
  // the date's letters around the band, upright towards the rim
  const n = glyphs.length || 1;
  glyphs.forEach((gl, i) => {
    g.save();
    g.rotate((i / n) * Math.PI * 2);
    g.translate(0, -r * 0.78);
    drawGlyph(g, gl, r * 0.2);
    g.restore();
  });
  // the emblem in the middle: a star, a sun, a moon, a strange sign, an eye, a triangle,
  // a hexagram or a square — chosen by the date, sometimes with little signs around it
  const R = r * 0.6;
  const rot = ((mm || 1) / 12) * Math.PI * 2;
  const kind = rng.pick(['star', 'sun', 'moon', 'sigil', 'sigil', 'eye', 'triangle', 'hexagram', 'square'] as const);
  const poly = (n: number, rr: number, a0: number, step = 1) => {
    g.beginPath();
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((i * step) / n) * Math.PI * 2 - Math.PI / 2;
      if (i) g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      else g.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    g.closePath();
    g.stroke();
  };
  const moon = (cx: number, cy: number, mr: number, a: number) => {
    g.save();
    g.translate(cx, cy);
    g.rotate(a);
    g.beginPath();
    g.arc(0, 0, mr, Math.PI * 0.25, Math.PI * 1.75);
    g.arc(mr * 0.45, 0, mr * 0.78, Math.PI * 1.62, Math.PI * 0.38, true);
    g.closePath();
    g.fill();
    g.restore();
  };
  g.lineWidth = 1.3;
  let centre = true;
  if (kind === 'star') {
    const pts = 5 + ((dd || 5) % 4);
    poly(pts, R, rot, pts >= 7 ? 3 : 2);
  } else if (kind === 'sun') {
    ring(r * 0.3, 1.4);
    const rays = rng.pick([8, 12, 16]);
    for (let i = 0; i < rays; i++) {
      const a = rot + (i / rays) * Math.PI * 2;
      const l = i % 2 ? 0.46 : 0.58;
      g.beginPath();
      g.moveTo(Math.cos(a) * r * 0.36, Math.sin(a) * r * 0.36);
      g.lineTo(Math.cos(a) * r * l, Math.sin(a) * r * l);
      g.stroke();
    }
  } else if (kind === 'moon') {
    moon(0, 0, r * 0.42, rot);
    centre = false;
  } else if (kind === 'sigil') {
    g.save();
    g.rotate(-rot * 0.2);
    drawSigil(g, makeSigil(rng.fork(7), 1.1), r * 0.5, 0.9);
    g.restore();
    centre = false;
  } else if (kind === 'eye') {
    const e = r * 0.5;
    g.beginPath();
    g.moveTo(-e, 0);
    g.quadraticCurveTo(0, -e * 0.75, e, 0);
    g.quadraticCurveTo(0, e * 0.75, -e, 0);
    g.stroke();
    ring(r * 0.16, 1.3);
    for (let i = -2; i <= 2; i++) {
      const a = -Math.PI / 2 + i * 0.32;
      g.beginPath();
      g.moveTo(Math.cos(a) * e * 0.62, Math.sin(a) * e * 0.62);
      g.lineTo(Math.cos(a) * e * 0.9, Math.sin(a) * e * 0.9);
      g.stroke();
    }
  } else if (kind === 'triangle') {
    poly(3, R, rot * 0.25);
    poly(3, R * 0.5, rot * 0.25 + Math.PI / 3);
  } else if (kind === 'hexagram') {
    poly(3, R, rot * 0.3);
    poly(3, R, rot * 0.3 + Math.PI / 3);
  } else {
    poly(4, R, Math.PI / 4 + rot * 0.2);
    poly(4, R * 0.7, rot * 0.2);
  }
  // little signs at the cardinal points (moons, dots, crosses, tiny suns)
  if (rng.chance(0.6)) {
    const sign = rng.pick(['moon', 'dot', 'cross', 'ring'] as const);
    const count = rng.pick([2, 3, 4]);
    for (let i = 0; i < count; i++) {
      const a = rot + (i / count) * Math.PI * 2;
      const px = Math.cos(a) * r * 0.5;
      const py = Math.sin(a) * r * 0.5;
      if (kind === 'sigil' || kind === 'eye') continue; // they fill the middle already
      if (sign === 'moon') moon(px, py, r * 0.08, a);
      else if (sign === 'dot') {
        g.beginPath();
        g.arc(px, py, r * 0.04, 0, Math.PI * 2);
        g.fill();
      } else if (sign === 'cross') {
        const q = r * 0.06;
        g.beginPath();
        g.moveTo(px - q, py);
        g.lineTo(px + q, py);
        g.moveTo(px, py - q);
        g.lineTo(px, py + q);
        g.stroke();
      } else {
        g.lineWidth = 1;
        g.beginPath();
        g.arc(px, py, r * 0.06, 0, Math.PI * 2);
        g.stroke();
        g.lineWidth = 1.3;
      }
    }
  }
  // centre
  if (centre) {
    ring(r * 0.14, 1.3);
    g.beginPath();
    g.arc(0, 0, r * 0.045, 0, Math.PI * 2);
    g.fill();
  }
  // a worn stamp: the ink did not take everywhere
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 70; i++) {
    g.globalAlpha = rng.range(0.15, 0.5);
    g.beginPath();
    g.arc(rng.range(-r, r), rng.range(-r, r), rng.range(0.6, 2.6), 0, Math.PI * 2);
    g.fill();
  }
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.globalAlpha = 0.5;
  ctx.drawImage(c, x - c.width / S / 2, y - c.height / S / 2, c.width / S, c.height / S);
  ctx.restore();
}

/** Left of the wax seal: "Born:", the date, and a curse on that day. */
function birthNote(ctx: CanvasRenderingContext2D, birthday: string, lang: Lang) {
  const t = STRINGS[lang];
  const { x, w } = BIRTH_NOTE;
  let y = BIRTH_NOTE.y;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.font = smallFont(lang, 600, 20, true);
  inkText(ctx, `${t.bornLabel}:`, x, y, LABEL);
  y += 30;
  const d = formatBirth(birthday, lang);
  const ds = fitFont(ctx, d, w, 25, 16, (s) => smallFont(lang, 700, s));
  ctx.font = smallFont(lang, 700, ds);
  inkText(ctx, d, x, y, INK);
  y += 30;
  const curse = fitBlock(ctx, t.birthCurse, w, 4, 17, 13, (s) => smallFont(lang, 500, s, true));
  ctx.font = smallFont(lang, 500, curse.size, true);
  for (const ln of curse.lines) {
    inkText(ctx, ln, x, y, '#6b1410');
    y += curse.size * 1.15;
  }
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
