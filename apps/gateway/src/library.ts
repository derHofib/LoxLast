import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLibrary, type ModelFile, type WallboxModel } from '@lastplan/wallbox-library';

/**
 * Wallbox-Bibliothek im Gateway (Kap. 6, ADR 0012): einzige Quelle für Registeradressen,
 * Funktionscodes, Typen und Skalierung. Ungültige Modelldateien werden übergangen,
 * unvollständige (TODO) bleiben enthalten – der Geräte-Test meldet dann „nicht prüfbar“.
 */
export interface ModelLibrary {
  get(id: string): WallboxModel | undefined;
  readonly size: number;
}

export function libraryFromFiles(files: ModelFile[]): ModelLibrary {
  const models = new Map<string, WallboxModel>();
  for (const loaded of loadLibrary(files).models) {
    if (loaded.status !== 'invalid' && loaded.model) models.set(loaded.model.id, loaded.model);
  }
  return { get: (id) => models.get(id), size: models.size };
}

/**
 * Standardordner: `packages/wallbox-library/models` im Repository (gilt für `src/` und `dist/`).
 * Im Docker-Image setzt `GATEWAY_LIBRARY_DIR` den kopierten Ordner.
 */
export function defaultLibraryDir(): string {
  return fileURLToPath(new URL('../../../packages/wallbox-library/models', import.meta.url));
}

/** Liest alle `<hersteller>/<modell>@<version>.json` aus einem Ordner. Fehlt er, ist die Bibliothek leer. */
export function loadLibraryDir(dir: string): ModelLibrary {
  if (!existsSync(dir)) return libraryFromFiles([]);
  const files = readdirSync(dir, { recursive: true })
    .map(String)
    .filter((p) => p.endsWith('.json'))
    .map((p) => p.split(sep).join('/'))
    .sort()
    .map((path) => ({ path, content: readFileSync(join(dir, path), 'utf8') }));
  return libraryFromFiles(files);
}
