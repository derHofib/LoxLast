/**
 * Typen für Wallbox-Modelldateien (Kap. 6).
 *
 * Die maßgebliche Definition ist `schema/wallbox-model.schema.json`. Diese Typen spiegeln
 * das Schema und werden in den Tests gegen die Vorlage geprüft.
 */

/** Platzhalter für einen noch nicht belegten Wert, z. B. "TODO" oder "TODO(verify: …)". */
export type TodoMarker = `TODO${string}`;

/** Wert aus einer Herstellerunterlage oder ein Platzhalter. */
export type Todoable<T> = T | TodoMarker;

/** Rollen, die jedes Modell mindestens als Register beschreiben muss. */
export const REGISTER_ROLES = [
  'setpointCurrent',
  'enable',
  'currentL1',
  'currentL2',
  'currentL3',
  'power',
  'energy',
  'status',
] as const;

export type RegisterRole = (typeof REGISTER_ROLES)[number];

export type RegisterType = 'uint16' | 'int16' | 'uint32' | 'int32' | 'float32';

export interface RegisterDef {
  address: Todoable<number>;
  /** Modbus-Funktionscode. */
  fn: Todoable<number>;
  type: Todoable<RegisterType>;
  scale: Todoable<number>;
  access: Todoable<'r' | 'rw'>;
  unit: Todoable<string>;
  enum?: Todoable<Record<string, string>>;
  /** Quelle je Register, z. B. "Dokumentname, Version, Seite" oder "TODO". */
  source: string;
}

export interface WallboxModel {
  $schema?: string;
  /** Kennung nach Schema `<hersteller>/<modell>@<version>`, z. B. "abl/em4-twin@1". */
  id: string;
  vendor: string;
  model: string;
  firmware: {
    min: Todoable<string>;
    max: Todoable<string> | null;
    source: string;
  };
  protocols: Array<'modbus-tcp' | 'http' | 'ocpp-bridge'>;
  electrical: {
    minA: Todoable<number>;
    maxA: Todoable<number>;
    phases: Todoable<Array<1 | 3>>;
    phaseSwitching: Todoable<boolean>;
    source: string;
  };
  modbus: {
    defaultPort: Todoable<number>;
    defaultUnitId: Todoable<number>;
    byteOrder: Todoable<string>;
    registers: Partial<Record<RegisterRole, RegisterDef>> & Record<string, RegisterDef>;
    source: string;
  };
  loxone: {
    functionBlock: Todoable<string>;
    /** Zuordnung Loxone-Eingang → "registers.<rolle>". */
    inputs: Todoable<Record<string, string>>;
    /** Zuordnung Loxone-Ausgang → "registers.<rolle>". */
    outputs: Todoable<Record<string, string>>;
  };
}

/** Prüft, ob ein Wert ein TODO-Platzhalter ist. */
export function isTodo(value: unknown): value is TodoMarker {
  return typeof value === 'string' && value.startsWith('TODO');
}
