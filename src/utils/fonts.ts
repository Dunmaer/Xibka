// Self-hosted fonts (via @fontsource, imported in main.tsx) + helpers to make sure the
// right subsets are loaded before we draw text on a canvas.
import type { Lang } from '../features/i18n/strings';

export const FONT = {
  title: {
    en: '"Cinzel", "Cormorant SC", serif',
    ru: '"Cormorant SC", "Cormorant Garamond", serif',
    hy: '"Noto Serif Armenian", serif',
  } as Record<Lang, string>,
  body: '"Cormorant Garamond", "Noto Serif Armenian", Georgia, serif',
  label: '"Cormorant SC", "Cormorant Garamond", "Noto Serif Armenian", serif',
  hand: '"Caveat", "Noto Serif Armenian", cursive',
};

const SAMPLE = 'AaЯяԱա';

export async function ensureFonts(lang: Lang, text = ''): Promise<void> {
  if (!('fonts' in document)) return;
  const sample = SAMPLE + text;
  const specs = [
    `700 40px ${FONT.title[lang]}`,
    `700 40px ${FONT.body}`,
    `italic 500 40px ${FONT.body}`,
    `italic 600 40px ${FONT.body}`,
    `500 40px ${FONT.body}`,
    `600 40px ${FONT.body}`,
    `600 40px ${FONT.label}`,
    `600 40px ${FONT.hand}`,
    `700 40px ${FONT.hand}`,
  ];
  try {
    await Promise.race([
      Promise.all(specs.map((s) => document.fonts.load(s, sample))),
      new Promise((r) => setTimeout(r, 3500)),
    ]);
  } catch {
    /* draw with fallbacks */
  }
}
