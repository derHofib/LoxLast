import { ServerMessageSchema, WS_PATH } from '@lastplan/protocol';
import { activeSession } from '../../gateway/gatewayStore';
import { applyUpdate, useLiveStore } from './liveStore';

const RETRY_MS = [1000, 2000, 5000, 10000];

/** `http://host:8787` → `ws://host:8787/ws`. */
export function wsUrl(baseUrl: string): string {
  const u = new URL(baseUrl);
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  u.pathname = WS_PATH;
  return u.toString();
}

/**
 * Verbindet sich mit dem WebSocket des Gateways (Kap. 8.3): erste Nachricht `auth`, danach
 * `live.update` und `miniserver.state`. Bei Abbruch Wiederverbindung mit wachsendem Abstand;
 * die zuletzt empfangenen Werte bleiben stehen und werden als „letzte Werte“ angezeigt.
 */
export function startGatewaySource(projectId: string): () => void {
  const set = useLiveStore.setState;
  let socket: WebSocket | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;
  let stopped = false;

  const connect = (): void => {
    const session = activeSession();
    if (!session) {
      set({ connection: 'unpaired', message: null });
      return;
    }
    set({ connection: 'connecting' });
    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl(session.baseUrl));
    } catch {
      set({ connection: 'error', message: 'Gateway-Adresse ungültig.' });
      return;
    }
    socket = ws;
    ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', token: session.token }));
    ws.onmessage = (ev: MessageEvent) => {
      let parsed;
      try {
        parsed = ServerMessageSchema.safeParse(JSON.parse(String(ev.data)));
      } catch {
        return;
      }
      if (!parsed.success) return;
      const m = parsed.data;
      if (m.type === 'ready') {
        attempt = 0;
        set({ connection: 'connected', message: null });
      } else if (m.type === 'live.update') {
        if (m.projectId === projectId) applyUpdate(m.at, m.chargePoint);
      } else if (m.type === 'miniserver.state') {
        set((s) => ({
          miniserver: m.status,
          lastValuesAt: m.status.lastValuesAt ?? s.lastValuesAt,
        }));
      } else if (m.type === 'error') {
        set({ connection: 'error', message: m.message });
      }
    };
    ws.onclose = () => {
      if (stopped) return;
      set((s) => ({ connection: s.connection === 'error' ? 'error' : 'offline' }));
      const delay = RETRY_MS[Math.min(attempt, RETRY_MS.length - 1)] ?? 10000;
      attempt += 1;
      timer = setTimeout(connect, delay);
    };
  };

  connect();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    socket?.close();
  };
}
