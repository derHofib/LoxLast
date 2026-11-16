import { create } from 'zustand';
import type { ModelCatalog } from '@lastplan/core';
import { toModelCatalog } from '@lastplan/wallbox-library';
import { bundledCatalog } from './catalog';
import type { RemoteLibrary } from './remote';

export type LibrarySource = 'gebündelt' | 'nachgeladen';

export interface LibraryState {
  /** „gebündelt“: mit der App geliefert. „nachgeladen“: aus dem Paket von GitHub Pages. */
  source: LibrarySource;
  /** Version des Pakets; null bei der mitgelieferten Bibliothek (ohne Versionsangabe). */
  version: string | null;
  catalog: ModelCatalog;
}

export const useLibraryStore = create<LibraryState>(() => ({
  source: 'gebündelt',
  version: null,
  catalog: bundledCatalog,
}));

/** Aktueller Stand der Bibliothek für Komponenten: { source, version, catalog }. */
export function useLibrary(): LibraryState {
  return useLibraryStore((state) => state);
}

/** Übernimmt ein geprüftes Paket als aktuelle Bibliothek. */
export function setRemoteLibrary({ library, checks }: RemoteLibrary): void {
  useLibraryStore.setState({
    source: 'nachgeladen',
    version: library.version,
    catalog: toModelCatalog(checks),
  });
}

/** Setzt auf die gebündelte Bibliothek zurück (Tests und Abmeldung). */
export function resetToBundledLibrary(): void {
  useLibraryStore.setState({ source: 'gebündelt', version: null, catalog: bundledCatalog });
}
