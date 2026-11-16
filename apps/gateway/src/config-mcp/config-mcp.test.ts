import { afterEach, describe, expect, it } from 'vitest';
import { ConfigMcpStatusResponseSchema } from '@lastplan/protocol';
import { loadConfig } from '../config';
import { makeServer, pairedToken } from '../test-helpers';
import {
  ConfigMcpError,
  ConfigMcpUnreachableError,
  createConfigMcpClient,
  parseConfigMcpUrl,
  parseScriptResult,
  type ConfigMcpClient,
} from './client';
import { FAKE_DECLARATIONS, startFakeConfigMcp, type FakeConfigMcp } from './fake-server';
import { checkConfigMcp, findMissingMethods, PROJECT_QUERY, REQUIRED_SDK_METHODS } from './status';

const PROJECT = { title: 'Testprojekt', modified: false, pagesCount: 3, functionBlocksCount: 12 };

let fake: FakeConfigMcp | undefined;
let client: ConfigMcpClient | undefined;
afterEach(async () => {
  await client?.close();
  await fake?.stop();
  client = undefined;
  fake = undefined;
});

describe('parseConfigMcpUrl', () => {
  it('nimmt nur Loopback-Adressen an', () => {
    expect(parseConfigMcpUrl('http://127.0.0.1:57707/mcp').port).toBe('57707');
    expect(parseConfigMcpUrl('http://localhost:57707/x').hostname).toBe('localhost');
    expect(parseConfigMcpUrl('http://[::1]:57707/').hostname).toBe('[::1]');
    expect(() => parseConfigMcpUrl('http://192.168.1.20:57707/')).toThrow(/auf diesen Rechner/);
    expect(() => parseConfigMcpUrl('ftp://127.0.0.1/')).toThrow(/http/);
    expect(() => parseConfigMcpUrl('kein url')).toThrow(/keine gültige Adresse/);
  });

  it('loadConfig: Standardadresse, „off“ schaltet ab, ungültig bricht ab', () => {
    const base = { GATEWAY_SECRET_KEY: 'a'.repeat(64) };
    expect(loadConfig(base).configMcpUrl?.href).toBe('http://127.0.0.1:57707/mcp');
    expect(loadConfig({ ...base, CONFIG_MCP_URL: 'off' }).configMcpUrl).toBeUndefined();
    expect(
      loadConfig({ ...base, CONFIG_MCP_URL: 'http://127.0.0.1:57707/mcp' }).configMcpUrl?.href,
    ).toBe('http://127.0.0.1:57707/mcp');
    expect(() => loadConfig({ ...base, CONFIG_MCP_URL: 'http://10.0.0.5:57707/' })).toThrow(
      /auf diesen Rechner/,
    );
  });
});

describe('parseScriptResult', () => {
  const text = (v: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(v) }] });
  it('liefert value aus Text oder structuredContent', () => {
    expect(parseScriptResult(text({ value: 42, logs: [] }))).toBe(42);
    expect(parseScriptResult({ structuredContent: { value: 'x', logs: [] } })).toBe('x');
  });
  it('Fehler des Skripts mit Code', () => {
    expect(() =>
      parseScriptResult(text({ success: false, error: 'NO_DOCUMENT', message: 'm' })),
    ).toThrow(expect.objectContaining({ code: 'NO_DOCUMENT' }) as Error);
    expect(() =>
      parseScriptResult({ content: [{ type: 'text', text: 'kaputt' }], isError: true }),
    ).toThrow(expect.objectContaining({ code: 'TOOL_ERROR' }) as Error);
  });
  it('unerwartete Antworten', () => {
    expect(() => parseScriptResult({ content: [] })).toThrow(/ohne Inhalt/);
    expect(() => parseScriptResult({ content: [{ type: 'text', text: 'kein json' }] })).toThrow(
      /kein JSON/,
    );
    expect(() => parseScriptResult(text(5))).toThrow(/kein erwartetes Format/);
    expect(() => parseScriptResult(text({ logs: [] }))).toThrow(/ohne „value“/);
  });
});

describe('findMissingMethods', () => {
  it('erkennt alle benötigten Methoden in den Deklarationen', () => {
    expect(findMissingMethods(FAKE_DECLARATIONS)).toEqual([]);
  });
  it('meldet fehlende Methoden', () => {
    const without = FAKE_DECLARATIONS.replace(/\s*insert_object\(.*\n/, '\n');
    expect(findMissingMethods(without)).toEqual(['insert_object']);
    expect(findMissingMethods('')).toEqual([...REQUIRED_SDK_METHODS]);
  });
});

describe('checkConfigMcp gegen den MCP-Fake (echtes Streamable HTTP)', () => {
  it('ok: Projekt geöffnet, nur lesende Abfragen', async () => {
    fake = await startFakeConfigMcp({ onQuery: () => ({ value: PROJECT }) });
    client = createConfigMcpClient(fake.url, 'test');
    const res = ConfigMcpStatusResponseSchema.parse(await checkConfigMcp(client));
    expect(res).toMatchObject({
      status: 'ok',
      project: PROJECT,
      server: { name: 'loxone-config', version: 'fake' },
    });
    expect(res.message).toContain('„Testprojekt“');
    expect(fake.queries).toEqual([PROJECT_QUERY]);
  });

  it('kein Projekt geöffnet', async () => {
    fake = await startFakeConfigMcp({
      onQuery: () => ({ error: 'NO_DOCUMENT', message: 'no project open' }),
    });
    client = createConfigMcpClient(fake.url, 'test');
    expect((await checkConfigMcp(client)).status).toBe('no_document');
  });

  it('Server startet gerade (NOT_READY) und andere Fehler', async () => {
    let code = 'NOT_READY';
    fake = await startFakeConfigMcp({ onQuery: () => ({ error: code, message: 'x' }) });
    client = createConfigMcpClient(fake.url, 'test');
    expect(await checkConfigMcp(client)).toMatchObject({
      status: 'unreachable',
      message: expect.stringContaining('gleich noch einmal') as string,
    });
    code = 'SCRIPT_ERROR';
    expect(await checkConfigMcp(client)).toMatchObject({
      status: 'error',
      message: expect.stringContaining('SCRIPT_ERROR') as string,
    });
  });

  it('fehlende SDK-Methode sperrt die Übergabe', async () => {
    fake = await startFakeConfigMcp({
      declarations: FAKE_DECLARATIONS.replace(/\s*connect_blocks\(.*\n/, '\n'),
    });
    client = createConfigMcpClient(fake.url, 'test');
    const res = await checkConfigMcp(client);
    expect(res).toMatchObject({ status: 'methods_missing', missingMethods: ['connect_blocks'] });
    expect(fake.queries).toEqual([]);
  });

  it('unerwartete Projektdaten', async () => {
    fake = await startFakeConfigMcp({ onQuery: () => ({ value: { title: 1 } }) });
    client = createConfigMcpClient(fake.url, 'test');
    expect((await checkConfigMcp(client)).status).toBe('error');
  });

  it('nicht erreichbar, danach erneuter Verbindungsversuch', async () => {
    fake = await startFakeConfigMcp({ onQuery: () => ({ value: PROJECT }) });
    const url = fake.url;
    await fake.stop();
    client = createConfigMcpClient(url, 'test');
    expect((await checkConfigMcp(client)).status).toBe('unreachable');
    await expect(client.query('1')).rejects.toBeInstanceOf(ConfigMcpUnreachableError);
  });

  it('nicht eingerichtet', async () => {
    expect((await checkConfigMcp(undefined)).status).toBe('not_configured');
  });
});

describe('checkConfigMcp mit Fehlern beim Aufruf', () => {
  const stub = (over: Partial<ConfigMcpClient>): ConfigMcpClient => ({
    serverInfo: () => Promise.resolve({ name: 'n', version: 'v' }),
    describeSdk: () => Promise.resolve(FAKE_DECLARATIONS),
    query: () => Promise.resolve(PROJECT),
    getDoc: () => Promise.resolve(''),
    close: () => Promise.resolve(),
    ...over,
  });
  it('Verbindung bricht beim Werkzeugaufruf ab', async () => {
    const c = stub({ describeSdk: () => Promise.reject(new ConfigMcpUnreachableError('weg')) });
    expect(await checkConfigMcp(c)).toMatchObject({ status: 'unreachable', server: { name: 'n' } });
  });
  it('unbekannter Fehler', async () => {
    const c = stub({ query: () => Promise.reject(new Error('boom')) });
    expect(await checkConfigMcp(c)).toMatchObject({
      status: 'error',
      message: 'Loxone Config hat einen Fehler gemeldet.',
    });
  });
  it('sdk_describe ohne Text', async () => {
    const c = stub({ describeSdk: () => Promise.reject(new ConfigMcpError('BAD_RESPONSE', 'x')) });
    expect((await checkConfigMcp(c)).status).toBe('error');
  });
});

describe('GET /api/config/status', () => {
  it('verlangt Token und liefert den Status', async () => {
    fake = await startFakeConfigMcp({ onQuery: () => ({ value: PROJECT }) });
    client = createConfigMcpClient(fake.url, 'test');
    const ctx = await makeServer({ configMcp: client });
    try {
      const anon = await ctx.app.inject({ method: 'GET', url: '/api/config/status' });
      expect(anon.statusCode).toBe(401);
      const res = await ctx.app.inject({
        method: 'GET',
        url: '/api/config/status',
        headers: { authorization: `Bearer ${await pairedToken(ctx)}` },
      });
      expect(res.statusCode).toBe(200);
      expect(ConfigMcpStatusResponseSchema.parse(res.json()).status).toBe('ok');
    } finally {
      await ctx.app.close();
      client = undefined; // schließt der Server beim Beenden
    }
  });

  it('ohne Einrichtung: not_configured', async () => {
    const ctx = await makeServer({});
    try {
      const res = await ctx.app.inject({
        method: 'GET',
        url: '/api/config/status',
        headers: { authorization: `Bearer ${await pairedToken(ctx)}` },
      });
      expect(res.json()).toMatchObject({ status: 'not_configured' });
    } finally {
      await ctx.app.close();
    }
  });
});
