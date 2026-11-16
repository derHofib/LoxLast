import { afterEach, describe, expect, it } from 'vitest';
import { ConfigDiscoveryResponseSchema } from '@lastplan/protocol';
import { makeServer, pairedToken } from '../test-helpers';
import { createConfigMcpClient, type ConfigMcpClient } from './client';
import { DISCOVERY_QUERY, docOrder, MAX_DOCS, runConfigDiscovery } from './discovery';
import { startFakeConfigMcp, type FakeConfigMcp } from './fake-server';
import { PROJECT_QUERY } from './status';

const PROJECT = { title: 'Testprojekt', modified: false, pagesCount: 1, functionBlocksCount: 2 };
const DISCOVERY = {
  blockTypeCount: 2,
  blockTypes: [{ type: 'Wallbox', displayName: 'Wallbox' }, { type: 'Unbekannt' }],
  modbusObjects: [{ uuid: 'u1', type: 'ModbusDev', properties: [] }],
  placedBlocks: [],
  errors: [{ what: 'get_tree', code: 'NOT_READY' }],
};

let fake: FakeConfigMcp | undefined;
let client: ConfigMcpClient | undefined;
afterEach(async () => {
  await client?.close();
  await fake?.stop();
  client = undefined;
  fake = undefined;
});

async function start(discovery: { value: unknown } | { error: string; message: string }) {
  fake = await startFakeConfigMcp({
    onQuery: (code) => (code === PROJECT_QUERY ? { value: PROJECT } : discovery),
    docs: { Wallbox: '<doc>Wallbox</doc>' },
  });
  client = createConfigMcpClient(fake.url, 'test');
  return { fake, client };
}

describe('runConfigDiscovery', () => {
  it('liest nur, sammelt Daten und Doku je gefundenem Bausteintyp', async () => {
    const { fake: f, client: c } = await start({ value: DISCOVERY });
    const res = ConfigDiscoveryResponseSchema.parse(
      await runConfigDiscovery(c, () => new Date('2026-11-16T10:00:00Z')),
    );
    expect(res.status.status).toBe('ok');
    expect(res.report).toMatchObject({
      generatedAt: '2026-11-16T10:00:00.000Z',
      project: PROJECT,
      summary: { blockTypes: 2, modbusObjects: 1, placedBlocks: 0, errors: 1 },
      docs: { Wallbox: '<doc>Wallbox</doc>', Unbekannt: 'Fehler: BAD_RESPONSE' },
    });
    expect(f.queries).toEqual([PROJECT_QUERY, DISCOVERY_QUERY]);
  });

  it('Doku zuerst für Wallbox, Wallbox Manager, Lastmanager; höchstens MAX_DOCS', () => {
    const many = Array.from({ length: 30 }, (_, i) => `Typ${i}`);
    const order = docOrder([...many, 'LoadShed', 'WBEM', 'Wallbox', 'Typ1']);
    expect(order.slice(0, 3)).toEqual(['Wallbox', 'WBEM', 'LoadShed']);
    expect(order).toHaveLength(MAX_DOCS);
    expect(new Set(order).size).toBe(MAX_DOCS);
    expect(docOrder(['A', 'EFM'])).toEqual(['EFM', 'A']);
  });

  it('nur lesende cfg-Aufrufe im Skript', () => {
    const calls = [...DISCOVERY_QUERY.matchAll(/cfg\.(\w+)\(/g)].map((m) => m[1]);
    expect(new Set(calls)).toEqual(
      new Set([
        'get_block_types',
        'get_insertable_types',
        'get_block_properties',
        'get_property_options',
        'get_tree',
        'get_block_index',
        'get_block',
        'get_block_data',
      ]),
    );
  });

  it('Skript läuft gegen ein nachgebildetes cfg (Felder laut sdk_describe)', () => {
    const conn = (key: string) => ({ key, name: key, dataType: 'analog', direction: 'in' });
    const cfg = {
      get_block_types: () => ({
        blockTypes: [
          {
            type: 'Wallbox',
            displayName: 'Wallbox',
            category: 'Energie',
            description: '',
            connectors: { inputs: [conn('I1')], outputs: [conn('Q1')], parameters: [] },
          },
          {
            type: 'And',
            displayName: 'AND',
            category: 'Logik',
            description: '',
            connectors: { inputs: [], outputs: [], parameters: [] },
          },
        ],
      }),
      get_insertable_types: () => ({
        types: [
          {
            type: 'ModbusDev',
            displayName: 'Modbus Gerät',
            group: 'Modbus',
            needsInteraction: false,
            variants: [],
          },
        ],
        coveredGroups: ['Modbus'],
      }),
      get_tree: () => ({
        roots: [
          {
            name: 'Miniserver',
            uuid: 'ms',
            type: 'Miniserver',
            childCount: 1,
            children: [
              { name: 'Wallbox 1', uuid: 'md', type: 'ModbusDev', childCount: 0, children: [] },
            ],
          },
        ],
      }),
      get_block_properties: ({ uuid }: { uuid: string }) => {
        if (uuid === 'wb') throw Object.assign(new Error('nope'), { code: 'NOT_FOUND' });
        return {
          properties: [
            { id: 1, name: 'Geräteadresse', type: 'int', editable: true, value: 3 },
            { id: 2, name: 'Befehl', type: 'enum', editable: true, value: 0, optionCount: 2 },
          ],
        };
      },
      get_property_options: () => ({ property: { options: ['a', 'b'] } }),
      get_block_index: () => ({
        blocks: [
          { uuid: 'wb', type: 'Wallbox', title: 'WB', page: 'S1' },
          { uuid: 'x', type: 'And', title: 'A' },
        ],
      }),
      get_block_data: () => ({ dataContract: true, current: { loads: [] } }),
      get_block: () => ({
        block: {
          configState: { isConfigured: false },
          connectors: { inputs: [conn('I1')], outputs: [], parameters: [] },
        },
      }),
    };
    const run = new Function('cfg', DISCOVERY_QUERY) as (c: typeof cfg) => {
      blockTypes: Array<{ type: string }>;
      modbusObjects: Array<{ path: string; properties: Array<{ options?: unknown }> }>;
      placedBlocks: Array<{ type: string; properties?: unknown; blockData?: unknown }>;
      errors: Array<{ what: string; code: string }>;
    };
    const r = run(cfg);
    expect(r.blockTypes.map((t) => t.type)).toEqual(['Wallbox']);
    expect(r.modbusObjects[0]?.path).toBe('Miniserver / Wallbox 1');
    expect(r.modbusObjects[0]?.properties[1]?.options).toEqual(['a', 'b']);
    expect(r.placedBlocks).toMatchObject([
      { type: 'Wallbox', properties: undefined, blockData: { current: { loads: [] } } },
    ]);
    expect(r.errors).toEqual([
      { what: 'get_block_properties wb', code: 'NOT_FOUND', message: 'nope' },
    ]);
  });

  it('ohne Verbindung nur Status, Skriptfehler als Status', async () => {
    expect(await runConfigDiscovery(undefined)).toMatchObject({
      status: { status: 'not_configured' },
      report: null,
    });
    const { client: c } = await start({ error: 'TIMEOUT', message: 'zu lang' });
    expect(await runConfigDiscovery(c)).toMatchObject({
      status: { status: 'error', message: 'Erkundung fehlgeschlagen (TIMEOUT): zu lang' },
      report: null,
    });
  });

  it('Verbindung bricht während der Erkundung ab', async () => {
    const stub: ConfigMcpClient = {
      serverInfo: () => Promise.resolve({ name: 'n', version: 'v' }),
      describeSdk: async () => (await import('./fake-server')).FAKE_DECLARATIONS,
      query: (code) =>
        code === PROJECT_QUERY ? Promise.resolve(PROJECT) : Promise.reject(new TypeError('x')),
      getDoc: () => Promise.resolve(''),
      close: () => Promise.resolve(),
    };
    expect((await runConfigDiscovery(stub)).status.status).toBe('error');
    const { ConfigMcpUnreachableError } = await import('./client');
    stub.query = (code) =>
      code === PROJECT_QUERY
        ? Promise.resolve(PROJECT)
        : Promise.resolve({ blockTypes: [{ type: 'Wallbox' }] });
    stub.getDoc = () => Promise.reject(new ConfigMcpUnreachableError('weg'));
    expect((await runConfigDiscovery(stub)).status.status).toBe('unreachable');
  });
});

describe('GET /api/config/discovery', () => {
  it('verlangt Token und liefert den Bericht', async () => {
    const { client: c } = await start({ value: DISCOVERY });
    const ctx = await makeServer({ configMcp: c });
    try {
      expect(
        (await ctx.app.inject({ method: 'GET', url: '/api/config/discovery' })).statusCode,
      ).toBe(401);
      const res = await ctx.app.inject({
        method: 'GET',
        url: '/api/config/discovery',
        headers: { authorization: `Bearer ${await pairedToken(ctx)}` },
      });
      expect(ConfigDiscoveryResponseSchema.parse(res.json()).report?.summary.modbusObjects).toBe(1);
    } finally {
      await ctx.app.close();
      client = undefined;
    }
  });
});
