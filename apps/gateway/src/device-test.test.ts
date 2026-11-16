import { afterEach, describe, expect, it } from 'vitest';
import { DeviceTestResponseSchema } from '@lastplan/protocol';
import { checkModel, type WallboxModel } from '@lastplan/wallbox-library';
import { MockModbusClient } from './clients/mocks';
import { ModbusSimulator } from './clients/modbus-simulator';
import { ModbusTcpClient } from './clients/modbus-tcp';
import { tcpProbe } from './clients/tcp-probe';
import { decodeRegisters, planDeviceTest, runDeviceTest } from './device-test';
import { defaultLibraryDir, loadLibraryDir } from './library';
import { TEST_MODEL_ID, TEST_REGISTERS, testModel } from './test-model';

let sim: ModbusSimulator | undefined;
let client: ModbusTcpClient | undefined;
afterEach(async () => {
  await client?.close();
  await sim?.stop();
  sim = undefined;
  client = undefined;
});

async function start(model: WallboxModel = testModel()) {
  sim = new ModbusSimulator({ ...TEST_REGISTERS, unitId: 1 });
  const port = await sim.start();
  client = new ModbusTcpClient({ timeoutMs: 150, retries: 0, idleMs: 1000 });
  const deps = { modbus: client, probe: (h: string, p: number) => tcpProbe(h, p, 500) };
  const target = {
    endpoint: { ip: '127.0.0.1', port, unitId: 1 },
    modelId: model.id,
    model,
    modelSource: 'gateway' as const,
  };
  return { sim, deps, target, port };
}

describe('Testmodell', () => {
  it('ist eine gültige, vollständige Modelldatei', () => {
    expect(checkModel(testModel()).status).toBe('complete');
  });
  it('fehlender Bibliotheksordner ergibt eine leere Bibliothek', () => {
    expect(loadLibraryDir('/gibt/es/nicht').size).toBe(0);
  });
});

describe('planDeviceTest', () => {
  it('liest das mitgelieferte ABL-Modell nicht: alle Register TODO', () => {
    const library = loadLibraryDir(defaultLibraryDir());
    const abl = library.get('abl/em4-twin@1');
    expect(abl).toBeDefined();
    const plan = planDeviceTest(abl, 'abl/em4-twin@1', 1);
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.message).toMatch(/^Nicht prüfbar: Register fehlen in der Bibliothek \(/);
    expect(plan.message).toContain('Strom L1: Adresse, Funktionscode, Datentyp');
    expect(plan.missing).toContain('modbus.registers.power.address');
    expect(plan.missing).toContain('modbus.byteOrder');
    // Unit-ID am Ladepunkt angegeben → nicht als fehlend gemeldet
    expect(plan.missing).not.toContain('modbus.defaultUnitId');
  });

  it('unbekanntes Modell, fehlendes Modbus, fehlende Unit-ID, fehlendes Register', () => {
    expect(planDeviceTest(undefined, 'x/y@1', 1)).toMatchObject({
      ok: false,
      message: expect.stringContaining('„x/y@1“ steht nicht in der Wallbox-Bibliothek'),
    });
    const http = { ...testModel(), protocols: ['http'] } as WallboxModel;
    expect(planDeviceTest(http, http.id, 1)).toMatchObject({
      ok: false,
      message: expect.stringContaining('kein Modbus TCP'),
    });
    const m = testModel();
    m.modbus.defaultUnitId = 'TODO';
    delete m.modbus.registers.currentL3;
    const plan = planDeviceTest(m, m.id, undefined);
    expect(plan).toMatchObject({
      ok: false,
      missing: ['modbus.defaultUnitId', 'modbus.registers.currentL3'],
    });
  });

  it('Schreib-Funktionscode in einer Leserolle → nicht prüfbar, kein Lesen', () => {
    const m = testModel();
    m.modbus.registers.power!.fn = 6;
    expect(planDeviceTest(m, m.id, 1)).toMatchObject({
      ok: false,
      missing: [],
      message: expect.stringContaining('Funktionscode 6 ist kein Lesecode'),
    });
  });

  it('Unit-ID aus dem Modell, wenn der Ladepunkt keine hat', () => {
    expect(planDeviceTest(testModel(), TEST_MODEL_ID, undefined)).toMatchObject({
      ok: true,
      unitId: 1,
    });
  });
});

describe('decodeRegisters', () => {
  it('16 Bit mit und ohne Vorzeichen, Byte-Reihenfolge', () => {
    expect(decodeRegisters([0xfffe], 'uint16', 'big-endian')).toBe(65534);
    expect(decodeRegisters([0xfffe], 'int16', 'big-endian')).toBe(-2);
    expect(decodeRegisters([0x0102], 'uint16', 'little-endian')).toBe(0x0201);
    expect(decodeRegisters([0x0102], 'uint16', 'word-swapped')).toBe(0x0102);
  });
  it('32 Bit: ABCD, CDAB, DCBA und float32', () => {
    expect(decodeRegisters([0x0001, 0x0002], 'uint32', 'big-endian')).toBe(0x00010002);
    expect(decodeRegisters([0x0002, 0x0001], 'uint32', 'word-swapped')).toBe(0x00010002);
    expect(decodeRegisters([0x0200, 0x0100], 'uint32', 'little-endian')).toBe(0x00010002);
    expect(decodeRegisters([0xffff, 0xfffe], 'int32', 'big-endian')).toBe(-2);
    expect(decodeRegisters([0x4148, 0x0000], 'float32', 'big-endian')).toBe(12.5);
  });
});

describe('runDeviceTest gegen Simulator', () => {
  it('liest Ströme, Leistung und Status mit Einheit, schreibt nie', async () => {
    const { sim, deps, target } = await start();
    const res = DeviceTestResponseSchema.parse(await runDeviceTest(target, deps));
    expect(res).toMatchObject({ outcome: 'ok', reachable: true, message: null, missing: [] });
    expect(res.latencyMs).toBeGreaterThanOrEqual(0);
    expect(res.values).toEqual({
      currentL1: 16,
      currentL2: 15.5,
      currentL3: 0,
      power: 7360,
      status: 'lädt',
    });
    expect(res.readings.find((r) => r.role === 'power')).toMatchObject({
      unit: 'W',
      raw: [0, 7360],
    });
    expect(res.readings.find((r) => r.role === 'status')?.value).toBe(2);
    expect(sim.writes).toEqual([]);
    expect(sim.requests.map((r) => r.functionCode)).toEqual([4, 4, 4, 3, 3]);
  });

  it('nicht prüfbar: kein einziger Modbus-Zugriff, aber TCP-Erreichbarkeit', async () => {
    const m = testModel();
    m.modbus.registers.currentL1!.address = 'TODO';
    const { sim, deps, target } = await start(m);
    const res = await runDeviceTest(target, deps);
    expect(res).toMatchObject({
      outcome: 'not_testable',
      reachable: true,
      missing: ['modbus.registers.currentL1.address'],
    });
    expect(res.message).toMatch(
      /Nicht prüfbar: Register fehlen in der Bibliothek \(Strom L1: Adresse\).*nicht gelesen/,
    );
    expect(sim.requests).toEqual([]);
  });

  it('nicht prüfbar und Port zu', async () => {
    const m = testModel();
    m.modbus.byteOrder = 'TODO';
    const { deps, target, sim: s } = await start(m);
    await s.stop();
    sim = undefined;
    const res = await runDeviceTest(target, deps);
    expect(res).toMatchObject({ outcome: 'not_testable', reachable: false, latencyMs: null });
    expect(res.message).toMatch(/Byte-Reihenfolge.*Außerdem: Verbindung .* abgelehnt/);
  });

  it('Exception für ein Register: übrige werden gelesen, Ergebnis Gerätefehler', async () => {
    const { sim, deps, target } = await start();
    sim.input.delete(9101);
    const res = await runDeviceTest(target, deps);
    expect(res.outcome).toBe('device_error');
    expect(res.reachable).toBe(true);
    expect(res.message).toMatch(/Ausnahme 0x02.*Register 9101 \(Strom L2\)/);
    expect(res.values['currentL3']).toBe(0);
    expect(res.values['currentL2']).toBeNull();
  });

  it('Timeout nach Verbindungsaufbau: erreichbar, Rest nicht gelesen', async () => {
    const { sim, deps, target } = await start();
    sim.inject({ kind: 'timeout' });
    const res = await runDeviceTest(target, deps);
    expect(res).toMatchObject({ outcome: 'device_error', reachable: true, latencyMs: null });
    expect(res.message).toMatch(/Keine Antwort/);
    expect(res.readings[4]?.error).toBe('Nicht gelesen (vorheriger Fehler).');
    expect(sim.requests).toHaveLength(1);
  });

  it('Gerät nicht erreichbar', async () => {
    const { deps, target, sim: s } = await start();
    await s.stop();
    sim = undefined;
    const res = await runDeviceTest(target, deps);
    expect(res).toMatchObject({ outcome: 'unreachable', reachable: false, latencyMs: null });
    expect(res.message).toMatch(/abgelehnt/);
  });

  it('nicht-Modbus-Fehler aus einem anderen Client', async () => {
    const mock = new MockModbusClient();
    const res = await runDeviceTest(
      {
        endpoint: { ip: '10.0.0.1', port: 502 },
        modelId: TEST_MODEL_ID,
        model: testModel(),
        modelSource: 'request',
      },
      { modbus: mock, probe: async () => 1, clock: () => new Date('2026-11-16T10:00:00Z') },
    );
    expect(res).toMatchObject({
      outcome: 'unreachable',
      modelSource: 'request',
      testedAt: '2026-11-16T10:00:00.000Z',
    });
    expect(res.message).toMatch(/Mock: Register 9100 nicht belegt/);
  });
});
