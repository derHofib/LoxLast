import {
  checkLibraryPackage,
  type LibraryPackage,
  type ModelCheck,
} from '@lastplan/wallbox-library';

/** Nur der Teil von fetch, den wir brauchen; Tests können ihn ersetzen. */
export type FetchFn = (
  url: string,
  init?: RequestInit,
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export interface RemoteLibrary {
  library: LibraryPackage;
  checks: ModelCheck[];
}

export type FetchRemoteResult = { ok: true; remote: RemoteLibrary } | { ok: false; error: string };

/**
 * Lädt library.json und prüft es vollständig (Format, jedes Modell mit Schema und Regeln).
 * Nur ein vollständig gültiges Paket wird übernommen. Netz- und Formatfehler kommen als
 * Ergebnis zurück und werfen nicht; die gebündelte Bibliothek bleibt dann gültig.
 */
export async function fetchRemoteLibrary(
  url: string,
  fetchFn: FetchFn = fetch,
): Promise<FetchRemoteResult> {
  let response: Awaited<ReturnType<FetchFn>>;
  try {
    // Keine Zugangsdaten, keine zusätzlichen Header: nur der Abruf der Datei.
    response = await fetchFn(url, { cache: 'no-store', credentials: 'omit' });
  } catch {
    return { ok: false, error: 'Die Bibliothek konnte nicht geladen werden (keine Verbindung).' };
  }
  if (!response.ok) {
    return {
      ok: false,
      error: `Die Bibliothek ist nicht erreichbar (HTTP ${response.status}).`,
    };
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    return { ok: false, error: 'Die Bibliothek ist kein gültiges JSON.' };
  }

  const check = checkLibraryPackage(data);
  if (!check.ok) {
    return { ok: false, error: `Die Bibliothek ist ungültig: ${check.errors.join(' ')}` };
  }
  return { ok: true, remote: { library: check.library, checks: check.checks } };
}
