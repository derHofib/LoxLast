import {
  isTodo,
  REGISTER_ROLES,
  type LibraryCheck,
  type LoadedModel,
  type RegisterDef,
  type WallboxModel,
} from '@lastplan/wallbox-library';

/**
 * Sicht der Ladepunkte-Ansicht auf die Wallbox-Bibliothek (Kap. 6): Modellwahl,
 * Standardwerte und Anzeige der Registerliste samt Lücken. Erfindet nichts: Was in der
 * Modelldatei TODO ist, bleibt hier „fehlt“.
 */

export interface LibraryIndex {
  /** Gültige Modelle (vollständig oder unvollständig), nach Hersteller und Modell sortiert. */
  models: LoadedModel[];
  get(id: string): LoadedModel | undefined;
}

export function createLibraryIndex(library: LibraryCheck): LibraryIndex {
  const models = library.models
    .filter((m) => m.status !== 'invalid' && m.model !== undefined)
    .sort((a, b) => modelLabel(a.model).localeCompare(modelLabel(b.model), 'de'));
  const byId = new Map(models.map((m) => [m.expectedId, m]));
  return { models, get: (id) => byId.get(id) };
}

function modelLabel(model: WallboxModel | undefined): string {
  return model ? `${model.vendor} ${model.model}` : '';
}

/** „ABL eM4 Twin (Controller)“ bzw. die Modell-ID, wenn das Modell in der Bibliothek fehlt. */
export function modelDisplayName(index: LibraryIndex, modelId: string): string {
  return modelLabel(index.get(modelId)?.model) || modelId || 'kein Modell';
}

export interface ModelDefaults {
  port?: number;
  unitId?: number;
  minA?: number;
  maxA?: number;
  /** Felder, für die das Modell (noch) keinen echten Wert liefert. */
  missing: Array<'Port' | 'Unit-ID' | 'Mindeststrom' | 'Maximalstrom'>;
}

const real = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Standardwerte eines Modells. Nur echte Zahlen werden geliefert; TODO/null ergibt keinen
 * Wert, sondern einen Eintrag in `missing` (die Oberfläche weist darauf hin).
 */
export function modelDefaults(loaded: LoadedModel | undefined): ModelDefaults {
  const model = loaded?.model;
  const result: ModelDefaults = { missing: [] };
  if (!model) return result;
  const candidates = [
    ['port', 'Port', model.modbus.defaultPort],
    ['unitId', 'Unit-ID', model.modbus.defaultUnitId],
    ['minA', 'Mindeststrom', model.electrical.minA],
    ['maxA', 'Maximalstrom', model.electrical.maxA],
  ] as const;
  for (const [key, label, value] of candidates) {
    if (real(value)) result[key] = value;
    else result.missing.push(label);
  }
  return result;
}

/** Ein Anzeigewert: echter Wert oder Lücke. */
export type InfoValue = { todo: false; text: string } | { todo: true };

const value = (v: unknown, unit = ''): InfoValue =>
  isTodo(v) || v === undefined ? { todo: true } : { todo: false, text: `${String(v)}${unit}` };

export interface RegisterRow {
  role: string;
  address: InfoValue;
  fn: InfoValue;
  type: InfoValue;
  scale: InfoValue;
  /** Quelle je Register; „TODO“ zählt als fehlend. */
  source: InfoValue;
}

export const ROLE_LABEL: Record<string, string> = {
  setpointCurrent: 'Sollstrom',
  enable: 'Freigabe',
  currentL1: 'Strom L1',
  currentL2: 'Strom L2',
  currentL3: 'Strom L3',
  power: 'Leistung',
  energy: 'Energie',
  status: 'Status',
};

function registerRow(role: string, def: RegisterDef | undefined): RegisterRow {
  return {
    role,
    address: value(def?.address),
    fn: value(def?.fn),
    type: value(def?.type),
    scale: value(def?.scale),
    source: value(def?.source),
  };
}

export interface ModelInfo {
  modelId: string;
  /** false: Modell-ID steht nicht in der Bibliothek. */
  inLibrary: boolean;
  displayName: string;
  complete: boolean;
  /** Anzahl TODO-Werte in der Modelldatei. */
  missingCount: number;
  firmware: { min: InfoValue; max: InfoValue };
  port: InfoValue;
  unitId: InfoValue;
  registers: RegisterRow[];
}

/** Aufbereitung für die Infos-Spalte „Aus der Bibliothek“. */
export function describeModel(index: LibraryIndex, modelId: string): ModelInfo {
  const loaded = index.get(modelId);
  const model = loaded?.model;
  if (!loaded || !model) {
    return {
      modelId,
      inLibrary: false,
      displayName: modelId || 'kein Modell',
      complete: false,
      missingCount: 0,
      firmware: { min: { todo: true }, max: { todo: true } },
      port: { todo: true },
      unitId: { todo: true },
      registers: [],
    };
  }
  const roles = [...REGISTER_ROLES, ...Object.keys(model.modbus.registers)].filter(
    (r, i, all) => all.indexOf(r) === i,
  );
  return {
    modelId,
    inLibrary: true,
    displayName: modelLabel(model),
    complete: loaded.status === 'complete',
    missingCount: loaded.todos.length,
    firmware: {
      min: value(model.firmware.min),
      // null = bewusst „keine Obergrenze“, kein TODO
      max: model.firmware.max === null ? { todo: false, text: 'offen' } : value(model.firmware.max),
    },
    port: value(model.modbus.defaultPort),
    unitId: value(model.modbus.defaultUnitId),
    registers: roles.map((r) => registerRow(r, model.modbus.registers[r])),
  };
}
