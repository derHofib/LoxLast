import type { ModelCatalog } from '@lastplan/core';
import {
  loadLibrary,
  toModelCatalog,
  type LibraryCheck,
  type ModelFile,
} from '@lastplan/wallbox-library';

/**
 * Mitgelieferte Wallbox-Bibliothek (ADR 0002): Die Modelldateien werden beim Build eingebettet,
 * damit Prüfung und Formulare auch ohne Internet funktionieren. Nachladen neuerer Versionen
 * folgt in Meilenstein 5.
 */
const raw = import.meta.glob('../../../../packages/wallbox-library/models/**/*.json', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

export const bundledModelFiles: ModelFile[] = Object.entries(raw).map(([path, content]) => ({
  path: path.replace(/^.*\/models\//, ''),
  content,
}));

export const bundledLibrary: LibraryCheck = loadLibrary(bundledModelFiles);

export const bundledCatalog: ModelCatalog = toModelCatalog(bundledLibrary);
