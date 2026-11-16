import { createServer, type AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ModbusConnectionError,
  ModbusExceptionError,
  ModbusProtocolError,
  ModbusTimeoutError,
} from './modbus-errors';
import {
  FunctionCode,
  encodeFrame,
  readRequestPdu,
  scanFrame,
  writeMultipleRequestPdu,
} from './modbus-frame';
import { ModbusSimulator } from './modbus-simulator';
import { ModbusTcpClient, type ModbusTcpOptions } from './modbus-tcp';

let sim: ModbusSimulator | undefined;
let client: ModbusTcpClient | undefined;

afterEach(async () => {
  await client?.close();
  await sim?.stop();
  sim = undefined;
  client = undefined;
});

const FAST: ModbusTcpOptions = { timeoutMs: 150, retries: 0, retryBaseMs: 5, idleMs: 1000 };

async function setup(options: ConstructorParameters<typeof ModbusSimulator>[0] = {}, opts = FAST) {
  sim = new ModbusSimulator(options);
  const port = await sim.start();
  client = new ModbusTcpClient(opts);
  return { sim, client, ep: { host: '127.0.0.1', port, unitId: 1 } };
}

describe('Modbus-Rahmen (MBAP)', () => {
  it('kodiert Header nach Implementation Guide 3.1.3', () => {
    const adu = encodeFrame(0x1234, 7, readRequestPdu(FunctionCode.ReadHoldingRegisters, 100, 2));
    expect([...adu]).toEqual([0x12, 0x34, 0, 0, 0, 6, 7, 0x03, 0, 100, 0, 2]);
  });

  it('zerlegt Bytestrom: unvollständig, mehrere Rahmen, ungültige Länge', () => {
    const a = encodeFrame(1, 1, Buffer.from([3, 2, 0, 5]));
    const b = encodeFrame(2, 1, Buffer.from([3, 2, 0, 6]));
    expect(scanFrame(a.subarray(0, 5)).kind).toBe('incomplete');
    expect(scanFrame(a.subarray(0, 9)).kind).toBe('incomplete');
    const first = scanFrame(Buffer.concat([a, b]));
    expect(first.kind).toBe('frame');
    if (first.kind !== 'frame') return;
    expect(first.frame.transactionId).toBe(1);
    expect(scanFrame(first.rest).kind).toBe('frame');
    const bad = Buffer.from(a);
    bad.writeUInt16BE(300, 4);
    expect(scanFrame(bad)).toEqual({ kind: 'invalid', reason: expect.stringContaining('300') });
  });

  it('Write-Multiple-PDU enthält Bytezahl', () => {
    expect([...writeMultipleRequestPdu(10, [1, 2])]).toEqual([0x10, 0, 10, 0, 2, 4, 0, 1, 0, 2]);
  });
});

describe('ModbusTcpClient gegen Simulator', () => {
  it('liest Holding- (0x03) und Input-Register (0x04)', async () => {
    const { client, ep, sim } = await setup({
      holding: { 100: 1, 101: 65535 },
      input: { 100: 42 },
    });
    expect(await client.readHoldingRegisters(ep, 100, 2)).toEqual([1, 65535]);
    expect(await client.readInputRegisters(ep, 100, 1)).toEqual([42]);
    expect(sim.requests.map((r) => r.functionCode)).toEqual([3, 4]);
    // Beide Anfragen über dieselbe Verbindung
    expect(sim.connections).toBe(1);
  });

  it('schreibt 0x06 und 0x10', async () => {
    const { client, ep, sim } = await setup({ holding: { 10: 0, 11: 0, 12: 0 } });
    await client.writeSingleRegister(ep, 10, 7);
    await client.writeMultipleRegisters(ep, 11, [8, 9]);
    expect([...sim.holding.values()]).toEqual([7, 8, 9]);
    expect(sim.writes).toHaveLength(2);
  });

  it('parallele Anfragen laufen nacheinander und werden richtig zugeordnet', async () => {
    const { client, ep } = await setup({ holding: { 1: 11, 2: 22, 3: 33 }, delayMs: 5 });
    const res = await Promise.all([1, 2, 3].map((a) => client.readHoldingRegisters(ep, a, 1)));
    expect(res).toEqual([[11], [22], [33]]);
  });

  it('Exception-Antwort → deutsche Meldung mit Code', async () => {
    const { client, ep } = await setup({ holding: { 1: 1 } });
    const err = await client.readHoldingRegisters(ep, 500, 1).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ModbusExceptionError);
    expect((err as ModbusExceptionError).exceptionCode).toBe(2);
    expect((err as Error).message).toMatch(/Ausnahme 0x02.*Registeradresse ist im Gerät nicht/);
    await expect(client.writeSingleRegister(ep, 9, 1)).rejects.toThrow(/0x02/);
  });

  it('injizierte Exception (Gerät beschäftigt) wird nicht wiederholt', async () => {
    const { client, ep, sim } = await setup({ holding: { 1: 1 } }, { ...FAST, retries: 3 });
    sim.inject({ kind: 'exception', code: 6 });
    await expect(client.readHoldingRegisters(ep, 1, 1)).rejects.toThrow(/beschäftigt/);
    expect(sim.requests).toHaveLength(1);
  });

  it('unbekannter Exception-Code', async () => {
    const { client, ep, sim } = await setup({ holding: { 1: 1 } });
    sim.inject({ kind: 'exception', code: 0x42 });
    await expect(client.readHoldingRegisters(ep, 1, 1)).rejects.toThrow(/unbekannter/);
  });

  it('Timeout ohne Antwort; danach neue Verbindung', async () => {
    const { client, ep, sim } = await setup({ holding: { 1: 5 } });
    sim.inject({ kind: 'timeout' }, 1);
    const err = await client.readHoldingRegisters(ep, 1, 1).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ModbusTimeoutError);
    expect((err as ModbusTimeoutError).connected).toBe(true);
    expect((err as Error).message).toMatch(/Keine Antwort .*150 ms/);
    expect(await client.readHoldingRegisters(ep, 1, 1)).toEqual([5]);
    expect(sim.connections).toBe(2);
  });

  it('Wiederholung mit Backoff nach Timeout bzw. geschlossener Verbindung', async () => {
    const { client, ep, sim } = await setup({ holding: { 1: 5 } }, { ...FAST, retries: 2 });
    sim.inject({ kind: 'close' }, 1);
    expect(await client.readHoldingRegisters(ep, 1, 1)).toEqual([5]);
    sim.inject({ kind: 'timeout' }, 2);
    expect(await client.readHoldingRegisters(ep, 1, 1)).toEqual([5]);
    sim.inject({ kind: 'close' });
    const err = await client.readHoldingRegisters(ep, 1, 1).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ModbusConnectionError);
    expect((err as Error).message).toMatch(/hat die Verbindung geschlossen/);
  });

  it('falsche Transaction-ID wird verworfen und führt zu Timeout mit Hinweis', async () => {
    const { client, ep, sim } = await setup({ holding: { 1: 5 } });
    sim.inject({ kind: 'wrongTransactionId' }, 1);
    await expect(client.readHoldingRegisters(ep, 1, 1)).rejects.toThrow(
      /fremder Transaction-ID \d+ wurde verworfen/,
    );
  });

  it('falsche Unit-ID, Protokoll-ID und Unit ohne Antwort', async () => {
    const { client, ep, sim } = await setup({ holding: { 1: 5 } });
    sim.inject({ kind: 'wrongUnitId' }, 1);
    await expect(client.readHoldingRegisters(ep, 1, 1)).rejects.toBeInstanceOf(ModbusProtocolError);
    sim.inject({ kind: 'wrongProtocolId' }, 1);
    await expect(client.readHoldingRegisters(ep, 1, 1)).rejects.toThrow(/Protokoll-ID 1/);
    sim.unitId = 9;
    await expect(client.readHoldingRegisters(ep, 1, 1)).rejects.toThrow(/Unit-ID/);
  });

  it('Verbindung abgelehnt → Verbindungsfehler, nicht verbunden', async () => {
    const { client, ep, sim: s } = await setup();
    await s.stop();
    sim = undefined;
    const err = await client.readHoldingRegisters(ep, 1, 1).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ModbusConnectionError);
    expect((err as ModbusConnectionError).connected).toBe(false);
    expect((err as Error).message).toMatch(/abgelehnt/);
  });

  it('prüft Argumente vor dem Senden', async () => {
    const { client, ep } = await setup();
    await expect(client.readHoldingRegisters(ep, -1, 1)).rejects.toThrow(RangeError);
    await expect(client.readHoldingRegisters(ep, 0, 126)).rejects.toThrow(/1 bis 125/);
    await expect(client.readHoldingRegisters(ep, 65535, 2)).rejects.toThrow(/65535/);
    await expect(client.writeSingleRegister(ep, 0, 70000)).rejects.toThrow(/Registerwert/);
    await expect(client.writeMultipleRegisters(ep, 0, [])).rejects.toThrow(/1 bis 123/);
    await expect(client.readHoldingRegisters({ ...ep, unitId: 256 }, 0, 1)).rejects.toThrow(
      /Unit-ID/,
    );
  });
});

describe('ModbusTcpClient gegen fehlerhafte Geräte', () => {
  /** Minimaler Server, der auf jede Anfrage mit `answer(tid)` antwortet. */
  async function rogue(answer: (tid: number) => Buffer) {
    const server = createServer((s) =>
      s.on('data', (d: Buffer) => s.write(answer(d.readUInt16BE(0)))),
    );
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    client = new ModbusTcpClient(FAST);
    const ep = { host: '127.0.0.1', port: (server.address() as AddressInfo).port, unitId: 1 };
    return {
      ep,
      stop: () =>
        new Promise<void>((r) => {
          server.close(() => r());
        }),
    };
  }

  it('falsche Registeranzahl in der Antwort', async () => {
    const { ep, stop } = await rogue((tid) => encodeFrame(tid, 1, Buffer.from([3, 2, 0, 1])));
    await expect(client!.readHoldingRegisters(ep, 0, 2)).rejects.toThrow(/1 statt 2 Register/);
    await client!.close();
    await stop();
  });

  it('falscher Funktionscode, kaputte Exception, kein Echo, falsche 0x10-Antwort', async () => {
    let reply = Buffer.from([4, 2, 0, 1]);
    const { ep, stop } = await rogue((tid) => encodeFrame(tid, 1, reply));
    await expect(client!.readHoldingRegisters(ep, 0, 1)).rejects.toThrow(/Funktionscode 4/);
    reply = Buffer.from([0x83, 2, 0]);
    await expect(client!.readHoldingRegisters(ep, 0, 1)).rejects.toThrow(/ungültige Länge/);
    reply = Buffer.from([6, 0, 1, 0, 9]);
    await expect(client!.writeSingleRegister(ep, 1, 1)).rejects.toThrow(/kein Echo/);
    reply = Buffer.from([0x10, 0, 1, 0, 9]);
    await expect(client!.writeMultipleRegisters(ep, 1, [1])).rejects.toThrow(/passt nicht/);
    await client!.close();
    await stop();
  });

  it('ungültiger MBAP-Header → Protokollfehler', async () => {
    const { ep, stop } = await rogue(() => Buffer.from([0, 1, 0, 0, 0xff, 0xff, 1, 3]));
    await expect(client!.readHoldingRegisters(ep, 0, 1)).rejects.toThrow(/Längenfeld/);
    await client!.close();
    await stop();
  });

  it('Verbindungsaufbau-Timeout (nicht routbare Adresse)', async () => {
    client = new ModbusTcpClient({ ...FAST, timeoutMs: 50 });
    // 192.0.2.0/24 ist laut RFC 5737 für Dokumentation reserviert und nicht erreichbar.
    const err = await client
      .readHoldingRegisters({ host: '192.0.2.1', port: 502, unitId: 1 }, 0, 1)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as { connected: boolean }).connected).toBe(false);
  });
});
