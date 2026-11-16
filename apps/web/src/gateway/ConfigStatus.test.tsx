import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConfigMcpStatusResponse } from '@lastplan/protocol';
import { ConfigStatus } from './ConfigStatus';
import { forgetGateway, useGatewayStore } from './gatewayStore';

const TOKEN = 'geheimes-token-1234567890';
type Reply = { status: number; body: unknown } | 'network-error';
let replies: Reply[] = [];
const fetchMock = vi.fn(async (...args: [string, RequestInit?]) => {
  void args;
  const r = replies.shift();
  if (!r || r === 'network-error') throw new TypeError('Failed to fetch');
  return { ok: r.status < 400, status: r.status, json: async () => r.body };
});

const paired = () =>
  useGatewayStore.setState({
    session: {
      baseUrl: 'http://127.0.0.1:8787',
      token: TOKEN,
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    },
  });

const status = (over: Partial<ConfigMcpStatusResponse>): ConfigMcpStatusResponse => ({
  status: 'ok',
  message: 'Verbunden mit Loxone Config, Projekt „Test“ geöffnet.',
  missingMethods: [],
  project: { title: 'Test', modified: true, pagesCount: 2, functionBlocksCount: 7 },
  server: { name: 'loxone-config', version: '1' },
  ...over,
});

beforeEach(() => {
  replies = [];
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  forgetGateway();
});
afterEach(() => vi.unstubAllGlobals());

describe('ConfigStatus', () => {
  it('ohne Kopplung: Hinweis und Koppeln-Button', async () => {
    const user = userEvent.setup();
    render(<ConfigStatus />);
    expect(screen.getByText('Gateway nicht gekoppelt')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Gateway koppeln' }));
    expect(screen.getByLabelText('Einmalcode')).toBeTruthy();
  });

  it('prüft lesend und zeigt Projektdaten', async () => {
    const user = userEvent.setup();
    paired();
    replies = [{ status: 200, body: status({}) }];
    render(<ConfigStatus />);
    expect(screen.getByText(/Noch nicht geprüft/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Verbindung prüfen' }));
    expect(await screen.findByText('Config verbunden')).toBeTruthy();
    expect(screen.getByText('Test')).toBeTruthy();
    expect(screen.getByText('ja')).toBeTruthy();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://127.0.0.1:8787/api/config/status');
    expect(init?.method).toBe('GET');
    expect((init?.headers as Record<string, string>)['Authorization']).toBe(`Bearer ${TOKEN}`);
  });

  it('zeigt Status ohne Projekt, z. B. Methode fehlt', async () => {
    const user = userEvent.setup();
    paired();
    replies = [
      {
        status: 200,
        body: status({
          status: 'methods_missing',
          message: 'fehlt: insert_object',
          missingMethods: ['insert_object'],
          project: null,
        }),
      },
    ];
    render(<ConfigStatus />);
    await user.click(screen.getByRole('button', { name: 'Verbindung prüfen' }));
    expect(await screen.findByText('Config-Version passt nicht')).toBeTruthy();
    expect(screen.getByText('fehlt: insert_object')).toBeTruthy();
  });

  it('Gateway nicht erreichbar, ungültige Antwort, abgelaufenes Token', async () => {
    const user = userEvent.setup();
    paired();
    replies = ['network-error', { status: 200, body: { status: 'kaputt' } }];
    render(<ConfigStatus />);
    const button = screen.getByRole('button', { name: 'Verbindung prüfen' });
    await user.click(button);
    expect(await screen.findByText(/nicht erreichbar/)).toBeTruthy();
    await user.click(button);
    expect(await screen.findByText('Antwort des Gateways ist ungültig.')).toBeTruthy();
    replies = [
      { status: 401, body: { error: { code: 'unauthorized', message: 'Token ungültig.' } } },
    ];
    await user.click(button);
    expect(await screen.findByText('Gateway nicht gekoppelt')).toBeTruthy();
    expect(useGatewayStore.getState().session).toBeNull();
  });
});
