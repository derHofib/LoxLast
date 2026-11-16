import { afterEach, describe, expect, it } from 'vitest';
import {
  ConfigHandoverResponseSchema,
  ConfigSaveResponseSchema,
  ConfigUndoResponseSchema,
  type ConfigHandoverPlan,
} from '@lastplan/protocol';
import { renderHandoverScript } from '@lastplan/loxone-export';
import { makeServer, pairedToken } from '../test-helpers';
import type { ConfigMcpError } from './client';
import {
  ConfigMcpUnreachableError,
  createConfigMcpClient,
  parseToolObject,
  type ConfigMcpClient,
} from './client';
import { startFakeConfigMcp, type FakeConfigMcp } from './fake-server';
import { runConfigHandover, saveConfig, undoConfig } from './handover';
import { PROJECT_QUERY } from './status';

const PROJECT = { title: 'Testprojekt', modified: false, pagesCount: 1, functionBlocksCount: 0 };

const PLAN: ConfigHandoverPlan = {
  pageName: 'LastPlan – Test [lastplan:0123456789ab:1a2b3c4d]',
  pageMatch: '[lastplan:0123456789ab:',
  replace: false,
  previous: { pages: [], periphery: [] },
  pages: [
    { key: 'site', name: 'Standort – Test [lastplan:0123456789ab:1a2b3c4d]' },
    { key: 'group:g1', name: 'A · G1 B' },
  ],
  loadManagers: [{ key: 'site', title: 'LM_Standort', maxKw: 117.3, page: 'site' }],
  wallboxManagers: [
    { key: 'group:g1', title: 'LIM_A_B', parent: { key: 'site', slot: 1 }, page: 'group:g1' },
  ],
  wallboxes: [{ key: 'cp:c1', title: 'WB_LP01', maxKw: 11.04, minKw: 4.14, page: 'group:g1' }],
  virtualInputs: [
    {
      key: 'vi:site',
      name: 'LM_Standort Limit (kW) – 170 A',
      target: { key: 'site', connector: 'maxP' },
      page: 'site',
    },
  ],
  modbusDevices: [],
};

const RESULT = {
  outcome: 'created',
  existingPages: [],
  created: { page: 'p', site: 'u1' },
  pages: ['p'],
  periphery: ['u2'],
  removed: 0,
  validation: {
    valid: false,
    issues: [{ rule: 'UNCONFIGURED_CONTROL', severity: 'warning', message: 'x' }],
  },
};

let fake: FakeConfigMcp | undefined;
let client: ConfigMcpClient | undefined;
afterEach(async () => {
  await client?.close();
  await fake?.stop();
  client = undefined;
  fake = undefined;
});

async function start(opts: Parameters<typeof startFakeConfigMcp>[0] = {}) {
  fake = await startFakeConfigMcp({
    onQuery: (code) => (code === PROJECT_QUERY ? { value: PROJECT } : { value: null }),
    ...opts,
  });
  client = createConfigMcpClient(fake.url, 'test');
  return { fake, client };
}

describe('runConfigHandover', () => {
  it('erzeugt das Skript im Gateway und führt es mit code_run aus', async () => {
    const { fake: f, client: c } = await start({ onRun: () => ({ value: RESULT }) });
    const res = ConfigHandoverResponseSchema.parse(await runConfigHandover(c, PLAN));
    expect(res).toMatchObject({ status: { status: 'ok' }, result: RESULT, failure: null });
    expect(f.runs).toEqual([renderHandoverScript(PLAN)]);
    expect(f.queries).toEqual([PROJECT_QUERY]);
    expect(f.lifecycle).toEqual([]);
  });

  it('ohne geöffnetes Projekt: kein Lauf', async () => {
    const { fake: f, client: c } = await start({
      onQuery: () => ({ error: 'NO_DOCUMENT', message: 'kein Projekt' }),
    });
    expect(await runConfigHandover(c, PLAN)).toMatchObject({
      status: { status: 'no_document' },
      result: null,
      failure: null,
    });
    expect(f.runs).toEqual([]);
    expect(await runConfigHandover(undefined, PLAN)).toMatchObject({
      status: { status: 'not_configured' },
    });
  });

  it('Skriptfehler: Rückgängig empfohlen, außer wenn nichts geändert wurde', async () => {
    let code = 'SCRIPT_ERROR';
    const { client: c } = await start({
      onRun: () => ({ error: code, message: 'Modbusserver fehlt in Config: 10.0.0.1:502' }),
    });
    expect((await runConfigHandover(c, PLAN)).failure).toEqual({
      code: 'SCRIPT_ERROR',
      message: 'Modbusserver fehlt in Config: 10.0.0.1:502',
      undoRecommended: true,
    });
    code = 'NOT_READY';
    expect((await runConfigHandover(c, PLAN)).failure?.undoRecommended).toBe(false);
  });

  it('unerwartete Antwort und abgebrochene Verbindung', async () => {
    const { client: c } = await start({ onRun: () => ({ value: { created: 5 } }) });
    expect((await runConfigHandover(c, PLAN)).failure).toMatchObject({
      code: 'BAD_RESPONSE',
      undoRecommended: true,
    });
    const base: ConfigMcpClient = {
      serverInfo: () => Promise.resolve({ name: 'n', version: 'v' }),
      describeSdk: () => c.describeSdk(),
      query: () => Promise.resolve(PROJECT),
      getDoc: () => Promise.resolve(''),
      run: () => Promise.reject(new ConfigMcpUnreachableError('weg')),
      undo: () => Promise.resolve({ canUndo: false, canRedo: false }),
      save: () => Promise.resolve(),
      close: () => Promise.resolve(),
    };
    expect(await runConfigHandover(base, PLAN)).toMatchObject({
      status: { status: 'unreachable' },
      failure: { code: 'UNREACHABLE', undoRecommended: true },
    });
    const odd = { ...base, run: () => Promise.reject(new Error('boom')) };
    expect((await runConfigHandover(odd, PLAN)).failure).toMatchObject({ code: 'ERROR' });
  });
});

describe('Rückgängig und Speichern', () => {
  it('undo meldet den Stand, NOTHING_TO_UNDO verständlich', async () => {
    let reply: Record<string, unknown> = { success: true, canUndo: true, canRedo: true };
    const { fake: f, client: c } = await start({ onUndo: () => reply });
    expect(ConfigUndoResponseSchema.parse(await undoConfig(c))).toMatchObject({
      success: true,
      canUndo: true,
    });
    reply = {
      success: false,
      error: 'NOTHING_TO_UNDO',
      message: 'n',
      canUndo: false,
      canRedo: true,
    };
    expect(await undoConfig(c)).toEqual({
      success: false,
      canUndo: false,
      canRedo: true,
      message: 'In Config gibt es nichts mehr rückgängig zu machen.',
    });
    reply = { success: false, error: 'UNDO_GROUP_ACTIVE', message: 'läuft' };
    expect((await undoConfig(c)).message).toBe('läuft (UNDO_GROUP_ACTIVE)');
    expect(f.lifecycle).toEqual(['undo', 'undo', 'undo']);
    expect((await undoConfig(undefined)).success).toBe(false);
  });

  it('save_project, auch ohne Speicherort', async () => {
    let reply: Record<string, unknown> = { success: true };
    const { client: c } = await start({ onSave: () => reply });
    expect(ConfigSaveResponseSchema.parse(await saveConfig(c))).toEqual({
      saved: true,
      message: 'Projekt in Loxone Config gespeichert.',
    });
    reply = { success: false, error: 'NEEDS_INTERACTION', message: 'path' };
    expect((await saveConfig(c)).message).toContain('Speichern unter');
    reply = { success: false, error: 'READ_ONLY', message: 'nein' };
    expect(await saveConfig(c)).toEqual({ saved: false, message: 'nein (READ_ONLY)' });
    expect((await saveConfig(undefined)).saved).toBe(false);
  });

  it('parseToolObject: Text ohne JSON', () => {
    expect(() =>
      parseToolObject({ content: [{ type: 'text', text: 'kaputt' }], isError: true }),
    ).toThrow(expect.objectContaining({ code: 'TOOL_ERROR', message: 'kaputt' }) as ConfigMcpError);
    expect(parseToolObject({ structuredContent: { success: true, canUndo: true } })).toEqual({
      success: true,
      canUndo: true,
    });
    expect(parseToolObject({ content: [] })).toEqual({});
  });
});

describe('POST /api/config/handover, /undo, /save', () => {
  it('verlangt Token und gültigen Plan, protokolliert ohne Namen', async () => {
    const { client: c } = await start({ onRun: () => ({ value: RESULT }) });
    const ctx = await makeServer({ configMcp: c });
    try {
      const anon = await ctx.app.inject({
        method: 'POST',
        url: '/api/config/handover',
        payload: { plan: PLAN },
      });
      expect(anon.statusCode).toBe(401);
      const headers = { authorization: `Bearer ${await pairedToken(ctx)}` };
      const bad = await ctx.app.inject({
        method: 'POST',
        url: '/api/config/handover',
        headers,
        payload: {
          plan: {
            ...PLAN,
            virtualInputs: [{ ...PLAN.virtualInputs[0], target: { key: 'site', connector: 'Q' } }],
          },
        },
      });
      expect(bad.statusCode).toBe(400);
      expect(bad.body).toContain('virtualInputs.0.target.connector');
      const ok = await ctx.app.inject({
        method: 'POST',
        url: '/api/config/handover',
        headers,
        payload: { plan: PLAN },
      });
      expect(ok.statusCode).toBe(200);
      expect(ConfigHandoverResponseSchema.parse(ok.json()).result).toEqual(RESULT);
      const undo = await ctx.app.inject({ method: 'POST', url: '/api/config/undo', headers });
      expect(ConfigUndoResponseSchema.parse(undo.json()).success).toBe(true);
      const save = await ctx.app.inject({ method: 'POST', url: '/api/config/save', headers });
      expect(ConfigSaveResponseSchema.parse(save.json()).saved).toBe(true);
      const log = ctx.changelog.list({ limit: 10 }).map((e) => [e.action, e.after]);
      expect(log).toContainEqual([
        'config.handover',
        { outcome: 'created', created: 2, removed: 0, valid: false, failure: null },
      ]);
      expect(log.map(([a]) => a)).toEqual(expect.arrayContaining(['config.undo', 'config.save']));
      expect(JSON.stringify(log)).not.toContain('LM_Standort');
    } finally {
      await ctx.app.close();
      client = undefined;
    }
  });
});
