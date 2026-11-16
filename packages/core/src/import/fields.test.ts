import { describe, expect, it } from 'vitest';
import { parseCsv } from './csv';
import {
  IMPORT_FIELDS,
  csvTemplate,
  fieldHeader,
  importField,
  normalizeHeader,
  suggestMapping,
} from './fields';

describe('Felddefinitionen', () => {
  it('Pflichtfelder sind Bezeichnung, Gruppe und IP-Adresse', () => {
    expect(IMPORT_FIELDS.filter((f) => f.required).map((f) => f.key)).toEqual([
      'label',
      'group',
      'ip',
    ]);
  });

  it('kein Synonym gehört zu zwei Feldern', () => {
    const owner = new Map<string, string>();
    for (const f of IMPORT_FIELDS) {
      for (const name of new Set([f.label, ...f.synonyms].map(normalizeHeader))) {
        expect(owner.get(name), `${name} doppelt`).toBeUndefined();
        owner.set(name, f.key);
      }
    }
  });

  it('importField und fieldHeader', () => {
    expect(importField('minA')).toMatchObject({ key: 'minA', label: 'Min. Strom', unit: 'A' });
    expect(fieldHeader(importField('minA'))).toBe('Min. Strom (A)');
    expect(fieldHeader(importField('ip'))).toBe('IP-Adresse');
  });
});

describe('normalizeHeader', () => {
  it.each([
    ['Min. Strom (A)', 'minstrom'],
    ['IP-Adresse', 'ipadresse'],
    ['  Höchststrom [A] ', 'hoechststrom'],
    ['GRÖSSE', 'groesse'],
    ['Straße', 'strasse'],
    ['Phasen\u00adumschaltung', 'phasenumschaltung'],
  ])('%j → %s', (text, key) => expect(normalizeHeader(text)).toBe(key));
});

describe('suggestMapping', () => {
  it('ordnet deutsche und englische Spaltenköpfe zu', () => {
    expect(
      suggestMapping([
        'Ladepunkt',
        'IP',
        'Min. Strom (A)',
        'max current',
        'Group',
        'Modbus Unit ID',
        'PHASENLAGE',
        'Bemerkung',
        'Unbekannt',
      ]),
    ).toEqual({
      label: 0,
      ip: 1,
      minA: 2,
      maxA: 3,
      group: 4,
      unitId: 5,
      phaseRotation: 6,
      notes: 7,
    });
  });

  it('rät nie: zwei Spalten für dasselbe Feld → unzugeordnet', () => {
    expect(suggestMapping(['IP', 'IP-Adresse', 'Bezeichnung'])).toEqual({ label: 2 });
  });

  it('erkennt die eigene Vorlage vollständig', () => {
    const csv = parseCsv(csvTemplate());
    const mapping = suggestMapping(csv.header);
    expect(Object.keys(mapping)).toHaveLength(IMPORT_FIELDS.length);
    IMPORT_FIELDS.forEach((f, i) => expect(mapping[f.key]).toBe(i));
  });
});

describe('csvTemplate', () => {
  it('UTF-8 mit BOM, Semikolon, Kopfzeile + eine fiktive Beispielzeile', () => {
    const text = csvTemplate();
    expect(text.startsWith('\uFEFF')).toBe(true);
    expect(text.endsWith('\r\n')).toBe(true);
    const csv = parseCsv(text);
    expect(csv.delimiter).toBe(';');
    expect(csv.header[0]).toBe('Bezeichnung');
    expect(csv.header).toContain('Min. Strom (A)');
    expect(csv.rows).toHaveLength(1);
    const row = csv.rows[0]!;
    const value = (key: string) => row[IMPORT_FIELDS.findIndex((f) => f.key === key)];
    // Dokumentationsnetz (RFC 5737), kein erfundenes Modell
    expect(value('ip')).toMatch(/^192\.0\.2\./);
    expect(value('libraryModelId')).toBe('');
  });
});
