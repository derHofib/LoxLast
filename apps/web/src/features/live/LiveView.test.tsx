import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { forgetGateway, useGatewayStore } from '../../gateway/gatewayStore';
import { useProjectStore } from '../../state/projectStore';
import { sampleProject } from '../../test-fixtures';
import { LiveView, pillOf } from './LiveView';
import { applyUpdate, initialLiveState, resetLive, useLiveStore } from './liveStore';
import { wsUrl } from './gatewaySource';

class FakeSocket {
  static last: FakeSocket | null = null;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(readonly url: string) {
    FakeSocket.last = this;
  }
  send(d: string) {
    this.sent.push(d);
  }
  close() {}
}

const pair = () =>
  useGatewayStore.setState({
    session: {
      baseUrl: 'http://127.0.0.1:8787',
      token: 'geheimes-token-1234567890',
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    },
  });

beforeEach(() => {
  vi.stubGlobal('WebSocket', FakeSocket);
  FakeSocket.last = null;
  forgetGateway();
  resetLive();
  useProjectStore.getState().open(sampleProject());
});
afterEach(() => vi.unstubAllGlobals());

const send = (m: unknown) => act(() => FakeSocket.last!.onmessage!({ data: JSON.stringify(m) }));

describe('Live-Ansicht', () => {
  it('zeigt ohne Kopplung den leeren Zustand mit Anleitung', () => {
    render(<LiveView />);
    expect(screen.getByText('Gateway nicht gekoppelt')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Noch keine Live-Werte' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Gateway koppeln' })).toBeTruthy();
  });

  it('meldet sich per auth an und zeigt Werte, Kennzahlen und Störung', () => {
    pair();
    render(<LiveView />);
    const ws = FakeSocket.last!;
    expect(ws.url).toBe('ws://127.0.0.1:8787/ws');
    act(() => ws.onopen!());
    expect(JSON.parse(ws.sent[0]!)).toEqual({ type: 'auth', token: 'geheimes-token-1234567890' });
    const pid = useProjectStore.getState().project!.id;
    send({ type: 'ready', serverTime: new Date().toISOString() });
    send({ type: 'miniserver.state', status: { state: 'connected', lastValuesAt: null } });
    const at = new Date().toISOString();
    send({
      type: 'live.update',
      projectId: pid,
      at,
      chargePoint: {
        label: 'LP01',
        status: null,
        setpointA: 10,
        currentA: [10, 10, 10],
        powerKw: 6.9,
        fault: false,
      },
    });
    send({
      type: 'live.update',
      projectId: pid,
      at,
      chargePoint: {
        label: 'LP02',
        status: null,
        setpointA: null,
        currentA: [null, null, null],
        powerKw: null,
        fault: true,
      },
    });
    send({
      type: 'live.update',
      projectId: 'anderes-projekt',
      at,
      chargePoint: {
        label: 'LP99',
        status: null,
        setpointA: 6,
        currentA: [6, 6, 6],
        powerKw: 4,
        fault: false,
      },
    });
    expect(screen.getByText('Verbunden')).toBeTruthy();
    expect(screen.getByText('LP01')).toBeTruthy();
    expect(screen.queryByText('LP99')).toBeNull();
    expect(screen.getAllByText('Störung').length).toBe(2);
    expect(screen.getByText('Gesamtleistung').nextSibling?.textContent).toContain('6,9');
  });

  it('markiert Werte bei Verbindungsverlust als nicht aktuell mit Zeit der letzten Werte', () => {
    pair();
    render(<LiveView />);
    act(() => {
      useLiveStore.setState({ connection: 'connected' });
      applyUpdate('2026-11-16T12:00:00.000Z', {
        label: 'LP01',
        status: null,
        setpointA: 6,
        currentA: [6, 6, 6],
        powerKw: 4,
        fault: false,
      });
      useLiveStore.setState({ connection: 'offline' });
    });
    expect(screen.getByText('Getrennt')).toBeTruthy();
    expect(screen.getByText(/sind nicht aktuell/)).toBeTruthy();
    expect(screen.getAllByText(/Letzte Werte von/).length).toBeGreaterThan(0);
  });

  it('Demo ist klar gekennzeichnet und beendbar', async () => {
    render(<LiveView />);
    await userEvent.click(screen.getByRole('button', { name: 'Demo-Daten anzeigen' }));
    expect(screen.getByText('Demo – keine echten Werte')).toBeTruthy();
    expect(screen.getByText('Demo-Daten')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Demo beenden' }));
    expect(screen.getByRole('heading', { name: 'Noch keine Live-Werte' })).toBeTruthy();
  });

  it('Filter „Nur Störungen“ blendet andere aus', async () => {
    render(<LiveView />);
    await userEvent.click(screen.getByRole('button', { name: 'Demo-Daten anzeigen' }));
    const before = screen.getAllByRole('row').length;
    await userEvent.selectOptions(screen.getByLabelText('Anzeige'), 'fault');
    expect(screen.getAllByRole('row').length).toBeLessThan(before);
  });
});

describe('Hilfsfunktionen', () => {
  it('wsUrl wandelt http/https', () => {
    expect(wsUrl('https://gw.example:8787')).toBe('wss://gw.example:8787/ws');
  });
  it('pillOf unterscheidet Miniserver-Zustände', () => {
    const base = { ...initialLiveState, connection: 'connected' as const };
    expect(
      pillOf({ ...base, miniserver: { state: 'disconnected', lastValuesAt: null } }).text,
    ).toBe('Miniserver getrennt');
  });
});
