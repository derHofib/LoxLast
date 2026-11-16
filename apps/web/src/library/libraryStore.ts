import { create } from 'zustand';
import type { ModelCatalog } from '@lastplan/core';
import {
  toModelCatalog,
  type LibraryCheck,
  type ModelCheck,
  type WallboxModel,
} from '@lastplan/wallbox-library';
import { bundledCatalog, bundledLibrary } from './catalog';
import type { RemoteLibrary } from './remote';

export type LibrarySource = 'gebündelt' | 'nachgeladen';

export interface LibraryState {
  /** „gebündelt“: mit der App geliefert. „nachgeladen“: aus dem Paket von GitHub Pages. */
  source: LibrarySource;
  /** Version des Pakets; null bei der mitgelieferten Bibliothek (ohne Versionsangabe). */
  version: string | null;
  catalog: ModelCatalog;
  /** Vollständige Modelldateien (für die Übergabe an Config), ohne ungültige. */
  models: ReadonlyMap<string, WallboxModel>;
}

/** Modelldateien je Kennung aus einer geprüften Bibliothek. */
export function toModelMap(input: LibraryCheck | ModelCheck[]): ReadonlyMap<string, WallboxModel> {
  const list = Array.isArray(input) ? input : input.models;
  const map = new Map<string, WallboxModel>();
  for (const m of list) if (m.status !== 'invalid' && m.model) map.set(m.model.id, m.model);
  return map;
}

const bundledModels = toModelMap(bundledLibrary);

export const useLibraryStore = create<LibraryState>(() => ({
  source: 'gebündelt',
  version: null,
  catalog: bundledCatalog,
  models: bundledModels,
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
    models: toModelMap(checks),
  });
}

/** Setzt auf die gebündelte Bibliothek zurück (Tests und Abmeldung). */
export function resetToBundledLibrary(): void {
  useLibraryStore.setState({
    source: 'gebündelt',
    version: null,
    catalog: bundledCatalog,
    models: bundledModels,
  });
}
