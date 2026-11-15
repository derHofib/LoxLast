import { newId } from '../ids';
import { DEFAULT_NAMING_SCHEME } from './naming';
import { CURRENT_SCHEMA_VERSION, type Project, type ProjectSettings } from './project';

export const DEFAULT_SETTINGS: ProjectSettings = {
  voltageV: 230,
  maxUnbalanceA: 20,
  namingScheme: DEFAULT_NAMING_SCHEME,
};

export interface CreateProjectOptions {
  name: string;
  /** Für Tests injizierbar. */
  now?: () => Date;
  idFactory?: () => string;
}

/**
 * Legt ein leeres Projekt mit sinnvollen Standardwerten an.
 * Netzanschluss-Werte sind Platzhalter, die der Nutzer beim Anlegen überschreibt.
 */
export function createProject({
  name,
  now = () => new Date(),
  idFactory = newId,
}: CreateProjectOptions): Project {
  const timestamp = now().toISOString();
  return {
    id: idFactory(),
    schemaVersion: CURRENT_SCHEMA_VERSION,
    name: name.trim(),
    site: {
      gridConnectionFuseA: 63,
      gridConnectionLabel: 'Netzanschluss',
      buildingReserveA: 0,
    },
    clusters: [],
    groups: [],
    chargePoints: [],
    settings: { ...DEFAULT_SETTINGS, namingScheme: { ...DEFAULT_SETTINGS.namingScheme } },
    exportHistory: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
