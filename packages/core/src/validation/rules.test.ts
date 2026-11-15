import { describe, expect, it } from 'vitest';
import {
  makeChargePoint,
  makeCluster,
  makeGroup,
  makeSampleProject,
  TEST_MODEL,
} from '../__tests__/fixtures';
import { analyzeProject } from '../calc/analysis';
import type { Project } from '../model';
import { catalogFromModels, EMPTY_CATALOG } from './run';
import { dupIpRule } from './rules/dup-ip';
import { emptyGroupRule, meterMissingRule } from './rules/hints';
import { minSumRule } from './rules/min-sum';
import { modelIncompleteRule, phaseSwitchRule } from './rules/model-rules';
import { phaseOverloadRule } from './rules/phase-overload';
import { cpMinMaxRule, cpNoGroupRule, structureRule } from './rules/structure';
import { unbalanceRule } from './rules/unbalance';
import type { ModelCatalog, Rule } from './types';

const catalog = catalogFromModels([TEST_MODEL]);
const run = (rule: Rule, project: Project, cat: ModelCatalog = catalog) =>
  rule.check({ project, analysis: analyzeProject(project), catalog: cat });
const messages = (rule: Rule, project: Project, cat?: ModelCatalog) =>
  run(rule, project, cat).map((f) => f.message);
const A = (n: string) => `${n}\u00a0A`;

/** Beispielanlage mit Netzzähler und ausgeglichener Phasenlage → keine Meldungen. */
function cleanProject(): Project {
  const p = makeSampleProject();
  Object.assign(p.chargePoints[2] ?? {}, { phaseRotation: 'L3-L1-L2' });
  p.site.gridMeter = {
    vendor: 'Test',
    model: 'Zähler',
    protocol: 'modbus-tcp',
    network: { ip: '192.168.10.5', port: 502, unitId: 1 },
  };
  return p;
}

const ALL: Rule[] = [
  minSumRule,
  phaseOverloadRule,
  unbalanceRule,
  dupIpRule,
  cpNoGroupRule,
  cpMinMaxRule,
  modelIncompleteRule,
  phaseSwitchRule,
  emptyGroupRule,
  meterMissingRule,
  structureRule,
];

describe('saubere Anlage', () => {
  it.each(ALL.map((r) => [r.id, r] as const))('%s meldet nichts', (_, rule) =>
    expect(run(rule, cleanProject())).toEqual([]),
  );
});

describe('MIN_SUM', () => {
  it('Cluster: Mindeststrom-Summe über Limit, mit Phase bei unsymmetrischer Last', () => {
    const p = cleanProject();
    Object.assign(p.clusters[0] ?? {}, { limitA: 15 });
    // L1: LP01 6 + LP02 6 = 12, L3: 6 + 6 + LP03 6 = 18 → L3 schlimmste Phase
    expect(messages(minSumRule, p)).toEqual([
      `UV-TG1 · Ebene −1 L3: Mindeststrom-Summe ${A('18')} über Limit ${A('15')}`,
    ]);
  });

  it('symmetrische Last ohne Phasenangabe; Beispiel aus Kap. 5', () => {
    const p = makeSampleProject();
    const cluster = makeCluster({ name: 'UV-TG2', limitA: 63 });
    const group = makeGroup(cluster.id, { name: 'Gäste' });
    p.clusters.push(cluster);
    p.groups.push(group);
    for (let i = 0; i < 6; i++) {
      p.chargePoints.push(
        makeChargePoint(group.id, {
          label: `LP2${i}`,
          minA: 12,
          network: { ip: `192.168.20.${i + 1}`, port: 502 },
        }),
      );
    }
    const findings = run(minSumRule, p);
    expect(findings.map((f) => f.message)).toEqual([
      `UV-TG2: Mindeststrom-Summe ${A('72')} über Limit ${A('63')}`,
    ]);
    expect(findings[0]).toMatchObject({
      severity: 'error',
      blocksExport: true,
      targetIds: [cluster.id],
    });
  });

  it('Gruppen ohne eigenes Limit werden nicht doppelt gemeldet', () => {
    const p = cleanProject();
    p.site.buildingReserveA = 240; // Standort 10 A
    // Mieter (ohne eigenes Limit) erscheint nicht; Flotte (63 A) passt mit 6 A in die verfügbaren 10 A.
    expect(messages(minSumRule, p)).toEqual([
      `Standort L3: Mindeststrom-Summe ${A('18')} über Limit ${A('10')}`,
      `UV-TG1 · Ebene −1 L3: Mindeststrom-Summe ${A('18')} über Limit ${A('10')}`,
    ]);
  });
});

describe('PHASE_OVERLOAD (Hinweis)', () => {
  it('meldet Worst Case über Limit als Hinweis, ohne Exportsperre', () => {
    const p = cleanProject();
    Object.assign(p.clusters[0] ?? {}, { limitA: 40 });
    const findings = run(phaseOverloadRule, p);
    expect(findings).toEqual([
      expect.objectContaining({
        message: `UV-TG1 · Ebene −1 L3: ${A('48')} über ${A('40')} – Lastmanagement drosselt im Volllastfall`,
        severity: 'warning',
        blocksExport: false,
      }),
    ]);
  });

  it('mehrere Phasen', () => {
    const p = cleanProject();
    Object.assign(p.clusters[0] ?? {}, { limitA: 20 });
    expect(messages(phaseOverloadRule, p)).toEqual([
      `UV-TG1 · Ebene −1 L1/L2/L3: bis ${A('48')} über ${A('20')} – Lastmanagement drosselt im Volllastfall`,
    ]);
  });
});

describe('UNBALANCE', () => {
  it('Beispielanlage: Vorschlag mit einem Ladepunkt', () => {
    const p = makeSampleProject();
    const [f] = run(unbalanceRule, p);
    expect(f?.message).toMatch(
      new RegExp(`^Schieflast ${A('32')} über ${A('20')} – LP0[13] auf L3-L1-L2 drehen\\?$`),
    );
    expect(f?.severity).toBe('warning');
    expect(f?.fix?.label).toBe(`Phasenlage ändern (Schieflast danach ${A('0')})`);
    expect(f?.fix?.changes).toHaveLength(1);
  });

  it('mehrere Änderungen', () => {
    const p = makeSampleProject();
    for (const cp of p.chargePoints) cp.phaseRotation = 'L1-L2-L3';
    const [f] = run(unbalanceRule, p);
    expect(f?.message).toBe(
      `Schieflast ${A('48')} über ${A('20')} – Phasenlage von 2 Ladepunkten ändern?`,
    );
    expect(f?.fix?.label).toBe(`Phasenlage von 2 Ladepunkten ändern (Schieflast danach ${A('0')})`);
  });

  it('nicht weiter zu verringern', () => {
    const p = makeSampleProject();
    p.chargePoints = [makeChargePoint(p.groups[0]?.id ?? '', { maxA: 32, fuseA: 32 })];
    expect(messages(unbalanceRule, p)).toEqual([
      `Schieflast ${A('32')} über ${A('20')} – mit anderer Phasenlage nicht weiter zu verringern`,
    ]);
  });

  it('Grenze aus den Projekteinstellungen', () => {
    const p = makeSampleProject();
    p.settings.maxUnbalanceA = 32;
    expect(run(unbalanceRule, p)).toEqual([]);
  });
});

describe('DUP_IP', () => {
  it('gleiche IP, Port und Unit-ID bei Ladepunkten und Zähler', () => {
    const p = cleanProject();
    Object.assign(p.chargePoints[1] ?? {}, {
      network: { ip: '192.168.10.21', port: 502, unitId: 1 },
    });
    p.site.pv = {
      meter: {
        vendor: 'T',
        model: 'PV',
        protocol: 'modbus-tcp',
        network: { ip: '192.168.10.5', port: 502, unitId: 1 },
      },
    };
    expect(messages(dupIpRule, p)).toEqual([
      'Adresse 192.168.10.21:502 (Unit-ID 1) mehrfach vergeben: LP01, LP02',
      'Adresse 192.168.10.5:502 (Unit-ID 1) mehrfach vergeben: Netzzähler, PV-Zähler',
    ]);
  });

  it('andere Unit-ID ist erlaubt, fehlende Unit-ID gilt als eigener Wert', () => {
    const p = cleanProject();
    Object.assign(p.chargePoints[1] ?? {}, {
      network: { ip: '192.168.10.21', port: 502, unitId: 2 },
    });
    expect(run(dupIpRule, p)).toEqual([]);
    Object.assign(p.chargePoints[1] ?? {}, { network: { ip: '192.168.10.21', port: 502 } });
    Object.assign(p.chargePoints[0] ?? {}, { network: { ip: '192.168.10.21', port: 502 } });
    expect(messages(dupIpRule, p)).toEqual([
      'Adresse 192.168.10.21:502 mehrfach vergeben: LP01, LP02',
    ]);
  });
});

describe('Invarianten als Regeln', () => {
  it('CP_NO_GROUP', () => {
    const p = cleanProject();
    Object.assign(p.chargePoints[0] ?? {}, { groupId: '0196a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b' });
    expect(messages(cpNoGroupRule, p)).toEqual(['LP01 ist keiner vorhandenen Gruppe zugeordnet']);
    expect(run(structureRule, p)).toEqual([]);
  });

  it('CP_MIN_MAX: Invariante und Modellgrenzen', () => {
    const p = cleanProject();
    Object.assign(p.chargePoints[0] ?? {}, { minA: 4 });
    Object.assign(p.chargePoints[1] ?? {}, { maxA: 40, fuseA: 50 });
    expect(messages(cpMinMaxRule, p)).toEqual([
      `LP01: Mindeststrom ${A('4')} unter ${A('6')} (IEC 61851)`,
      `LP01 (Testwallbox): Mindeststrom ${A('4')} unter Modell-Minimum ${A('6')}`,
      `LP02 (Testwallbox): Maximalstrom ${A('40')} über Modell-Maximum ${A('32')}`,
    ]);
  });

  it('CP_MIN_MAX: unbekannte Modellgrenzen (null) werden nicht geprüft', () => {
    const p = cleanProject();
    Object.assign(p.chargePoints[1] ?? {}, { maxA: 40, fuseA: 50 });
    const unknown = catalogFromModels([
      {
        ...TEST_MODEL,
        complete: false,
        missingFields: ['electrical.maxA'],
        electrical: { minA: null, maxA: null, phases: null, phaseSwitching: null },
      },
    ]);
    expect(run(cpMinMaxRule, p, unknown)).toEqual([]);
    Object.assign(p.chargePoints[0] ?? {}, { phaseSwitching: true });
    expect(run(phaseSwitchRule, p, unknown)).toEqual([]);
  });

  it('STRUCTURE', () => {
    const p = cleanProject();
    Object.assign(p.chargePoints[1] ?? {}, { label: 'LP01' });
    expect(messages(structureRule, p)).toEqual(['Ladepunkt-Bezeichnung „LP01“ ist 2-mal vergeben']);
  });
});

describe('Modellregeln', () => {
  it('MODEL_INCOMPLETE: unbekanntes Modell', () => {
    expect(messages(modelIncompleteRule, cleanProject(), EMPTY_CATALOG)).toEqual([
      'Modell „test/wallbox@1“ nicht in der Bibliothek – betrifft LP01, LP02, LP03',
    ]);
  });

  it('MODEL_INCOMPLETE: unvollständiges Modell sperrt den Export', () => {
    const incomplete = catalogFromModels([
      { ...TEST_MODEL, complete: false, missingFields: ['a', 'b', 'c'] },
    ]);
    const [f] = run(modelIncompleteRule, cleanProject(), incomplete);
    expect(f).toMatchObject({
      message:
        'Modell Testwallbox unvollständig (3 Angaben fehlen) – Export gesperrt, betrifft LP01, LP02, LP03',
      blocksExport: true,
    });
    const one = catalogFromModels([{ ...TEST_MODEL, complete: false, missingFields: ['a'] }]);
    expect(messages(modelIncompleteRule, cleanProject(), one)[0]).toContain('(1 Angabe fehlt)');
  });

  it('PHASE_SWITCH_UNSUPPORTED', () => {
    const p = cleanProject();
    Object.assign(p.chargePoints[0] ?? {}, { phaseSwitching: true });
    expect(messages(phaseSwitchRule, p)).toEqual([
      'LP01: Phasenumschaltung aktiv, Testwallbox unterstützt sie nicht',
    ]);
    const capable = catalogFromModels([
      { ...TEST_MODEL, electrical: { ...TEST_MODEL.electrical, phaseSwitching: true } },
    ]);
    expect(run(phaseSwitchRule, p, capable)).toEqual([]);
    expect(run(phaseSwitchRule, p, EMPTY_CATALOG)).toEqual([]); // fehlendes Modell meldet MODEL_INCOMPLETE
  });
});

describe('Hinweise', () => {
  it('EMPTY_GROUP', () => {
    const p = cleanProject();
    p.groups.push(makeGroup(p.clusters[0]?.id ?? '', { name: 'Gäste' }));
    expect(messages(emptyGroupRule, p)).toEqual([
      'Gruppe UV-TG1 · Ebene −1 › Gäste hat keine Ladepunkte',
    ]);
  });

  it('EMPTY_GROUP bei verwaister Gruppe nutzt den Gruppennamen', () => {
    const p = cleanProject();
    p.groups.push(makeGroup('0196a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b', { name: 'Waise' }));
    expect(messages(emptyGroupRule, p)).toEqual(['Gruppe Waise hat keine Ladepunkte']);
  });

  it('METER_MISSING', () => {
    const p = cleanProject();
    delete p.site.gridMeter;
    expect(messages(meterMissingRule, p)).toEqual([
      `Kein Netzzähler definiert – statisches Lastmanagement mit festem Limit ${A('170')}`,
    ]);
  });
});
