/**
 * Einstellungen für das Nachladen der Wallbox-Bibliothek (ADR 0002).
 * Die App lädt nur dieses eine Paket, sonst nichts: keine Telemetrie, keine weiteren Daten.
 */

/** Veröffentlichtes Bibliothekspaket auf GitHub Pages (siehe packages/wallbox-library/README.md). */
export const LIBRARY_URL = 'https://derhofib.github.io/LoxLast/library.json';

/** Standard: nicht automatisch beim Start abrufen, nur auf Wunsch (ADR 0002). */
export const LIBRARY_CHECK_ON_START = false;

/** Schalter im Browser (pro Gerät): „on“ oder „off“. Ohne Eintrag gilt LIBRARY_CHECK_ON_START. */
export const CHECK_ON_START_KEY = 'lastplan.library.checkOnStart';

/**
 * Ob beim Start geprüft wird. In Tests immer aus, damit kein Netz genutzt wird.
 * Ein gesperrter Speicher (privates Fenster) ändert nur den Standard.
 */
export function isCheckOnStartEnabled(): boolean {
  if (import.meta.env.MODE === 'test') return false;
  try {
    const stored = localStorage.getItem(CHECK_ON_START_KEY);
    if (stored === 'off') return false;
    if (stored === 'on') return true;
  } catch {
    // Speicher nicht verfügbar: Standardwert gilt.
  }
  return LIBRARY_CHECK_ON_START;
}

export function setCheckOnStartEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(CHECK_ON_START_KEY, enabled ? 'on' : 'off');
  } catch {
    // Speicher nicht verfügbar: Die Einstellung wird dann nicht dauerhaft gespeichert.
  }
}
