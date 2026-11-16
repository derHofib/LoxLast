import type { WallboxModel } from '@lastplan/wallbox-library';

/**
 * Klar fiktives Testmodell – nur für Tests, KEIN reales Gerät, nicht in der Bibliothek.
 * Adressen und Skalierung sind frei gewählt und passen zum Registerabbild `TEST_REGISTERS`.
 */
export const TEST_MODEL_ID = 'test-hersteller/fiktiv@1';
const source = 'Fiktives Testdokument, v0, S. 0';

export function testModel(): WallboxModel {
  const reg = (address: number, fn: number, type: string, scale: number, unit: string) => ({
    address,
    fn,
    type,
    scale,
    access: 'r',
    unit,
    source,
  });
  return {
    id: TEST_MODEL_ID,
    vendor: 'Testhersteller',
    model: 'Fiktiv',
    firmware: { min: '0.0', max: null, source },
    protocols: ['modbus-tcp'],
    electrical: { minA: 6, maxA: 16, phases: [3], phaseSwitching: false, source },
    modbus: {
      defaultPort: 1502,
      defaultUnitId: 1,
      byteOrder: 'big-endian',
      registers: {
        setpointCurrent: { ...reg(9000, 6, 'uint16', 0.1, 'A'), access: 'rw' },
        enable: { ...reg(9001, 6, 'uint16', 1, ''), access: 'rw' },
        currentL1: reg(9100, 4, 'uint16', 0.1, 'A'),
        currentL2: reg(9101, 4, 'uint16', 0.1, 'A'),
        currentL3: reg(9102, 4, 'uint16', 0.1, 'A'),
        power: reg(9110, 3, 'uint32', 1, 'W'),
        energy: reg(9120, 3, 'uint32', 0.001, 'kWh'),
        status: { ...reg(9200, 3, 'uint16', 1, ''), enum: { '0': 'bereit', '2': 'lädt' } },
      },
      source,
    },
    loxone: { functionBlock: 'Testbaustein', inputs: {}, outputs: {}, source },
  } as WallboxModel;
}

/** Registerabbild für den Simulator: 16,0 A / 15,5 A / 0 A, 7 360 W, Status 2 („lädt“). */
export const TEST_REGISTERS = {
  input: { 9100: 160, 9101: 155, 9102: 0 },
  holding: { 9000: 160, 9001: 1, 9110: 0, 9111: 7360, 9200: 2 },
};
