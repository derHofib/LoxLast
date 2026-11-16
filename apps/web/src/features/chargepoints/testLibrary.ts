import { loadLibrary, REGISTER_ROLES, type LibraryCheck } from '@lastplan/wallbox-library';
import { bundledModelFiles } from '../../library/catalog';

/** Vollständiges Testmodell (nur für Tests, kein reales Gerät) mit eigenen Standardwerten. */
export const TEST_MODEL_ID = 'test-hersteller/testmodell@1';

function testModel(id = TEST_MODEL_ID, model = 'Testmodell'): Record<string, unknown> {
  const source = 'Testdokument, v1.0, S. 1';
  const registers = Object.fromEntries(
    REGISTER_ROLES.map((role, i) => [
      role,
      {
        address: 1000 + i,
        fn: 3,
        type: 'uint16',
        scale: 1,
        access: 'r',
        unit: 'A',
        source,
      },
    ]),
  );
  return {
    id,
    vendor: 'Test',
    model,
    firmware: { min: '1.0', max: null, source },
    protocols: ['modbus-tcp'],
    electrical: { minA: 6, maxA: 20, phases: [1, 3], phaseSwitching: false, source },
    modbus: { defaultPort: 1502, defaultUnitId: 3, byteOrder: 'big-endian', registers, source },
    loxone: { functionBlock: 'Testbaustein', source, inputs: {}, outputs: {} },
  };
}

/** Zweites Testmodell desselben Herstellers (für die Modellauswahl nach Herstellerwechsel). */
export const TEST_MODEL_2_ID = 'test-hersteller/testmodell-zwei@1';

/** Mitgelieferte Bibliothek (mit dem lückenhaften ABL-Modell) plus das Testmodell. */
export function testLibrary({ second = false }: { second?: boolean } = {}): LibraryCheck {
  return loadLibrary([
    ...bundledModelFiles,
    { path: `${TEST_MODEL_ID}.json`, content: JSON.stringify(testModel()) },
    ...(second
      ? [
          {
            path: `${TEST_MODEL_2_ID}.json`,
            content: JSON.stringify(testModel(TEST_MODEL_2_ID, 'Testmodell Zwei')),
          },
        ]
      : []),
  ]);
}
