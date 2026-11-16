import { describe, expect, it } from 'vitest';
import { createLibraryIndex, describeModel, modelDefaults, modelDisplayName } from './libraryInfo';
import { TEST_MODEL_ID, testLibrary } from './testLibrary';

const index = createLibraryIndex(testLibrary());

describe('Bibliothekssicht', () => {
  it('liefert Standardwerte nur aus echten Zahlen', () => {
    expect(modelDefaults(index.get(TEST_MODEL_ID))).toEqual({
      port: 1502,
      unitId: 3,
      minA: 6,
      maxA: 20,
      missing: [],
    });
  });

  it('TODO-Modell liefert keine Standardwerte, sondern nennt die Lücken', () => {
    const d = modelDefaults(index.get('abl/em4-twin@1'));
    expect(d.port).toBeUndefined();
    expect(d.unitId).toBeUndefined();
    expect(d.minA).toBeUndefined();
    expect(d.maxA).toBeUndefined();
    expect(d.missing).toEqual(['Port', 'Unit-ID', 'Mindeststrom', 'Maximalstrom']);
  });

  it('unbekanntes Modell: keine Werte, Modell-ID als Name', () => {
    expect(modelDefaults(undefined).missing).toEqual([]);
    expect(modelDisplayName(index, 'x/y@1')).toBe('x/y@1');
    expect(describeModel(index, 'x/y@1').inLibrary).toBe(false);
  });

  it('markiert jede Lücke im ABL-Modell und zählt sie', () => {
    const info = describeModel(index, 'abl/em4-twin@1');
    expect(info.complete).toBe(false);
    expect(info.missingCount).toBeGreaterThan(8);
    expect(info.port).toEqual({ todo: true });
    expect(info.registers).toHaveLength(8);
    expect(info.registers.every((r) => r.address.todo && r.fn.todo && r.source.todo)).toBe(true);
  });

  it('vollständiges Testmodell hat keine Lücken; Firmware-Obergrenze null ist „offen“', () => {
    const info = describeModel(index, TEST_MODEL_ID);
    expect(info.complete).toBe(true);
    expect(info.missingCount).toBe(0);
    expect(info.firmware.max).toEqual({ todo: false, text: 'offen' });
    expect(info.registers[0]?.address).toEqual({ todo: false, text: '1000' });
  });
});
