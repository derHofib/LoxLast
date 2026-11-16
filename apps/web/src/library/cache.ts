import { db, type LibraryCacheRow } from '../storage/db';

/** Zwischenspeicher für das nachgeladene Paket; Tests setzen eine Speicherattrappe ein. */
export interface LibraryCache {
  read(): Promise<LibraryCacheRow | undefined>;
  write(row: LibraryCacheRow): Promise<void>;
}

export const LIBRARY_CACHE_KEY = 'remote';

/** Lokal in IndexedDB (Dexie, Tabelle libraryCache). Nur für diese Bibliothek, keine Projektdaten. */
export const dexieLibraryCache: LibraryCache = {
  read: () => db.libraryCache.get(LIBRARY_CACHE_KEY),
  write: async (row) => {
    await db.libraryCache.put(row);
  },
};
