import { checkLibraryPackage } from '@lastplan/wallbox-library';
import { dexieLibraryCache, LIBRARY_CACHE_KEY, type LibraryCache } from './cache';
import { LIBRARY_URL, isCheckOnStartEnabled } from './config';
import { setRemoteLibrary, useLibraryStore } from './libraryStore';
import { fetchRemoteLibrary, type FetchFn } from './remote';

export type UpdateResult =
  | { status: 'unchanged'; version: string | null }
  | { status: 'updated'; version: string; cached: boolean }
  | { status: 'error'; error: string };

export interface UpdateOptions {
  url?: string;
  fetchFn?: FetchFn;
  cache?: LibraryCache;
  now?: () => Date;
}

/**
 * Lädt das Paket und übernimmt es nur, wenn die Version sich von der aktuellen unterscheidet.
 * Ungültige oder nicht erreichbare Pakete ändern nichts; die bisherige Bibliothek bleibt.
 * Diese Funktion ist die ausdrückliche Aktion „Nach neuer Bibliothek suchen“.
 */
export async function checkForLibraryUpdate(options: UpdateOptions = {}): Promise<UpdateResult> {
  const {
    url = LIBRARY_URL,
    fetchFn = fetch,
    cache = dexieLibraryCache,
    now = () => new Date(),
  } = options;
  const current = useLibraryStore.getState().version;

  const result = await fetchRemoteLibrary(url, fetchFn);
  if (!result.ok) return { status: 'error', error: result.error };

  const version = result.remote.library.version;
  if (version === current) return { status: 'unchanged', version };

  let cached = true;
  try {
    await cache.write({
      key: LIBRARY_CACHE_KEY,
      url,
      fetchedAt: now().toISOString(),
      library: result.remote.library,
    });
  } catch {
    // Speicher voll oder gesperrt: Das geprüfte Paket gilt trotzdem für diese Sitzung.
    cached = false;
  }
  setRemoteLibrary(result.remote);
  return { status: 'updated', version, cached };
}

/**
 * Stellt beim Start das zuletzt übernommene Paket wieder her. Das Paket wird erneut geprüft,
 * weil der Speicher nicht vertrauenswürdig ist. Fehler bedeuten: gebündelte Bibliothek bleibt.
 */
export async function restoreCachedLibrary(
  options: Pick<UpdateOptions, 'url' | 'cache'> = {},
): Promise<boolean> {
  const { url = LIBRARY_URL, cache = dexieLibraryCache } = options;
  try {
    const row = await cache.read();
    if (!row || row.url !== url) return false;
    const check = checkLibraryPackage(row.library);
    if (!check.ok) return false;
    setRemoteLibrary({ library: check.library, checks: check.checks });
    return true;
  } catch {
    return false;
  }
}

/**
 * Start der App: erst das Zwischengespeicherte, dann (sofern eingeschaltet) die Prüfung.
 * Gibt null zurück, wenn die Prüfung aus ist (Schalter oder Tests).
 */
export async function startLibraryUpdates(
  options: UpdateOptions = {},
): Promise<UpdateResult | null> {
  await restoreCachedLibrary(options);
  if (!isCheckOnStartEnabled()) return null;
  return checkForLibraryUpdate(options);
}
