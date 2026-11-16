import { describe, expect, it } from 'vitest';
import { makeLargeProject } from '../__tests__/arbitraries';
import { makeSampleProject, TEST_MODEL } from '../__tests__/fixtures';
import { applyChanges } from '../calc/changes';
import { RULES, catalogFromModels, runChecks } from './run';
import { SEVERITY_LABEL } from './types';

const catalog = catalogFromModels([TEST_MODEL]);

describe('runChecks', () => {
  it('Beispielanlage: zwei Hinweise, keine Fehler', () => {
    const result = runChecks(makeSampleProject(), catalog);
    expect(result.severity).toBe('warning');
    expect(result.findings.map((f) => f.ruleId)).toEqual(['UNBALANCE', 'METER_MISSING']);
    expect(result.exportBlockers).toEqual([]);
  });

  it('Fehler stehen vor Hinweisen und sperren den Export', () => {
    const p = makeSampleProject();
    Object.assign(p.chargePoints[0] ?? {}, { minA: 4 });
    const result = runChecks(p, catalog);
    expect(result.severity).toBe('error');
    expect(result.findings[0]?.ruleId).toBe('CP_MIN_MAX');
    expect(result.exportBlockers.map((f) => f.ruleId)).toEqual(['CP_MIN_MAX', 'CP_MIN_MAX']);
  });

  it('OK ohne Meldungen; Auto-Fix behebt die Schieflast', () => {
    const p = makeSampleProject();
    p.site.gridMeter = {
      vendor: 'T',
      model: 'Z',
      protocol: 'modbus-tcp',
      network: { ip: '192.168.10.5', port: 502 },
    };
    const fix = runChecks(p, catalog).findings[0]?.fix;
    expect(fix).toBeDefined();
    expect(runChecks(applyChanges(p, fix?.changes ?? []), catalog).severity).toBe('ok');
  });

  it('jede Regel hat eine eindeutige ID', () => {
    expect(new Set(RULES.map((r) => r.id)).size).toBe(RULES.length);
    expect(SEVERITY_LABEL).toEqual({ error: 'Fehler', warning: 'Hinweis', ok: 'OK' });
  });

  it('Performance: 200 Ladepunkte in unter 50 ms (Kap. 5)', () => {
    const project = makeLargeProject(200);
    runChecks(project, catalog); // Aufwärmen (JIT)
    const times: number[] = [];
    for (let i = 0; i < 5; i++) {
      const start = performance.now();
      const result = runChecks(project, catalog);
      times.push(performance.now() - start);
      expect(result.findings.some((f) => f.ruleId === 'UNBALANCE')).toBe(true); // Optimierung läuft mit
    }
    const median = [...times].sort((a, b) => a - b)[2] ?? Infinity;
    expect(median).toBeLessThan(50);
  });
});

describe('CP_DATA_MISSING', () => {
  it('meldet fehlende Angaben als Fehler, fasst gleiche Lücken zusammen und sperrt den Export', () => {
    const p = makeSampleProject();
    const [a, b, c] = p.chargePoints;
    a!.missingFields = ['minA', 'phases'];
    b!.missingFields = ['phases', 'minA'];
    c!.missingFields = ['fuseA'];
    const result = runChecks(p, catalogFromModels([TEST_MODEL]));
    const missing = result.findings.filter((f) => f.ruleId === 'CP_DATA_MISSING');
    expect(missing.map((f) => f.message)).toEqual([
      'Angaben fehlen bei 2 Ladepunkten (LP01, LP02): Mindeststrom, Phasen – bitte in der Ladepunkte-Ansicht nachtragen oder bestätigen',
      'Angaben fehlen bei LP03: Absicherung – bitte in der Ladepunkte-Ansicht nachtragen oder bestätigen',
    ]);
    expect(missing[0]?.targetIds).toEqual([a!.id, b!.id]);
    expect(missing.every((f) => f.blocksExport)).toBe(true);
  });

  it('ohne Vermerk keine Meldung', () => {
    const p = makeSampleProject();
    p.chargePoints[0]!.missingFields = [];
    const result = runChecks(p, catalogFromModels([TEST_MODEL]));
    expect(result.findings.some((f) => f.ruleId === 'CP_DATA_MISSING')).toBe(false);
  });
});
