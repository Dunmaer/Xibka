// Deterministic seed + PRNG. Identical inputs always give the identical ritual.

export interface CurseInput {
  name: string;
  reason: string;
  punishment: string;
}

const norm = (s: string) => s.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();

/** 32-bit FNV-1a followed by a murmur-style finaliser. */
export function hashString(str: string, salt = 0): number {
  let h = (0x811c9dc5 ^ salt) >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

export function curseSeed(input: CurseInput): number {
  return hashString(`${norm(input.name)}␟${norm(input.reason)}␟${norm(input.punishment)}`);
}

export type Rng = {
  (): number;
  range: (a: number, b: number) => number;
  int: (a: number, b: number) => number;
  pick: <T>(arr: readonly T[]) => T;
  chance: (p: number) => boolean;
  sign: () => 1 | -1;
  fork: (salt: number) => Rng;
};

/** mulberry32 */
export function makeRng(seed: number): Rng {
  let s = seed >>> 0;
  const next = (() => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }) as Rng;
  next.range = (a, b) => a + (b - a) * next();
  next.int = (a, b) => Math.floor(a + (b - a + 1) * next());
  next.pick = (arr) => arr[Math.floor(next() * arr.length) % arr.length];
  next.chance = (p) => next() < p;
  next.sign = () => (next() < 0.5 ? -1 : 1);
  next.fork = (salt) => makeRng(hashString(String(seed), salt));
  return next;
}

const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford, no I/L/O/U

/** Human-friendly archive serial, e.g. "666-7QK4-X9T". Derived from the seed only. */
export function archiveId(seed: number): string {
  const a = hashString(String(seed), 7);
  const b = hashString(String(seed), 13);
  let s = '';
  for (let i = 0; i < 4; i++) s += B32[(a >>> (i * 5)) & 31];
  s += '-';
  for (let i = 0; i < 3; i++) s += B32[(b >>> (i * 5)) & 31];
  return `666-${s}`;
}
