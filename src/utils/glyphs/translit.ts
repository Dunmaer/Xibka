// Text -> infernal letters.
// symbols.svg holds 32 letters; they are read in file order as the Russian alphabet
// without "ё" (а б в г д е ж з и й к л м н о п р с т у ф х ц ч ш щ ъ ы ь э ю я).
// Latin and Armenian input is transliterated to that alphabet first, so a name is
// "spelled" in the infernal script regardless of the language it was typed in.

export const INFERNAL_ALPHABET = 'абвгдежзийклмнопрстуфхцчшщъыьэюя';
export const GLYPH_COUNT = 32;

const LATIN_DIGRAPHS: [string, string][] = [
  ['shch', 'щ'], ['sch', 'щ'], ['sh', 'ш'], ['ch', 'ч'], ['zh', 'ж'], ['kh', 'х'], ['ts', 'ц'],
  ['ya', 'я'], ['yu', 'ю'], ['yo', 'е'], ['ye', 'е'], ['ph', 'ф'], ['th', 'т'], ['ck', 'к'],
];

const LATIN: Record<string, string> = {
  a: 'а', b: 'б', c: 'к', d: 'д', e: 'е', f: 'ф', g: 'г', h: 'х', i: 'и', j: 'й', k: 'к', l: 'л', m: 'м',
  n: 'н', o: 'о', p: 'п', q: 'к', r: 'р', s: 'с', t: 'т', u: 'у', v: 'в', w: 'в', x: 'кс', y: 'ы', z: 'з',
};

const ARMENIAN: Record<string, string> = {
  'ա': 'а', 'բ': 'б', 'գ': 'г', 'դ': 'д', 'ե': 'е', 'զ': 'з', 'է': 'э', 'ը': 'ы', 'թ': 'т', 'ժ': 'ж',
  'ի': 'и', 'լ': 'л', 'խ': 'х', 'ծ': 'ц', 'կ': 'к', 'հ': 'х', 'ձ': 'з', 'ղ': 'г', 'ճ': 'ч', 'մ': 'м',
  'յ': 'й', 'ն': 'н', 'շ': 'ш', 'ո': 'о', 'չ': 'ч', 'պ': 'п', 'ջ': 'ж', 'ռ': 'р', 'ս': 'с', 'վ': 'в',
  'տ': 'т', 'ր': 'р', 'ց': 'ц', 'ւ': 'в', 'փ': 'п', 'ք': 'к', 'օ': 'о', 'ֆ': 'ф', 'և': 'ев',
};

/** Returns glyph indices (0..31) with -1 marking a word gap. */
export function toGlyphs(text: string): number[] {
  let s = text.normalize('NFC').toLowerCase().replace(/ё/g, 'е');
  for (const [from, to] of LATIN_DIGRAPHS) s = s.split(from).join(to);
  const out: number[] = [];
  for (const ch of s) {
    const mapped = LATIN[ch] ?? ARMENIAN[ch] ?? ch;
    for (const c of mapped) {
      const idx = INFERNAL_ALPHABET.indexOf(c);
      if (idx >= 0) out.push(idx);
      else if (/\s/.test(c)) {
        if (out.length && out[out.length - 1] !== -1) out.push(-1);
      } else if (/[\p{L}\p{N}]/u.test(c)) out.push((c.codePointAt(0) ?? 0) % GLYPH_COUNT);
    }
  }
  while (out.length && out[out.length - 1] === -1) out.pop();
  return out;
}

/**
 * A date in infernal letters, the way old scripts wrote numbers with letters:
 * 1 а, 2 в, 3 г, 4 д, 5 е, 6 ж, 7 з, 8 и, 9 й, 0 о. Day, month and year are separated by gaps.
 */
export function dateToGlyphs(iso: string): number[] {
  const DIGIT = 'овгдежзий'.split('');
  const map = (d: string) => INFERNAL_ALPHABET.indexOf(d === '1' ? 'а' : DIGIT[Number(d)]);
  const [y, m, d] = iso.split('-');
  const out: number[] = [];
  for (const part of [d, m, y]) {
    if (!part) continue;
    if (out.length) out.push(-1);
    for (const ch of part) if (/\d/.test(ch)) out.push(map(ch));
  }
  return out;
}

