import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { makeCluster, makeGroup, makeSampleProject, TEST_MODEL } from '../__tests__/fixtures';
import { checkProjectInvariants, createProject, type Project } from '../model';
import { catalogFromModels } from '../validation/run';
import type { CatalogModel } from '../validation/types';
import { parseCsv, serializeCsv } from './csv';
import { suggestMapping, type ColumnMapping } from './fields';
import { applyImport, checkMapping, validateImport } from './validate';

const INCOMPLETE_MODEL: CatalogModel = {
  id: 'test/unvollstaendig@1',
  displayName: 'Testmodell unvollständig',
  complete: false,
  missingFields: ['a', 'b'],
  electrical: { minA: null, maxA: null, phases: null, phaseSwitching: null },
};
const SINGLE_PHASE_MODEL: CatalogModel = {
  id: 'test/einphasig@1',
  displayName: 'Testmodell 1-phasig',
  complete: false,
  missingFields: ['a'],
  electrical: { minA: 8, maxA: 20, phases: [1], phaseSwitching: false },
};
const catalog = catalogFromModels([TEST_MODEL, INCOMPLETE_MODEL, SINGLE_PHASE_MODEL]);

const HEADER = 'Bezeichnung;Gruppe;Modell-ID;IP-Adresse;Port;Unit-ID;Min. Strom (A);Max. Strom (A)';

function run(lines: string[], project: Project = makeSampleProject(), mapping?: ColumnMapping) {
  const csv = parseCsv([HEADER, ...lines].join('\r\n'));
  return validateImport(project, csv, mapping ?? suggestMapping(csv.header), catalog);
}

const messages = (r: ReturnType<typeof run>, i = 0) => r.rows[i]?.issues.map((x) => x.message);

describe('checkMapping', () => {
  it('meldet fehlende Pflichtfelder, ungültige Spalten und Doppelbelegung', () => {
    const header = ['A', 'B'];
    expect(checkMapping(header, { label: 0, group: 0, ip: 5 }).map((i) => i.message)).toEqual([
      'IP-Adresse: Spalte 6 gibt es in der Datei nicht',
      'Spalte ‚A‘ ist mehreren Feldern zugeordnet (Bezeichnung, Gruppe). Jede Spalte darf nur einem Feld zugeordnet sein.',
    ]);
    expect(checkMapping(header, { label: 0 }).map((i) => i.message)).toEqual([
      'Pflichtfeld Gruppe ist keiner Spalte zugeordnet',
      'Pflichtfeld IP-Adresse ist keiner Spalte zugeordnet',
    ]);
    expect(checkMapping(['', 'x', 'y'], { label: 0, group: 1, ip: 2, notes: 0 })[0]?.message).toBe(
      'Spalte ‚Spalte 1‘ ist mehreren Feldern zugeordnet (Bezeichnung, Notizen). Jede Spalte darf nur einem Feld zugeordnet sein.',
    );
  });

  it('validateImport prüft bei Zuordnungsfehlern keine Zeilen', () => {
    const r = run(['LP10;Mieter;;192.168.10.30'], makeSampleProject(), { label: 0 });
    expect(r.mappingIssues).toHaveLength(2);
    expect(r.rows).toEqual([]);
    expect(r.validRows).toEqual([]);
  });
});

describe('validateImport', () => {
  it('übernimmt eine gültige Zeile mit deutschen Zahlen und Einheiten', () => {
    const r = run(['LP10;Mieter;test/wallbox@1;192.168.10.30;503;2;6,0;16 A']);
    expect(r.counts).toEqual({ ok: 1, warning: 0, error: 0, empty: 0 });
    expect(r.rows[0]).toMatchObject({
      line: 2,
      status: 'ok',
      issues: [],
      groupPath: 'UV-TG1 · Ebene −1 › Mieter',
    });
    expect(r.validRows[0]?.chargePoint).toMatchObject({
      label: 'LP10',
      libraryModelId: 'test/wallbox@1',
      network: { ip: '192.168.10.30', port: 503, unitId: 2 },
      minA: 6,
      maxA: 16,
    });
  });

  it('meldet ungültige IP mit Zeile und Spalte (Beispiel aus der Spezifikation)', () => {
    const r = run(['LP10;Mieter;test/wallbox@1;192.168.10.30', 'LP11;Mieter;;192.168.1.300']);
    expect(r.rows[1]?.status).toBe('error');
    expect(messages(r, 1)).toContain(
      'Zeile 3, Spalte ‚IP-Adresse‘: 192.168.1.300 ist keine gültige IPv4-Adresse',
    );
  });

  it('ergänzt fehlende Werte wie addChargePoint und weist darauf hin', () => {
    const p = makeSampleProject();
    const template = p.chargePoints.at(-1)!;
    const r = run(['LP10;Flotte;;192.168.10.30;;;;'], p);
    expect(r.rows[0]?.status).toBe('warning');
    expect(messages(r)).toEqual([
      'Zeile 2, Spalte ‚Modell-ID‘: Modell-ID leer – übernommen vom vorherigen Ladepunkt: test/wallbox@1',
    ]);
    expect(r.validRows[0]?.chargePoint).toEqual({
      label: 'LP10',
      groupId: p.groups[1]!.id,
      libraryModelId: template.libraryModelId,
      network: { ...template.network, ip: '192.168.10.30' },
      protocol: template.protocol,
      fuseA: template.fuseA,
      minA: template.minA,
      maxA: template.maxA,
      phases: template.phases,
      phaseRotation: 'L1-L2-L3',
      phaseSwitching: false,
    });
  });

  it('Standardwerte folgen der vorherigen gültigen Zeile der Datei', () => {
    const r = run([
      'LP10;Mieter;test/einphasig@1;192.168.10.30;;;8;20',
      'LP11;Mieter;;192.168.10.31;;;x;',
      'LP12;Mieter;;192.168.10.32;;;;',
    ]);
    expect(r.rows.map((x) => x.status)).toEqual(['warning', 'error', 'warning']);
    expect(r.validRows[1]?.chargePoint).toMatchObject({
      libraryModelId: 'test/einphasig@1',
      minA: 8,
      maxA: 20,
    });
  });

  it('ohne bestehenden Ladepunkt ist die Modell-ID nötig', () => {
    const p = makeSampleProject();
    p.chargePoints = [];
    const r = run(['LP10;Mieter;;192.168.10.30'], p);
    expect(messages(r)).toEqual([
      'Zeile 2, Spalte ‚Modell-ID‘: Modell-ID fehlt. Es gibt keinen vorherigen Ladepunkt, von dem sie übernommen werden kann.',
    ]);
  });

  it('Modell-ID: Form, unbekannt (Fehler), unvollständig (Hinweis)', () => {
    const r = run([
      'LP10;Mieter;ABL eM4;192.168.10.30',
      'LP11;Mieter;foo/bar@1;192.168.10.31',
      'LP12;Mieter;test/unvollstaendig@1;192.168.10.32',
    ]);
    expect(r.rows.map((x) => x.status)).toEqual(['error', 'error', 'warning']);
    expect(messages(r, 0)).toEqual([
      'Zeile 2, Spalte ‚Modell-ID‘: „ABL eM4“ ist keine Modell-ID (Form: hersteller/modell@version)',
    ]);
    expect(messages(r, 1)).toEqual([
      'Zeile 3, Spalte ‚Modell-ID‘: Modell-ID „foo/bar@1“ ist in der Wallbox-Bibliothek nicht bekannt',
    ]);
    expect(messages(r, 2)).toEqual([
      'Zeile 4, Spalte ‚Modell-ID‘: Modell Testmodell unvollständig ist in der Bibliothek unvollständig (2 Angaben fehlen) – Import möglich, Export erst nach Ergänzung',
    ]);
  });

  it('prüft Grenzen des Modells (Strom, Phasen, Umschaltung)', () => {
    const header = `${HEADER};Phasen;Phasenumschaltung`;
    const csv = parseCsv(
      [header, 'LP10;Mieter;test/einphasig@1;192.168.10.30;;;6;32;3;ja'].join('\n'),
    );
    const r = validateImport(makeSampleProject(), csv, suggestMapping(csv.header), catalog);
    expect(r.rows[0]?.issues.map((i) => i.message)).toEqual([
      'Zeile 2, Spalte ‚Modell-ID‘: Modell Testmodell 1-phasig ist in der Bibliothek unvollständig (1 Angabe fehlt) – Import möglich, Export erst nach Ergänzung',
      'Zeile 2, Spalte ‚Max. Strom (A)‘: Max. Strom 32\u00a0A über dem Höchststrom von Testmodell 1-phasig (20\u00a0A)',
      'Zeile 2, Spalte ‚Min. Strom (A)‘: Min. Strom 6\u00a0A unter dem Mindeststrom von Testmodell 1-phasig (8\u00a0A)',
      'Zeile 2, Spalte ‚Phasen‘: Testmodell 1-phasig unterstützt keinen 3-phasigen Anschluss',
      'Zeile 2, Spalte ‚Phasenumschaltung‘: Phasenumschaltung aktiv, Testmodell 1-phasig unterstützt sie nicht',
    ]);
  });

  it('prüft Pflichtfelder, Zahlenbereiche und Min ≤ Max ≤ Absicherung', () => {
    const header = `${HEADER};Absicherung (A)`;
    const csv = parseCsv(
      [
        header,
        ';;;;;;6',
        'LP10;Mieter;;192.168.10.30;70000;248;-1;abc;0',
        'LP11;Mieter;;192.168.10.31;;;20;16;',
        'LP12;Mieter;;192.168.10.32;;;5;40;32',
        'LP13;Mieter;;192.168.10.33;;;;;10000',
        'LP14;Mieter;;192.168.10.34;;;;40;',
      ].join('\n'),
    );
    const r = validateImport(makeSampleProject(), csv, suggestMapping(csv.header), catalog);
    const errors = (i: number) =>
      r.rows[i]?.issues.filter((x) => x.severity === 'error').map((x) => x.message);
    expect(errors(0)).toEqual([
      'Zeile 2, Spalte ‚Bezeichnung‘: Pflichtfeld Bezeichnung ist leer',
      'Zeile 2, Spalte ‚Gruppe‘: Pflichtfeld Gruppe ist leer',
      'Zeile 2, Spalte ‚IP-Adresse‘: Pflichtfeld IP-Adresse ist leer',
    ]);
    expect(errors(1)).toEqual([
      'Zeile 3, Spalte ‚Port‘: „70000“ ist kein gültiger Port (ganze Zahl 1–65535)',
      'Zeile 3, Spalte ‚Unit-ID‘: „248“ ist keine gültige Unit-ID (ganze Zahl 0–247)',
      'Zeile 3, Spalte ‚Min. Strom (A)‘: -1 liegt außerhalb des zulässigen Bereichs (0 bis 6.300\u00a0A)',
      'Zeile 3, Spalte ‚Max. Strom (A)‘: „abc“ ist keine Zahl (Beispiel: 16 oder 16,5 A)',
      'Zeile 3, Spalte ‚Absicherung (A)‘: 0 liegt außerhalb des zulässigen Bereichs (größer 0 bis 6.300\u00a0A)',
    ]);
    expect(errors(2)).toEqual([
      'Zeile 4, Spalte ‚Min. Strom (A)‘: Min. Strom 20\u00a0A ist größer als Max. Strom 16\u00a0A',
    ]);
    expect(errors(3)).toEqual([
      'Zeile 5, Spalte ‚Min. Strom (A)‘: Min. Strom 5\u00a0A liegt unter 6\u00a0A (IEC 61851)',
      'Zeile 5, Spalte ‚Max. Strom (A)‘: Max. Strom 40\u00a0A ist größer als die Absicherung 32\u00a0A',
      'Zeile 5, Spalte ‚Max. Strom (A)‘: Max. Strom 40\u00a0A über dem Höchststrom von Testwallbox (32\u00a0A)',
    ]);
    expect(errors(4)).toEqual([
      'Zeile 6, Spalte ‚Absicherung (A)‘: 10000 liegt außerhalb des zulässigen Bereichs (größer 0 bis 6.300\u00a0A)',
    ]);
    expect(errors(5)).toEqual([
      'Zeile 7, Spalte ‚Max. Strom (A)‘: Max. Strom 40\u00a0A ist größer als die Absicherung 32\u00a0A (Standardwert, in der Datei leer)',
      'Zeile 7, Spalte ‚Max. Strom (A)‘: Max. Strom 40\u00a0A über dem Höchststrom von Testwallbox (32\u00a0A)',
    ]);
  });

  it('meldet Werte aus Standardwerten ohne Spalte nur mit Zeile', () => {
    const p = makeSampleProject();
    p.chargePoints.at(-1)!.minA = 4;
    const csv = parseCsv('Bezeichnung;Gruppe;IP\nLP10;Mieter;192.168.10.30');
    const r = validateImport(p, csv, suggestMapping(csv.header), catalog);
    expect(r.rows[0]?.issues.map((x) => x.message)).toContain(
      'Zeile 2: Min. Strom 4\u00a0A (Standardwert, in der Datei leer) liegt unter 6\u00a0A (IEC 61851)',
    );
    p.chargePoints.at(-1)!.minA = 20;
    const r2 = validateImport(p, csv, suggestMapping(csv.header), catalog);
    expect(r2.rows[0]?.issues.map((x) => x.message)).toContain(
      'Zeile 2: Min. Strom 20\u00a0A (Standardwert, in der Datei leer) ist größer als Max. Strom 16\u00a0A (Standardwert, in der Datei leer)',
    );
  });

  it('übrige Felder: Phasenlage, Protokoll, Texte', () => {
    const header =
      'Bezeichnung;Gruppe;IP;Phasenlage;Protokoll;Raum;Kategorie;Notizen;Phasen;Phasenumschaltung';
    const long = 'x'.repeat(201);
    const csv = parseCsv(
      [
        header,
        `LP10;Mieter;192.168.10.30;L1-L3-L2;smtp;${long};;;2;vielleicht`,
        `LP11;Mieter;192.168.10.31;L2 L3 L1;Modbus TCP;TG;Mieter;"Zeile 1\nZeile 2";1;nein`,
        `${long};Mieter;192.168.10.32`,
      ].join('\n'),
    );
    const r = validateImport(makeSampleProject(), csv, suggestMapping(csv.header), catalog);
    expect(r.rows[0]?.issues.map((x) => x.message)).toEqual([
      'Zeile 2, Spalte ‚Phasen‘: „2“: Anschluss muss 1 oder 3 Phasen haben',
      'Zeile 2, Spalte ‚Phasenlage‘: „L1-L3-L2“ ist keine gültige Phasenlage (erlaubt: L1-L2-L3, L2-L3-L1, L3-L1-L2)',
      'Zeile 2, Spalte ‚Phasenumschaltung‘: „vielleicht“ ist kein Ja/Nein-Wert (erlaubt: ja, nein)',
      'Zeile 2, Spalte ‚Protokoll‘: „smtp“ ist kein bekanntes Protokoll (erlaubt: modbus-tcp, http, ocpp-bridge)',
      'Zeile 2, Spalte ‚Raum‘: Text ist zu lang (max. 200 Zeichen)',
    ]);
    expect(r.validRows[0]?.chargePoint).toMatchObject({
      phaseRotation: 'L2-L3-L1',
      protocol: 'modbus-tcp',
      room: 'TG',
      category: 'Mieter',
      notes: 'Zeile 1\nZeile 2',
      phases: 1,
      phaseSwitching: false,
    });
    expect(r.rows[2]?.issues.map((x) => x.message)).toEqual([
      'Zeile 4, Spalte ‚Bezeichnung‘: Bezeichnung ist zu lang (max. 200 Zeichen)',
    ]);
  });

  it('doppelte IPs und Bezeichnungen: in der Datei (alle Zeilen) und gegen das Projekt', () => {
    const p = makeSampleProject();
    p.site.gridMeter = {
      vendor: 'Test',
      model: 'Zähler',
      protocol: 'modbus-tcp',
      network: { ip: '192.168.10.2', port: 502 },
    };
    const r = run(
      [
        'LP10;Mieter;;192.168.10.30',
        'lp10;Mieter;;192.168.10.31',
        'LP12;Mieter;;192.168.10.30',
        'LP01;Mieter;;192.168.10.21',
        'LP14;Mieter;;192.168.10.2',
      ],
      p,
    );
    expect(r.counts.error).toBe(5);
    expect(messages(r, 0)).toEqual([
      'Zeile 2, Spalte ‚Bezeichnung‘: Bezeichnung „LP10“ kommt in der Datei mehrfach vor (Zeilen 2, 3)',
      'Zeile 2, Spalte ‚IP-Adresse‘: 192.168.10.30 kommt in der Datei mehrfach vor (Zeilen 2, 4)',
    ]);
    expect(messages(r, 3)).toEqual([
      'Zeile 5, Spalte ‚Bezeichnung‘: Bezeichnung „LP01“ ist im Projekt bereits vergeben',
      'Zeile 5, Spalte ‚IP-Adresse‘: 192.168.10.21 ist im Projekt bereits vergeben (LP01)',
    ]);
    expect(messages(r, 4)).toEqual([
      'Zeile 6, Spalte ‚IP-Adresse‘: 192.168.10.2 ist im Projekt bereits vergeben (Zähler)',
    ]);
  });

  it('Gruppe: Name, „Cluster › Gruppe“, mehrdeutig, unbekannt, keine Gruppen', () => {
    const p = makeSampleProject();
    const root = p.clusters[0]!;
    const sub = makeCluster({ name: 'UV-2', parentClusterId: root.id });
    p.clusters.push(sub);
    p.groups.push(makeGroup(sub.id, { name: 'Mieter' }), makeGroup(sub.id, { name: 'Gäste' }));
    const r = run(
      [
        'LP10;Mieter;;192.168.10.30',
        'LP11;uv-2>mieter;;192.168.10.31',
        'LP12;UV-TG1 · Ebene −1 › UV-2 › Gäste;;192.168.10.32',
        'LP13;Gaeste;;192.168.10.33',
      ],
      p,
    );
    expect(messages(r, 0)).toEqual([
      'Zeile 2, Spalte ‚Gruppe‘: Gruppe „Mieter“ ist nicht eindeutig (UV-TG1 · Ebene −1 › Mieter, UV-TG1 · Ebene −1 › UV-2 › Mieter). Bitte als „Cluster › Gruppe“ angeben.',
    ]);
    expect(r.rows[1]?.groupPath).toBe('UV-TG1 · Ebene −1 › UV-2 › Mieter');
    expect(r.rows[2]?.groupPath).toBe('UV-TG1 · Ebene −1 › UV-2 › Gäste');
    expect(messages(r, 3)?.[0]).toBe(
      'Zeile 5, Spalte ‚Gruppe‘: Gruppe „Gaeste“ gibt es im Projekt nicht (vorhanden: UV-TG1 · Ebene −1 › Mieter, UV-TG1 · Ebene −1 › Flotte, UV-TG1 · Ebene −1 › UV-2 › Mieter, UV-TG1 · Ebene −1 › UV-2 › Gäste). Bitte Namen korrigieren oder die Gruppe zuerst in der Struktur-Ansicht anlegen.',
    );

    for (let i = 0; i < 3; i++) p.groups.push(makeGroup(sub.id, { name: `G${i}` }));
    expect(messages(run(['LP10;X;;192.168.10.30'], p))?.[0]).toMatch(/G0, …\)/);

    const empty = createProject({ name: 'Leer' });
    expect(messages(run(['LP10;Mieter;;192.168.10.30'], empty))).toEqual([
      'Zeile 2, Spalte ‚Gruppe‘: Gruppe „Mieter“ gibt es nicht – das Projekt hat noch keine Gruppen. Bitte zuerst in der Struktur-Ansicht anlegen.',
    ]);
  });

  it('Gruppe ohne vorhandenen Cluster wird nur über den Namen gefunden', () => {
    const p = makeSampleProject();
    p.groups[1]!.clusterId = '0196a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
    expect(run(['LP10;Flotte;;192.168.10.30'], p).rows[0]?.groupPath).toBe('Flotte');
  });

  it('übersteht Cluster-Zyklen beim Gruppenpfad', () => {
    const p = makeSampleProject();
    const a = makeCluster({ name: 'A' });
    const b = makeCluster({ name: 'B', parentClusterId: a.id });
    a.parentClusterId = b.id;
    p.clusters.push(a, b);
    p.groups.push(makeGroup(a.id, { name: 'Zyklus' }));
    expect(run(['LP10;Zyklus;;192.168.10.30'], p).rows[0]?.groupPath).toBe('B › A › Zyklus');
  });

  it('Leerzeilen werden übersprungen und gezählt, Zeilennummern bleiben stimmig', () => {
    const r = run(['', ';;;', 'LP10;Mieter;;192.168.1.300']);
    expect(r.counts).toEqual({ ok: 0, warning: 0, error: 1, empty: 2 });
    expect(r.rows[2]?.line).toBe(4);
  });

  it('kurze Zeilen gelten als leere Werte; Zeilennummer nach „sep=“', () => {
    const csv = parseCsv(`sep=;\n${HEADER}\nLP10;Mieter`);
    const r = validateImport(makeSampleProject(), csv, suggestMapping(csv.header), catalog);
    expect(r.rows[0]?.issues.map((x) => x.message)).toEqual([
      'Zeile 3, Spalte ‚IP-Adresse‘: Pflichtfeld IP-Adresse ist leer',
    ]);
  });

  it('verändert das Projekt nicht', () => {
    const p = makeSampleProject();
    const before = JSON.stringify(p);
    run(['LP10;Mieter;;192.168.10.30', 'LP11;Mieter;;192.168.10.31'], p);
    expect(JSON.stringify(p)).toBe(before);
  });
});

describe('applyImport', () => {
  it('übernimmt genau die Werte der Vorschau mit neuen IDs', () => {
    const p = makeSampleProject();
    const r = run(['LP10;Mieter;;192.168.10.30', 'LP11;Flotte;;192.168.10.31;;;;20'], p);
    const ids = ['0196a1b2-c3d4-7e5f-8a9b-000000000001', '0196a1b2-c3d4-7e5f-8a9b-000000000002'];
    let n = 0;
    const next = structuredClone(p);
    expect(applyImport(next, r.validRows, () => ids[n++]!)).toEqual(ids);
    expect(next.chargePoints.slice(-2)).toEqual(
      r.validRows.map((row, i) => ({ ...row.chargePoint, id: ids[i] })),
    );
    expect(checkProjectInvariants(next)).toEqual([]);
  });

  it('erzeugt ohne idFactory UUIDs', () => {
    const p = makeSampleProject();
    const r = run(['LP10;Mieter;;192.168.10.30'], p);
    const [id] = applyImport(p, r.validRows);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });
});

// ---------------------------------------------------------------------------------------------
// Property-Tests
// ---------------------------------------------------------------------------------------------

/** Zufällige Zeilen mit absichtlich vielen Kollisionen (kleiner IP- und Namensraum). */
const rowArbitrary = fc.record({
  label: fc.constantFrom('LP01', 'LP10', 'LP11', 'lp11', 'LP12', 'LP13', ''),
  group: fc.constantFrom('Mieter', 'Flotte', 'Gäste', ''),
  model: fc.constantFrom('', 'test/wallbox@1', 'test/unvollstaendig@1', 'x/y@1'),
  ip: fc.oneof(
    fc.integer({ min: 18, max: 34 }).map((h) => `192.168.10.${h}`),
    fc.constantFrom('192.168.10.300', ''),
  ),
  minA: fc.constantFrom('', '6', '10', '5', '16,5'),
  maxA: fc.constantFrom('', '16', '32', '8', '40 A'),
});

const toCsv = (rows: fc.RecordValue<typeof rowArbitrary>[]) =>
  parseCsv(
    serializeCsv([
      ['Bezeichnung', 'Gruppe', 'Modell-ID', 'IP', 'Min. Strom', 'Max. Strom'],
      ...rows.map((r) => [r.label, r.group, r.model, r.ip, r.minA, r.maxA]),
    ]),
  );

describe('Property: Validierung und Import', () => {
  it('nimmt nie eine Zeile mit doppelter IP oder Bezeichnung an; Import erzeugt genau so viele LPs; Undo stellt den Ausgangszustand her', () => {
    fc.assert(
      fc.property(fc.array(rowArbitrary, { maxLength: 12 }), (rows) => {
        const project = makeSampleProject();
        const csv = toCsv(rows);
        const result = validateImport(project, csv, suggestMapping(csv.header), catalog);

        const ips = result.validRows.map((r) => r.chargePoint.network.ip);
        const allIps = [...project.chargePoints.map((cp) => cp.network.ip), ...ips];
        expect(new Set(allIps).size).toBe(allIps.length);
        const labels = [
          ...project.chargePoints.map((cp) => cp.label),
          ...result.validRows.map((r) => r.chargePoint.label),
        ].map((l) => l.toLowerCase());
        expect(new Set(labels).size).toBe(labels.length);
        // Jede IP, die in der Datei mehrfach vorkommt, ist in keiner gültigen Zeile
        const counts = new Map<string, number>();
        for (const r of rows) counts.set(r.ip, (counts.get(r.ip) ?? 0) + 1);
        for (const ip of ips) expect(counts.get(ip)).toBe(1);

        const before = structuredClone(project);
        const next = structuredClone(project);
        const ids = applyImport(next, result.validRows);
        expect(next.chargePoints).toHaveLength(
          project.chargePoints.length + result.validRows.length,
        );
        expect(result.validRows.length).toBe(result.counts.ok + result.counts.warning);
        // Importierte Ladepunkte verletzen keine Invariante
        expect(checkProjectInvariants(next)).toEqual([]);
        // Import hängt nur an: ohne die neuen Ladepunkte ist das Projekt unverändert
        // (Undo über Immer-Patches prüft apps/web/src/state/commands.test.ts)
        expect(ids).toHaveLength(result.validRows.length);
        expect({
          ...next,
          chargePoints: next.chargePoints.filter((cp) => !ids.includes(cp.id)),
        }).toEqual(before);
        expect(project).toEqual(before);
      }),
    );
  });
});
