import type { ChargePoint } from '../model';
import { serializeCsv } from './csv';

/**
 * Importierbare Ladepunkt-Felder (Kap. 11.2, CSV-Import).
 *
 * Abgeleitet aus `ChargePoint`: Jedes Feld des Modells außer `id` ist hier aufgeführt, `groupId`
 * als Gruppenname und `network` aufgeteilt in IP, Port und Unit-ID. Kommt im Modell ein Feld dazu,
 * meldet der Typ `Record<ImportFieldKey, …>` unten einen Fehler, bis es hier ergänzt ist.
 */
export type ImportFieldKey =
  Exclude<keyof ChargePoint, 'id' | 'groupId' | 'network'> | 'group' | keyof ChargePoint['network'];

export interface ImportField {
  key: ImportFieldKey;
  /** Anzeigename und Spaltenkopf der Vorlage (ohne Einheit). */
  label: string;
  /** Pflichtfeld: ohne zugeordnete Spalte bzw. ohne Wert ist keine Zeile importierbar. */
  required: boolean;
  unit?: 'A';
  /** Kurze Formatbeschreibung für den Mapping-Dialog. */
  hint: string;
  /** Weitere Spaltenköpfe, die automatisch zugeordnet werden (deutsch/englisch). */
  synonyms: readonly string[];
}

const FIELD_DEFS: Record<ImportFieldKey, Omit<ImportField, 'key'>> = {
  label: {
    label: 'Bezeichnung',
    required: true,
    hint: 'Eindeutig im Projekt, z. B. LP01',
    synonyms: [
      'Ladepunkt',
      'Ladepunktbezeichnung',
      'Ladepunkt-Name',
      'LP',
      'LP-Nr',
      'LP-Nummer',
      'Name',
      'Label',
      'Charge point',
      'Charging point',
    ],
  },
  group: {
    label: 'Gruppe',
    required: true,
    hint: 'Vorhandene Gruppe, bei gleichen Namen als „Cluster › Gruppe“',
    synonyms: ['Lastgruppe', 'Gruppenname', 'Cluster › Gruppe', 'Group', 'Load group'],
  },
  libraryModelId: {
    label: 'Modell-ID',
    required: false,
    hint: 'Aus der Wallbox-Bibliothek, z. B. hersteller/modell@1; leer = wie vorheriger Ladepunkt',
    synonyms: [
      'Modell',
      'Wallbox-Modell',
      'Bibliotheksmodell',
      'Model',
      'Model ID',
      'Library model',
      'libraryModelId',
    ],
  },
  ip: {
    label: 'IP-Adresse',
    required: true,
    hint: 'IPv4, z. B. 192.168.1.20',
    synonyms: ['IP', 'IPv4', 'IPv4-Adresse', 'IP address'],
  },
  port: {
    label: 'Port',
    required: false,
    hint: '1–65535; leer = wie vorheriger Ladepunkt bzw. 502',
    synonyms: ['TCP-Port', 'Modbus-Port'],
  },
  unitId: {
    label: 'Unit-ID',
    required: false,
    hint: 'Modbus Unit-ID 0–247',
    synonyms: ['Modbus-Unit-ID', 'Modbus-ID', 'Slave-ID', 'Slave-Adresse', 'unitId'],
  },
  minA: {
    label: 'Min. Strom',
    required: false,
    unit: 'A',
    hint: 'Mindestens 6 A (IEC 61851)',
    synonyms: [
      'Mindeststrom',
      'Minimalstrom',
      'Min Strom',
      'Strom min',
      'Min current',
      'Minimum current',
      'minA',
      'Imin',
    ],
  },
  maxA: {
    label: 'Max. Strom',
    required: false,
    unit: 'A',
    hint: 'Höchstens Absicherung',
    synonyms: [
      'Maximalstrom',
      'Höchststrom',
      'Max Strom',
      'Strom max',
      'Max current',
      'Maximum current',
      'maxA',
      'Imax',
    ],
  },
  fuseA: {
    label: 'Absicherung',
    required: false,
    unit: 'A',
    hint: 'Absicherung der Zuleitung',
    synonyms: ['Sicherung', 'Vorsicherung', 'Leitungsschutzschalter', 'Fuse', 'fuseA'],
  },
  phases: {
    label: 'Phasen',
    required: false,
    hint: '1 oder 3',
    synonyms: ['Anzahl Phasen', 'Phasenanzahl', 'Anschluss', 'Phases', 'Number of phases'],
  },
  phaseRotation: {
    label: 'Phasenlage',
    required: false,
    hint: 'L1-L2-L3, L2-L3-L1 oder L3-L1-L2; leer = L1-L2-L3',
    synonyms: [
      'Phasenrotation',
      'Phasenfolge',
      'Phasenbelegung',
      'Phase rotation',
      'Phase order',
      'phaseRotation',
    ],
  },
  phaseSwitching: {
    label: 'Phasenumschaltung',
    required: false,
    hint: 'ja oder nein; leer = nein',
    synonyms: ['1/3-Phasen-Umschaltung', 'Phase switching', 'phaseSwitching'],
  },
  protocol: {
    label: 'Protokoll',
    required: false,
    hint: 'modbus-tcp, http oder ocpp-bridge',
    synonyms: ['Protocol', 'Kommunikation'],
  },
  room: {
    label: 'Raum',
    required: false,
    hint: 'Freitext',
    synonyms: ['Ort', 'Standort', 'Room', 'Location'],
  },
  category: {
    label: 'Kategorie',
    required: false,
    hint: 'Freitext',
    synonyms: ['Category'],
  },
  notes: {
    label: 'Notizen',
    required: false,
    hint: 'Freitext',
    synonyms: ['Notiz', 'Bemerkung', 'Bemerkungen', 'Kommentar', 'Anmerkung', 'Notes', 'Comment'],
  },
};

/** Felder in der Reihenfolge der Vorlage und des Mapping-Dialogs. */
export const IMPORT_FIELDS: readonly ImportField[] = (
  Object.entries(FIELD_DEFS) as [ImportFieldKey, Omit<ImportField, 'key'>][]
).map(([key, def]) => ({ key, ...def }));

export function importField(key: ImportFieldKey): ImportField {
  return { key, ...FIELD_DEFS[key] };
}

/** Spaltenkopf der Vorlage, z. B. „Min. Strom (A)“. */
export const fieldHeader = (field: ImportField): string =>
  field.unit ? `${field.label} (${field.unit})` : field.label;

/** Zuordnung Zielfeld → Spaltenindex der CSV. Fehlende Schlüssel = nicht zugeordnet. */
export type ColumnMapping = Partial<Record<ImportFieldKey, number>>;

/**
 * Normalisiert Spaltenköpfe für den Vergleich: Groß-/Kleinschreibung, Umlaute, Leer- und
 * Satzzeichen sowie Einheiten in Klammern spielen keine Rolle.
 * „Min. Strom (A)“ → „minstrom“, „IP-Adresse“ → „ipadresse“, „Höchststrom“ → „hoechststrom“.
 */
export function normalizeHeader(text: string): string {
  return text
    .normalize('NFC')
    .toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]/g, '')
    .replaceAll('ä', 'ae')
    .replaceAll('ö', 'oe')
    .replaceAll('ü', 'ue')
    .replaceAll('ß', 'ss')
    .replace(/[^a-z0-9]/g, '');
}

/** normalisierter Spaltenkopf → Felder, die ihn kennen */
const SYNONYM_INDEX: ReadonlyMap<string, readonly ImportFieldKey[]> = (() => {
  const index = new Map<string, ImportFieldKey[]>();
  for (const field of IMPORT_FIELDS) {
    for (const name of [field.label, ...field.synonyms]) {
      const key = normalizeHeader(name);
      const list = index.get(key) ?? [];
      if (!list.includes(field.key)) list.push(field.key);
      index.set(key, list);
    }
  }
  return index;
})();

/**
 * Schlägt eine Zuordnung vor. Rät nie: Passt ein Spaltenkopf zu mehreren Feldern oder ein Feld
 * zu mehreren Spalten, bleibt das Feld unzugeordnet und der Nutzer wählt selbst.
 */
export function suggestMapping(header: readonly string[]): ColumnMapping {
  const candidates = new Map<ImportFieldKey, number[]>();
  header.forEach((name, column) => {
    const fields = SYNONYM_INDEX.get(normalizeHeader(name));
    if (fields?.length !== 1) return;
    const field = fields[0] as ImportFieldKey;
    candidates.set(field, [...(candidates.get(field) ?? []), column]);
  });
  const mapping: ColumnMapping = {};
  for (const [field, columns] of candidates) {
    const [only] = columns;
    if (only !== undefined && columns.length === 1) mapping[field] = only;
  }
  return mapping;
}

/**
 * Beispielwerte der Vorlage. Bewusst fiktiv: IP aus dem Dokumentationsnetz 192.0.2.0/24
 * (RFC 5737), Modell-ID leer (kein erfundenes Herstellermodell), Gruppe mit Standardnamen.
 */
const TEMPLATE_EXAMPLE: Record<ImportFieldKey, string> = {
  label: 'LP01',
  group: 'UV-1 › Gruppe 1',
  libraryModelId: '',
  ip: '192.0.2.21',
  port: '502',
  unitId: '1',
  minA: '6',
  maxA: '16',
  fuseA: '32',
  phases: '3',
  phaseRotation: 'L1-L2-L3',
  phaseSwitching: 'nein',
  protocol: 'modbus-tcp',
  room: 'Beispiel',
  category: '',
  notes: 'Beispielzeile – vor dem Import ersetzen oder löschen',
};

/**
 * Vorlage zum Herunterladen: UTF-8 mit BOM (damit Excel Umlaute richtig liest), Semikolon,
 * Kopfzeile mit allen Feldern und eine fiktive Beispielzeile.
 */
export function csvTemplate(): string {
  const header = IMPORT_FIELDS.map(fieldHeader);
  const example = IMPORT_FIELDS.map((f) => TEMPLATE_EXAMPLE[f.key]);
  return `\uFEFF${serializeCsv([header, example], ';')}\r\n`;
}
