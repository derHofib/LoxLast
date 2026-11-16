import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WallboxModel } from '@lastplan/wallbox-library';
import { buildHandoverPlan } from '@lastplan/loxone-export';
import { resetToBundledLibrary, useLibraryStore } from '../library/libraryStore';
import { useChecksStore } from '../state/checksStore';
import { useProjectStore } from '../state/projectStore';
import { sampleProject } from '../test-fixtures';
import { ConfigHandover, manualStepsText } from './ConfigHandover';
import { forgetGateway, useGatewayStore } from './gatewayStore';

/** Testmodell (kein reales Gerät): nur für die Abbildung auf Config. */
const reg = { scale: 1, unit: 'W', source: 'Test', byteOrder: 'big-endian' as const };
const MODEL: WallboxModel = {
  id: 'test/wallbox@1',
  vendor: 'Test',
  model: 'Testwallbox',
  firmware: { min: '1', max: null, source: 'Test' },
  protocols: ['modbus-tcp'],
  electrical: { minA: 6, maxA: 32, phases: [1, 3], phaseSwitching: false, source: 'Test' },
  modbus: {
    defaultPort: 502,
    defaultUnitId: 1,
    byteOrder: 'big-endian',
    registers: {
      setpointCurrent: { ...reg, address: 1, fn: 6, type: 'uint16', access: 'rw', unit: 'A' },
      power: { ...reg, address: 2, fn: 4, type: 'uint32', access: 'r' },
      energy: { ...reg, address: 4, fn: 4, type: 'uint32', access: 'r', unit: 'Wh' },
    },
    source: 'Test',
  },
  loxone: { functionBlock: 'Wallbox', inputs: {}, outputs: {}, source: 'Test' },
};

type Reply = { status: number; body: unknown };
let replies: Reply[] = [];
const fetchMock = vi.fn(async (...args: [string, RequestInit?]) => {
  void args;
  const r = replies.shift();
  if (!r) throw new TypeError('Failed to fetch');
  return { ok: r.status < 400, status: r.status, json: async () => r.body };
});

const STATUS = {
  status: 'ok',
  message: 'ok',
  missingMethods: [],
  project: { title: 'Test', modified: false, pagesCount: 1, functionBlocksCount: 0 },
  server: { name: 'LOXONE Config', version: '1.0.1' },
};

beforeEach(() => {
  replies = [];
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  forgetGateway();
  useGatewayStore.setState({
    session: {
      baseUrl: 'http://127.0.0.1:8787',
      token: 'token-1234567890',
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    },
  });
  useLibraryStore.setState({ models: new Map([[MODEL.id, MODEL]]) });
  useChecksStore.setState({ result: null });
  useProjectStore.getState().open(sampleProject());
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetToBundledLibrary();
});

const body = (n: number) => JSON.parse(String(fetchMock.mock.calls[n]![1]?.body)) as unknown;

describe('ConfigHandover', () => {
  it('Vorschau, Anlegen, Ergebnis mit Nacharbeit, Rückgängig und Speichern', async () => {
    const user = userEvent.setup();
    render(<ConfigHandover serverVersion="1.0.1" />);
    expect(screen.getByText(/Seite „LastPlan – Testanlage \[lastplan:/)).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Voraussetzungen' }).textContent).toContain(
      '192.168.10.21:502',
    );
    replies = [
      {
        status: 200,
        body: {
          status: STATUS,
          result: {
            created: { page: 'p', site: 'u1', x: 'u2' },
            validation: {
              valid: false,
              issues: [
                { rule: 'UNCONFIGURED_CONTROL', severity: 'warning', message: 'Lasttabelle leer' },
              ],
            },
          },
          failure: null,
        },
      },
    ];
    await user.click(screen.getByRole('button', { name: 'In Config anlegen' }));
    expect(await screen.findByText('3 Objekte angelegt')).toBeTruthy();
    expect(screen.getByText(/0 Fehler, 1 Hinweise/)).toBeTruthy();
    expect(screen.getByText('Nacharbeit in Config')).toBeTruthy();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://127.0.0.1:8787/api/config/handover');
    expect(init?.method).toBe('POST');
    const sent = body(0) as {
      plan: { pageName: string; loadManagers: unknown[]; replace: boolean };
    };
    expect(sent.plan.pageName).toMatch(/^LastPlan – Testanlage \[lastplan:/);
    expect(sent.plan.replace).toBe(false);
    expect(sent.plan.loadManagers).toHaveLength(2);
    expect(sent.plan).not.toHaveProperty('manualSteps');
    const history = useProjectStore.getState().project!.exportHistory;
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ mode: 'project', configVersion: '1.0.1' });
    // ältere Gateway-Antwort ohne pages/periphery: Vorgaben greifen
    expect(history[0]?.config).toEqual({ pages: [], periphery: [] });

    replies = [
      { status: 200, body: { saved: true, message: 'Projekt in Loxone Config gespeichert.' } },
    ];
    await user.click(screen.getByRole('button', { name: 'In Config speichern' }));
    expect(await screen.findByText('Projekt in Loxone Config gespeichert.')).toBeTruthy();
    expect(fetchMock.mock.calls[1]![0]).toBe('http://127.0.0.1:8787/api/config/save');
    expect(body(1)).toEqual({});

    replies = [
      {
        status: 200,
        body: { success: true, canUndo: true, canRedo: true, message: 'Rückgängig gemacht.' },
      },
    ];
    await user.click(screen.getByRole('button', { name: 'Rückgängig in Config' }));
    expect(await screen.findByText('Rückgängig gemacht.')).toBeTruthy();
    expect(screen.queryByText('3 Objekte angelegt')).toBeNull();
  });

  it('Seite gibt es schon: Hinweis, Ersetzen schickt replace und die UUIDs des letzten Laufs', async () => {
    const user = userEvent.setup();
    render(<ConfigHandover />);
    const done = (outcome: string, extra: Record<string, unknown>) => ({
      status: 200,
      body: { status: STATUS, failure: null, result: { outcome, ...extra } },
    });
    replies = [
      done('created', {
        created: { page: 'p1' },
        pages: ['p1', 'p1b'],
        periphery: ['vi1'],
        validation: { valid: true, issues: [] },
      }),
    ];
    await user.click(screen.getByRole('button', { name: 'In Config anlegen' }));
    expect(await screen.findByText('1 Objekte angelegt')).toBeTruthy();
    const sent = body(0) as { plan: { pageName: string; pageMatch: string } };

    replies = [
      done('exists', {
        existingPages: [{ name: sent.plan.pageName, uuid: 'p1' }],
        created: {},
        validation: null,
      }),
    ];
    await user.click(screen.getByRole('button', { name: 'In Config anlegen' }));
    expect(await screen.findByText('Seite gibt es schon in Config')).toBeTruthy();
    expect(
      screen.getByText(/Struktur des Projekts ist seit dieser Übergabe unverändert/),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Rückgängig in Config' })).toBeNull();
    expect(useProjectStore.getState().project!.exportHistory).toHaveLength(1);
    expect((body(1) as { plan: { previous: unknown } }).plan.previous).toEqual({
      pages: ['p1', 'p1b'],
      periphery: ['vi1'],
    });

    replies = [
      done('replaced', {
        existingPages: [{ name: sent.plan.pageName, uuid: 'p1' }],
        created: { page: 'p2', site: 'u1' },
        pages: ['p2'],
        periphery: ['vi2'],
        removed: 7,
        validation: { valid: true, issues: [] },
      }),
    ];
    await user.click(screen.getByRole('button', { name: 'Seite ersetzen' }));
    expect(await screen.findByText(/Alte Seite ersetzt, 7 Objekte entfernt/)).toBeTruthy();
    expect((body(2) as { plan: { replace: boolean } }).plan.replace).toBe(true);
    const history = useProjectStore.getState().project!.exportHistory;
    expect(history).toHaveLength(2);
    expect(history[1]?.config).toEqual({ pages: ['p2'], periphery: ['vi2'] });
  });

  it('Abbruch im Skript: Meldung und Rückgängig-Angebot', async () => {
    const user = userEvent.setup();
    render(<ConfigHandover />);
    replies = [
      {
        status: 200,
        body: {
          status: STATUS,
          result: null,
          failure: {
            code: 'SCRIPT_ERROR',
            message: 'Modbusserver fehlt in Config: 192.168.10.21:502',
            undoRecommended: true,
          },
        },
      },
    ];
    await user.click(screen.getByRole('button', { name: 'In Config anlegen' }));
    expect(await screen.findByText(/Modbusserver fehlt in Config/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Rückgängig in Config' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'In Config speichern' })).toBeNull();
    expect(useProjectStore.getState().project!.exportHistory).toHaveLength(0);

    replies = [];
    await user.click(screen.getByRole('button', { name: 'In Config anlegen' }));
    expect(await screen.findByText(/nicht erreichbar/)).toBeTruthy();
  });

  it('gesperrt bei TODO in der Bibliothek', () => {
    resetToBundledLibrary();
    render(<ConfigHandover />);
    expect(screen.getByRole('list', { name: 'Gründe für die Sperre' }).textContent).toContain(
      'fehlt in der Bibliothek',
    );
    expect(
      (screen.getByRole('button', { name: 'In Config anlegen' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('Abhak-Liste als Text', () => {
    const plan = buildHandoverPlan(sampleProject(), new Map([[MODEL.id, MODEL]]));
    const text = manualStepsText(plan);
    expect(text).toContain('LM_UV-TG1');
    expect(text).toContain('  [ ] Last 1:');
  });
});
