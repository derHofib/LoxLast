import { afterEach, describe, expect, it } from 'vitest';
import { DeviceTestResponseSchema, ErrorResponseSchema } from '@lastplan/protocol';
import { ModbusSimulator } from './clients/modbus-simulator';
import { ModbusTcpClient } from './clients/modbus-tcp';
import { libraryFromFiles } from './library';
import { makeServer, pairedToken } from './test-helpers';
import { TEST_MODEL_ID, TEST_REGISTERS, testModel } from './test-model';

type Ctx = Awaited<ReturnType<typeof makeServer>>;
let ctx: Ctx | undefined;
let sim: ModbusSimulator | undefined;
afterEach(async () => {
  await ctx?.app.close();
  await sim?.stop();
  ctx = undefined;
  sim = undefined;
});

const library = libraryFromFiles([
  { path: `${TEST_MODEL_ID}.json`, content: JSON.stringify(testModel()) },
]);

async function setup(over: Parameters<typeof makeServer>[0] = {}) {
  sim = new ModbusSimulator({ ...TEST_REGISTERS, unitId: 1 });
  const port = await sim.start();
  ctx = await makeServer({
    modbus: new ModbusTcpClient({ timeoutMs: 200, retries: 0 }),
    library,
    ...over,
  });
  const headers = { authorization: `Bearer ${await pairedToken(ctx)}` };
  const post = (payload: unknown) =>
    ctx!.app.inject({
      method: 'POST',
      url: '/api/devices/test',
      headers,
      payload: payload as object,
    });
  return { port, post, sim, ctx };
}

describe('POST /api/devices/test', () => {
  it('ohne Token → 401', async () => {
    const { ctx: c } = await setup();
    const res = await c.app.inject({ method: 'POST', url: '/api/devices/test', payload: {} });
    expect(res.statusCode).toBe(401);
  });

  it('liest das Gerät mit dem Modell aus der Gateway-Bibliothek', async () => {
    const { port, post } = await setup();
    const res = await post({
      endpoint: { ip: '127.0.0.1', port, unitId: 1 },
      libraryModelId: TEST_MODEL_ID,
    });
    expect(res.statusCode).toBe(200);
    const body = DeviceTestResponseSchema.parse(res.json());
    expect(body).toMatchObject({ outcome: 'ok', reachable: true, modelSource: 'gateway' });
    expect(body.values['currentL1']).toBe(16);
  });

  it('mitgeschickte Modelldatei hat Vorrang und wird geprüft', async () => {
    const { port, post, sim: s } = await setup();
    const m = testModel();
    m.modbus.registers.status!.address = 'TODO';
    const res = await post({
      endpoint: { ip: '127.0.0.1', port, unitId: 1 },
      libraryModelId: TEST_MODEL_ID,
      model: m,
    });
    const body = DeviceTestResponseSchema.parse(res.json());
    expect(body).toMatchObject({ outcome: 'not_testable', modelSource: 'request' });
    expect(body.missing).toEqual(['modbus.registers.status.address']);
    expect(s.requests).toEqual([]);

    const bad = await post({
      endpoint: { ip: '127.0.0.1', port },
      libraryModelId: TEST_MODEL_ID,
      model: { id: TEST_MODEL_ID },
    });
    expect(bad.statusCode).toBe(400);
    expect(ErrorResponseSchema.parse(bad.json()).error.message).toMatch(/Modelldatei ist ungültig/);

    const other = await post({
      endpoint: { ip: '127.0.0.1', port },
      libraryModelId: 'andere/id@1',
      model: testModel(),
    });
    expect(other.statusCode).toBe(400);
    expect(ErrorResponseSchema.parse(other.json()).error.message).toMatch(/passt nicht/);
  });

  it('unbekanntes Modell → nicht prüfbar', async () => {
    const { port, post } = await setup();
    const res = await post({ endpoint: { ip: '127.0.0.1', port }, libraryModelId: 'x/y@1' });
    expect(res.json()).toMatchObject({ outcome: 'not_testable', modelSource: null });
  });

  it('strikte Eingabevalidierung (Unit-ID, Port, IP)', async () => {
    const { post } = await setup();
    for (const endpoint of [
      { ip: '127.0.0.1', port: 502, unitId: 248 },
      { ip: '127.0.0.1', port: 0 },
      { ip: 'wallbox.local', port: 502 },
    ]) {
      const res = await post({ endpoint, libraryModelId: TEST_MODEL_ID });
      expect(res.statusCode).toBe(400);
      expect(ErrorResponseSchema.parse(res.json()).error.code).toBe('invalid_request');
    }
  });

  it('eigenes Rate-Limit für Geräte-Tests', async () => {
    const { port, post } = await setup({ deviceTestsPerMinute: 2 });
    const req = { endpoint: { ip: '127.0.0.1', port }, libraryModelId: 'x/y@1' };
    expect((await post(req)).statusCode).toBe(200);
    expect((await post(req)).statusCode).toBe(200);
    const limited = await post(req);
    expect(limited.statusCode).toBe(429);
  });
});
