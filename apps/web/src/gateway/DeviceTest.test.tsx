import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeviceTestResponse } from '@lastplan/protocol';
import { ChargePointsView } from '../features/chargepoints/ChargePointsView';
import { TEST_MODEL_ID, testLibrary } from '../features/chargepoints/testLibrary';
import { useEditorStore } from '../state/editorStore';
import { useProjectStore } from '../state/projectStore';
import { sampleProject } from '../test-fixtures';
import { resetDeviceTests } from './deviceTestStore';
import { forgetGateway, normalizeGatewayUrl, useGatewayStore } from './gatewayStore';

const library = testLibrary();
const TOKEN = 'geheimes-token-1234567890';
const future = () => new Date(Date.now() + 3_600_000).toISOString();

type Reply = { status: number; body: unknown } | 'network-error';
let replies: Reply[] = [];
const fetchMock = vi.fn(async (...args: [string, RequestInit?]) => {
  void args;
  const r = replies.shift();
  if (!r || r === 'network-error') throw new TypeError('Failed to fetch');
  return { ok: r.status < 400, status: r.status, json: async () => r.body };
});

function setup(selected: number[] = [0]) {
  const p = sampleProject();
  p.chargePoints.forEach((cp) => (cp.libraryModelId = TEST_MODEL_ID));
  useProjectStore.getState().open(p);
  useEditorStore.getState().select(selected.map((i) => p.chargePoints[i]!.id));
  render(<ChargePointsView library={library} />);
  return p;
}

const info = () => screen.getByRole('complementary', { name: 'Infos' });
const paired = () =>
  useGatewayStore.setState({
    session: { baseUrl: 'http://127.0.0.1:8787', token: TOKEN, expiresAt: future() },
  });

function result(over: Partial<DeviceTestResponse>): DeviceTestResponse {
  return {
    outcome: 'ok',
    reachable: true,
    latencyMs: 18,
    values: {},
    firmware: null,
    readings: [],
    missing: [],
    message: null,
    modelSource: 'request',
    testedAt: '2026-11-16T10:00:00.000Z',
    ...over,
  };
}

beforeEach(() => {
  replies = [];
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  forgetGateway();
  resetDeviceTests();
  useProjectStore.getState().close();
  useEditorStore.getState().clearSelection();
});
afterEach(() => vi.unstubAllGlobals());

describe('Gateway koppeln', () => {
  it('ohne Kopplung: Hinweis, Button gesperrt; Koppeln speichert Token nur in der Sitzung', async () => {
    const user = userEvent.setup();
    setup();
    expect(screen.getByRole('button', { name: 'Verbindung testen' })).toHaveProperty(
      'disabled',
      true,
    );
    expect(within(info()).getByText('Gateway nicht gekoppelt')).toBeTruthy();
    await user.click(within(info()).getByRole('button', { name: 'Gateway koppeln' }));
    await user.type(within(info()).getByLabelText('Einmalcode'), 'abcd-2345');
    replies = [{ status: 200, body: { token: TOKEN, expiresAt: future() } }];
    await user.click(within(info()).getByRole('button', { name: 'Koppeln' }));

    expect(
      await within(info()).findByText(/Gekoppelt mit http:\/\/127\.0\.0\.1:8787/),
    ).toBeTruthy();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://127.0.0.1:8787/api/auth/pair');
    expect(JSON.parse(init!.body as string)).toEqual({ code: 'abcd-2345' });
    expect(sessionStorage.getItem('lastplan.gateway')).toContain(TOKEN);
    expect(localStorage.getItem('lastplan.gateway')).toBeNull();
    expect(screen.getByRole('button', { name: 'Verbindung testen' })).toHaveProperty(
      'disabled',
      false,
    );

    await user.click(within(info()).getByRole('button', { name: 'Entkoppeln' }));
    expect(sessionStorage.getItem('lastplan.gateway')).toBeNull();
    expect(within(info()).getByText('Gateway nicht gekoppelt')).toBeTruthy();
  });

  it('Fehler: Format, falscher Code, Gateway nicht erreichbar', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(within(info()).getByRole('button', { name: 'Gateway koppeln' }));
    const urlField = within(info()).getByLabelText('Gateway-Adresse');
    await user.clear(urlField);
    await user.type(urlField, 'ftp://x');
    await user.click(within(info()).getByRole('button', { name: 'Koppeln' }));
    expect(within(info()).getByText('Nur http:// oder https:// ist möglich.')).toBeTruthy();
    expect(within(info()).getByText(/Einmalcode im Format XXXX-XXXX/)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();

    await user.clear(urlField);
    await user.type(urlField, 'http://10.0.0.9:8787');
    await user.type(within(info()).getByLabelText('Einmalcode'), 'AAAA-BBBB');
    replies = [
      {
        status: 401,
        body: {
          error: { code: 'pairing_code_invalid', message: 'Code ungültig oder abgelaufen.' },
        },
      },
    ];
    await user.click(within(info()).getByRole('button', { name: 'Koppeln' }));
    expect(await within(info()).findByText('Code ungültig oder abgelaufen.')).toBeTruthy();

    replies = ['network-error'];
    await user.click(within(info()).getByRole('button', { name: 'Koppeln' }));
    expect(
      await within(info()).findByText(/Gateway unter http:\/\/10\.0\.0\.9:8787 nicht erreichbar/),
    ).toBeTruthy();
    expect(useGatewayStore.getState().session).toBeNull();
  });
});

describe('Verbindung testen', () => {
  it('Erfolg: Pill „Erreichbar · 18 ms“ und Werte mit Einheit; Anfrage mit Token und Modell', async () => {
    const user = userEvent.setup();
    paired();
    const p = setup();
    replies = [
      {
        status: 200,
        body: result({
          readings: [
            {
              role: 'currentL1',
              label: 'Strom L1',
              value: 16,
              unit: 'A',
              text: null,
              raw: [160],
              error: null,
            },
            {
              role: 'power',
              label: 'Leistung',
              value: 7360,
              unit: 'W',
              text: null,
              raw: [0, 7360],
              error: null,
            },
            {
              role: 'status',
              label: 'Status',
              value: 2,
              unit: '',
              text: 'lädt',
              raw: [2],
              error: null,
            },
          ],
        }),
      },
    ];
    await user.click(screen.getByRole('button', { name: 'Verbindung testen' }));
    expect(await within(info()).findByText('Erreichbar · 18 ms')).toBeTruthy();
    expect(within(info()).getByText(/^16\sA$/)).toBeTruthy();
    expect(within(info()).getByText(/^7\.360\sW$/)).toBeTruthy();
    expect(within(info()).getByText('2 (lädt)')).toBeTruthy();

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://127.0.0.1:8787/api/devices/test');
    expect((init!.headers as Record<string, string>)['Authorization']).toBe(`Bearer ${TOKEN}`);
    const body = JSON.parse(init!.body as string) as Record<string, unknown>;
    expect(body['endpoint']).toEqual(p.chargePoints[0]!.network);
    expect(body['libraryModelId']).toBe(TEST_MODEL_ID);
    expect((body['model'] as { id: string }).id).toBe(TEST_MODEL_ID);
  });

  it('nicht prüfbar: Warn-Pill, Text mit fehlenden Registern, Hinweis auf Nachtragen', async () => {
    const user = userEvent.setup();
    paired();
    setup();
    replies = [
      {
        status: 200,
        body: result({
          outcome: 'not_testable',
          latencyMs: 4,
          missing: ['modbus.registers.currentL1.address'],
          message: 'Nicht prüfbar: Register fehlen in der Bibliothek (Strom L1: Adresse).',
        }),
      },
    ];
    await user.click(screen.getByRole('button', { name: 'Verbindung testen' }));
    expect(await within(info()).findByText('Nicht prüfbar · Port erreichbar · 4 ms')).toBeTruthy();
    expect(
      within(info()).getByText(/Register fehlen in der Bibliothek \(Strom L1: Adresse\)/),
    ).toBeTruthy();
    expect(within(info()).getByText(/unten unter „Aus der Bibliothek“/)).toBeTruthy();
  });

  it('nicht erreichbar und Gerätefehler: Fehler-Pill mit Warndreieck', async () => {
    const user = userEvent.setup();
    paired();
    setup();
    replies = [
      {
        status: 200,
        body: result({
          outcome: 'unreachable',
          reachable: false,
          latencyMs: null,
          message: 'Verbindung zu 192.168.10.21:502 abgelehnt.',
        }),
      },
      {
        status: 200,
        body: result({ outcome: 'device_error', message: 'Gerät meldet Modbus-Ausnahme 0x02.' }),
      },
    ];
    await user.click(screen.getByRole('button', { name: 'Verbindung testen' }));
    const pill = await within(info()).findByText('Nicht erreichbar');
    expect(pill.closest('.lp-status--error')?.querySelector('svg')).toBeTruthy();
    expect(within(info()).getByText(/abgelehnt/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Verbindung testen' }));
    expect(await within(info()).findByText('Erreichbar, Gerät meldet Fehler · 18 ms')).toBeTruthy();
  });

  it('Token abgelaufen (401): Kopplung wird verworfen', async () => {
    const user = userEvent.setup();
    paired();
    setup();
    replies = [
      {
        status: 401,
        body: {
          error: { code: 'unauthorized', message: 'Token abgelaufen. Gateway neu koppeln.' },
        },
      },
    ];
    await user.click(screen.getByRole('button', { name: 'Verbindung testen' }));
    expect(await within(info()).findByText('Gateway nicht gekoppelt')).toBeTruthy();
    expect(useGatewayStore.getState().session).toBeNull();
  });

  it('Mehrfachauswahl: Test nur für einzelnen Ladepunkt', () => {
    paired();
    setup([0, 1]);
    expect(screen.getByRole('button', { name: 'Verbindung testen' })).toHaveProperty(
      'disabled',
      true,
    );
    expect(within(info()).getByText(/einen einzelnen Ladepunkt wählen/)).toBeTruthy();
  });
});

describe('normalizeGatewayUrl', () => {
  it('nur Schema, Host, Port', () => {
    expect(normalizeGatewayUrl(' http://127.0.0.1:8787/ ')).toBe('http://127.0.0.1:8787');
    expect(normalizeGatewayUrl('https://gw.example.de')).toBe('https://gw.example.de');
    for (const bad of ['127.0.0.1', 'http://a:b@x.de', 'http://x.de/api', 'http://x.de?a=1'])
      expect(typeof normalizeGatewayUrl(bad)).toBe('object');
  });
});
