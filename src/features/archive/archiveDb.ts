// The archive of curses lives only in this browser (IndexedDB), nothing is sent anywhere.
// A record keeps the typed text + language + date; the full certificate is re-drawn from it
// on demand (it is deterministic), and a small thumbnail is stored for the gallery.
import type { Lang } from '../i18n/strings';
import type { CurseInput } from '../../utils/seed/seed';

export interface CurseRecord {
  id: string;
  archiveId: string;
  input: CurseInput;
  lang: Lang;
  createdAt: number;
  thumb?: Blob;
}

const DB_NAME = 'proklinatel';
const STORE = 'curses';
const FALLBACK_KEY = 'proklinatel.archive';

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const s = db.createObjectStore(STORE, { keyPath: 'id' });
          s.createIndex('createdAt', 'createdAt');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function tx<T>(db: IDBDatabase, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// localStorage fallback (no thumbnails) for browsers that block IndexedDB.
function lsRead(): CurseRecord[] {
  try {
    return JSON.parse(localStorage.getItem(FALLBACK_KEY) || '[]') as CurseRecord[];
  } catch {
    return [];
  }
}
function lsWrite(list: CurseRecord[]) {
  try {
    localStorage.setItem(FALLBACK_KEY, JSON.stringify(list.map(({ thumb: _t, ...r }) => r)));
  } catch {
    /* ignore */
  }
}

export async function saveCurse(rec: CurseRecord): Promise<void> {
  const db = await openDb();
  if (!db) {
    lsWrite([rec, ...lsRead().filter((r) => r.id !== rec.id)]);
    return;
  }
  try {
    await tx(db, 'readwrite', (s) => s.put(rec));
  } catch {
    // Some browsers refuse Blobs in IDB (old Safari private mode): retry without thumbnail.
    await tx(db, 'readwrite', (s) => s.put({ ...rec, thumb: undefined }));
  }
}

export async function listCurses(): Promise<CurseRecord[]> {
  const db = await openDb();
  if (!db) return lsRead();
  const all = await tx<CurseRecord[]>(db, 'readonly', (s) => s.getAll());
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export async function deleteCurse(id: string): Promise<void> {
  const db = await openDb();
  if (!db) {
    lsWrite(lsRead().filter((r) => r.id !== id));
    return;
  }
  await tx(db, 'readwrite', (s) => s.delete(id));
}

export function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}
