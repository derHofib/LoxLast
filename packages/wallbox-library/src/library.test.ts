import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkModel } from './validate';
import { checkModelFile, loadLibrary, type ModelFile } from './loader';
import { REGISTER_ROLES } from './model';

const MODELS_DIR = fileURLToPath(new URL('../models/', import.meta.url));

function readRepoModels(): ModelFile[] {
  return readdirSync(MODELS_DIR, { recursive: true })
    .map(String)
    .filter((path) => path.endsWith('.json'))
    .sort()
    .map((path) => ({ path, content: readFileSync(`${MODELS_DIR}${path}`, 'utf-8') }));
}

/** Vollständiges, gültiges Testmodell mit echten Werten und Quellen. */
function completeModel(): Record<string, unknown> {
  const source = 'Testdokument, v1.0, S. 1';
  const registers = Object.fromEntries(
    REGISTER_ROLES.map((role, index) => [
      role,
      {
        address: 1000 + index,
        fn: 3,
        type: 'uint16',
        scale: 1,
        access: role === 'setpointCurrent' || role === 'enable' ? 'rw' : 'r',
        unit: 'A',
        source,
      },
    ]),
  );
  return {
    id: 'test-hersteller/testmodell@1',
    vendor: 'Test',
    model: 'Testmodell',
    firmware: { min: '1.0', max: null, source },
    protocols: ['modbus-tcp'],
    electrical: { minA: 6, maxA: 32, phases: [1, 3], phaseSwitching: false, source },
    modbus: { defaultPort: 502, defaultUnitId: 1, byteOrder: 'big-endian', registers, source },
    loxone: {
      functionBlock: 'Testbaustein',
      source,
      inputs: { Strom: 'registers.currentL1' },
      outputs: { Sollstrom: 'registers.setpointCurrent' },
    },
  };
}

function reg(
  registers: Record<string, Record<string, unknown>>,
  role: string,
): Record<string, unknown> {
  const found = registers[role];
  if (!found) throw new Error(`Register ${role} fehlt im Testmodell`);
  return found;
}

function withFile(path: string, data: unknown): ModelFile {
  return { path, content: JSON.stringify(data) };
}

describe('Modelldateien im Repo', () => {
  it('enthalten mindestens die ABL-Vorlage', () => {
    expect(readRepoModels().map((file) => file.path)).toContain('abl/em4-twin@1.json');
  });

  it('sind alle gültig (CI bricht bei ungültigen Dateien ab)', () => {
    const result = loadLibrary(readRepoModels());
    const problems = result.models
      .filter((model) => model.status === 'invalid')
      .map(
        (model) =>
          `${model.path}: ${model.issues.map((issue) => `${issue.path} ${issue.message}`).join('; ')}`,
      );
    expect(problems).toEqual([]);
    expect(result.duplicateIds).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('ABL eM4 ist unvollständig, weil alle Registerwerte noch TODO sind', () => {
    const abl = loadLibrary(readRepoModels()).models.find(
      (model) => model.path === 'abl/em4-twin@1.json',
    );
    expect(abl?.status).toBe('incomplete');
    expect(abl?.issues).toEqual([]);
    for (const role of REGISTER_ROLES) {
      const register = abl?.model?.modbus.registers[role];
      expect(register?.address).toBe('TODO');
      expect(register?.fn).toBe('TODO');
      expect(register?.type).toBe('TODO');
      expect(register?.scale).toBe('TODO');
      expect(register?.access).toBe('TODO');
      expect(register?.unit).toBe('TODO');
      expect(register?.source).toBe('TODO');
    }
    expect(abl?.todos).toContain('/modbus/registers/power/address');
  });
});

describe('checkModel', () => {
  it('vollständiges Modell mit Quellen ist complete', () => {
    const result = checkModel(completeModel());
    expect(result.status).toBe('complete');
    expect(result.todos).toEqual([]);
    expect(result.issues).toEqual([]);
  });

  it('TODO-Platzhalter machen das Modell unvollständig, nicht ungültig', () => {
    const data = completeModel();
    (data['modbus'] as Record<string, unknown>)['defaultPort'] = 'TODO(verify)';
    const result = checkModel(data);
    expect(result.status).toBe('incomplete');
    expect(result.todos).toEqual(['/modbus/defaultPort']);
  });

  it('Registerwert ohne Quelle ist ungültig', () => {
    const data = completeModel();
    const registers = (data['modbus'] as { registers: Record<string, Record<string, unknown>> })
      .registers;
    reg(registers, 'power')['source'] = 'TODO';
    const result = checkModel(data);
    expect(result.status).toBe('invalid');
    expect(result.issues.map((issue) => issue.path)).toContain('/modbus/registers/power');
  });

  it('Block ohne Quelle darf keine echten Werte enthalten', () => {
    const data = completeModel();
    (data['electrical'] as Record<string, unknown>)['source'] = 'TODO';
    expect(checkModel(data).status).toBe('invalid');
  });

  it('fehlendes Pflichtregister ist ungültig', () => {
    const data = completeModel();
    delete (data['modbus'] as { registers: Record<string, unknown> }).registers['status'];
    expect(checkModel(data).status).toBe('invalid');
  });

  it('minA größer als maxA ist ungültig', () => {
    const data = completeModel();
    (data['electrical'] as Record<string, unknown>)['minA'] = 40;
    const result = checkModel(data);
    expect(result.status).toBe('invalid');
    expect(result.issues.some((issue) => issue.path === '/electrical')).toBe(true);
  });

  it('doppelte Modbus-Adresse je Funktionscode ist ungültig', () => {
    const data = completeModel();
    const registers = (data['modbus'] as { registers: Record<string, Record<string, unknown>> })
      .registers;
    reg(registers, 'power')['address'] = reg(registers, 'currentL1')['address'];
    expect(checkModel(data).status).toBe('invalid');
  });

  it('Verweis auf unbekanntes Register ist ungültig', () => {
    const data = completeModel();
    (data['loxone'] as Record<string, unknown>)['inputs'] = { Strom: 'registers.gibtsNicht' };
    expect(checkModel(data).status).toBe('invalid');
  });

  it('unbekanntes Feld ist ungültig', () => {
    const data = completeModel();
    data['unbekannt'] = 1;
    expect(checkModel(data).status).toBe('invalid');
  });

  it('ungültiger Wert statt TODO ist ungültig', () => {
    const data = completeModel();
    (data['electrical'] as Record<string, unknown>)['maxA'] = 'viel';
    expect(checkModel(data).status).toBe('invalid');
  });

  it('loxone-Block ohne Quelle mit echten Werten ist ungültig', () => {
    const data = completeModel();
    (data['loxone'] as Record<string, unknown>)['source'] = 'TODO';
    expect(checkModel(data).status).toBe('invalid');
  });

  it('Platzhalter in Varianten (" TODO", "todo") zählen als Platzhalter', () => {
    const data = completeModel();
    (data['firmware'] as Record<string, unknown>)['source'] = ' todo';
    expect(checkModel(data).status).toBe('invalid');
  });

  it('Freitext ohne Quelle-Platzhalter ist eine Quelle', () => {
    const data = completeModel();
    (data['firmware'] as Record<string, unknown>)['source'] = 'Datenblatt, v2, S. 3';
    expect(checkModel(data).status).toBe('complete');
  });

  it('Prototyp-Schlüssel als Registerverweis ist ungültig', () => {
    const data = completeModel();
    (data['loxone'] as Record<string, unknown>)['inputs'] = { S: 'registers.constructor' };
    expect(checkModel(data).status).toBe('invalid');
  });

  it('32-Bit-Register, das ein Nachbarregister überlappt, ist ungültig', () => {
    const data = completeModel();
    const registers = (data['modbus'] as { registers: Record<string, Record<string, unknown>> })
      .registers;
    const power = reg(registers, 'power');
    power['type'] = 'uint32';
    power['address'] = reg(registers, 'currentL1')['address'];
    expect(checkModel(data).status).toBe('invalid');
  });

  it('Ausgang auf ein nur lesbares Register ist ungültig', () => {
    const data = completeModel();
    (data['loxone'] as Record<string, unknown>)['outputs'] = { O: 'registers.currentL1' };
    expect(checkModel(data).status).toBe('invalid');
  });
});

describe('checkModelFile und loadLibrary', () => {
  it('meldet kaputtes JSON als ungültig', () => {
    const result = checkModelFile({
      path: 'test-hersteller/testmodell@1.json',
      content: '{ kaputt',
    });
    expect(result.status).toBe('invalid');
    expect(result.issues[0]?.message).toContain('Kein gültiges JSON');
  });

  it('Kennung muss zum Pfad passen', () => {
    const result = checkModelFile(withFile('andere/modell@1.json', completeModel()));
    expect(result.status).toBe('invalid');
    expect(result.issues.some((issue) => issue.path === '/id')).toBe(true);
  });

  it('Dateiname muss dem Muster entsprechen', () => {
    const result = checkModelFile(withFile('Test/Modell.json', completeModel()));
    expect(result.status).toBe('invalid');
  });

  it('doppelte Kennungen brechen die Bibliothek ab', () => {
    const result = loadLibrary([
      withFile('test-hersteller/testmodell@1.json', completeModel()),
      withFile('test-hersteller/testmodell@1.json', completeModel()),
    ]);
    expect(result.duplicateIds).toEqual(['test-hersteller/testmodell@1']);
    expect(result.ok).toBe(false);
  });

  it('unvollständige Modelle bleiben ok, weil sie gültig sind', () => {
    const data = completeModel();
    (data['firmware'] as Record<string, unknown>)['min'] = 'TODO';
    const result = loadLibrary([withFile('test-hersteller/testmodell@1.json', data)]);
    expect(result.ok).toBe(true);
    expect(result.models[0]?.status).toBe('incomplete');
  });
});
