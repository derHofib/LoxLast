import { describe, expect, it } from 'vitest';
import { makeSampleProject } from '../__tests__/fixtures';
import { DEFAULT_NAMING_SCHEME, NAMING_SCHEME_V1 } from '../model/naming';
import {
  MIGRATIONS,
  ProjectMigrationError,
  formatPath,
  loadProject,
  migrateDocument,
  type Migration,
} from './migrate';

describe('migrateDocument', () => {
  const v1 = { schemaVersion: 1, name: 'Alt', ampere: 16 };
  const fake: Record<number, Migration> = {
    1: (doc) => ({ ...doc, title: doc['name'], name: undefined }),
    2: (doc) => ({ ...doc, currentA: doc['ampere'] }),
  };

  it('wendet Migrationen der Reihe nach an und setzt die Version', () => {
    const { doc, fromVersion } = migrateDocument(v1, { migrations: fake, targetVersion: 3 });
    expect(fromVersion).toBe(1);
    expect(doc).toEqual({
      schemaVersion: 3,
      title: 'Alt',
      name: undefined,
      ampere: 16,
      currentA: 16,
    });
  });

  it('verändert das Eingabedokument nicht', () => {
    const input = { ...v1 };
    migrateDocument(input, { migrations: fake, targetVersion: 3 });
    expect(input).toEqual(v1);
  });

  it('startet mitten in der Kette', () =>
    expect(
      migrateDocument({ schemaVersion: 2, ampere: 10 }, { migrations: fake, targetVersion: 3 }).doc,
    ).toEqual({
      schemaVersion: 3,
      ampere: 10,
      currentA: 10,
    }));

  it('aktuelle Version bleibt unverändert', () =>
    expect(migrateDocument(v1, { migrations: fake, targetVersion: 1 }).doc).toBe(v1));

  it.each([
    [null, 'Datei enthält kein LastPlan-Projekt (JSON-Objekt erwartet)'],
    [[1, 2], 'Datei enthält kein LastPlan-Projekt (JSON-Objekt erwartet)'],
    [{ name: 'x' }, 'Projektformat-Version fehlt oder ist ungültig (Feld „schemaVersion“)'],
    [{ schemaVersion: 0 }, 'Projektformat-Version fehlt oder ist ungültig (Feld „schemaVersion“)'],
    [
      { schemaVersion: '1' },
      'Projektformat-Version fehlt oder ist ungültig (Feld „schemaVersion“)',
    ],
    [
      { schemaVersion: 1.5 },
      'Projektformat-Version fehlt oder ist ungültig (Feld „schemaVersion“)',
    ],
    [
      { schemaVersion: 9 },
      'Projekt wurde mit einer neueren LastPlan-Version gespeichert (Format 9, unterstützt bis 3). Bitte LastPlan aktualisieren.',
    ],
  ])('lehnt %o ab', (raw, message) => {
    expect(() => migrateDocument(raw, { migrations: fake, targetVersion: 3 })).toThrow(
      new ProjectMigrationError(message),
    );
  });

  it('meldet Lücken in der Migrationskette', () =>
    expect(() =>
      migrateDocument(v1, { migrations: { 1: fake[1] as Migration }, targetVersion: 3 }),
    ).toThrow('Keine Migration von Format 2 auf 3 vorhanden'));

  it('jede registrierte Migration hat einen lückenlosen Vorgänger ab Version 1', () => {
    const versions = Object.keys(MIGRATIONS)
      .map(Number)
      .sort((a, b) => a - b);
    expect(versions).toEqual(versions.map((_, i) => i + 1));
  });
});

describe('loadProject', () => {
  it('lädt ein aktuelles Projekt ohne Migration', () => {
    const project = makeSampleProject();
    expect(loadProject(JSON.parse(JSON.stringify(project)))).toEqual({
      ok: true,
      project,
      migratedFrom: null,
    });
  });

  it('1 → 2: altes Standard-Benennungsschema wird ersetzt, eigene Vorlagen bleiben', () => {
    const raw = JSON.parse(JSON.stringify(makeSampleProject())) as Record<string, unknown>;
    raw['schemaVersion'] = 1;
    (raw['settings'] as Record<string, unknown>)['namingScheme'] = {
      ...NAMING_SCHEME_V1,
      modbusDevice: 'Modbus {label}',
    };
    const r = loadProject(raw);
    expect(r.ok && r.migratedFrom).toBe(1);
    expect(r.ok && r.project.settings.namingScheme).toEqual({
      ...DEFAULT_NAMING_SCHEME,
      modbusDevice: 'Modbus {label}',
    });
    expect(MIGRATIONS[1]!({ schemaVersion: 1 })).toEqual({ schemaVersion: 1 });
    expect(MIGRATIONS[1]!({ settings: {} })).toEqual({ settings: {} });
  });

  it('meldet Migrationsfehler als Text', () =>
    expect(loadProject({ schemaVersion: 99 })).toEqual({
      ok: false,
      errors: [
        'Projekt wurde mit einer neueren LastPlan-Version gespeichert (Format 99, unterstützt bis 2). Bitte LastPlan aktualisieren.',
      ],
    }));

  it('meldet Formfehler mit Pfad, auch für Zod-Standardfehler auf Deutsch', () => {
    const project = makeSampleProject();
    const raw = JSON.parse(JSON.stringify(project));
    raw.chargePoints[1].network.ip = '192.168.10.300';
    delete raw.site.gridConnectionLabel;
    const result = loadProject(raw);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toHaveLength(2);
    expect(result.errors).toContain(
      'chargePoints[1].network.ip: Ungültige IPv4-Adresse (Beispiel: 192.168.1.20)',
    );
    const missing = result.errors.find((e) => e.startsWith('site.gridConnectionLabel: '));
    expect(missing).toBeDefined();
    expect(missing).not.toMatch(/Invalid input/);
  });

  it('lässt fachliche Widersprüche durch (erscheinen später in der Prüfung)', () => {
    const project = makeSampleProject();
    Object.assign(project.chargePoints[0] ?? {}, { minA: 20, maxA: 16 });
    expect(loadProject(project).ok).toBe(true);
  });

  it('wirft unerwartete Fehler weiter', () => {
    const evil = new Proxy(
      {},
      {
        get: () => {
          throw new TypeError('kaputt');
        },
      },
    );
    expect(() => loadProject(evil)).toThrow(TypeError);
  });
});

describe('formatPath', () => {
  it('formatiert Objekt- und Array-Pfade', () => {
    expect(formatPath(['chargePoints', 2, 'network', 'ip'])).toBe('chargePoints[2].network.ip');
    expect(formatPath([0, 'x'])).toBe('[0].x');
    expect(formatPath([])).toBe('');
  });
});
