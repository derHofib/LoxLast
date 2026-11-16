import {
  ConfigDiscoveryResponseSchema,
  ConfigHandoverResponseSchema,
  ConfigMcpStatusResponseSchema,
  ConfigSaveResponseSchema,
  ConfigUndoResponseSchema,
  DeviceTestResponseSchema,
  ErrorResponseSchema,
  TokenResponseSchema,
  type ConfigDiscoveryResponse,
  type ConfigHandoverPlanInput,
  type ConfigHandoverResponse,
  type ConfigMcpStatusResponse,
  type ConfigSaveResponse,
  type ConfigUndoResponse,
  type DeviceTestRequest,
  type DeviceTestResponse,
} from '@lastplan/protocol';
import { create } from 'zustand';

/**
 * Kopplung mit dem LastPlan-Gateway (ADR 0009, ADR 0012).
 *
 * Im Browser liegen nur Gateway-Adresse und Bearer-Token (60 min gültig), und zwar im
 * sessionStorage: Sie enden mit dem Tab und gehören nicht ins Projekt. Miniserver-Zugangsdaten
 * werden hier nie gespeichert.
 */
export interface GatewaySession {
  baseUrl: string;
  token: string;
  /** ISO-Zeitpunkt, ab dem das Token abgelaufen ist. */
  expiresAt: string;
}

export const DEFAULT_GATEWAY_URL = 'http://127.0.0.1:8787';
const STORAGE_KEY = 'lastplan.gateway';

function readStored(): GatewaySession | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Partial<GatewaySession>;
    if (typeof s.baseUrl !== 'string' || typeof s.token !== 'string') return null;
    if (typeof s.expiresAt !== 'string' || Date.parse(s.expiresAt) <= Date.now()) return null;
    return { baseUrl: s.baseUrl, token: s.token, expiresAt: s.expiresAt };
  } catch {
    return null;
  }
}

function store(session: GatewaySession | null): void {
  try {
    if (session) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Kein sessionStorage (z. B. gesperrt): Kopplung gilt nur bis zum Neuladen.
  }
}

export const useGatewayStore = create<{ session: GatewaySession | null }>(() => ({
  session: readStored(),
}));

/** Gekoppelt und Token nicht abgelaufen. */
export function activeSession(): GatewaySession | null {
  const s = useGatewayStore.getState().session;
  if (s && Date.parse(s.expiresAt) <= Date.now()) {
    forgetGateway();
    return null;
  }
  return s;
}

export function forgetGateway(): void {
  store(null);
  useGatewayStore.setState({ session: null });
}

export class GatewayError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = 'GatewayError';
  }
}

/** „http://127.0.0.1:8787“ – nur Schema, Host und Port; sonst Fehlertext. */
export function normalizeGatewayUrl(input: string): string | { error: string } {
  const raw = input.trim();
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { error: 'Adresse mit http:// oder https:// angeben, z. B. http://127.0.0.1:8787.' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    return { error: 'Nur http:// oder https:// ist möglich.' };
  if (url.username || url.password) return { error: 'Adresse ohne Benutzername und Passwort.' };
  if ((url.pathname !== '/' && url.pathname !== '') || url.search || url.hash)
    return { error: 'Nur Schema, Host und Port angeben, ohne Pfad.' };
  return url.origin;
}

async function call(baseUrl: string, path: string, init: RequestInit): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...init.headers },
    });
  } catch {
    throw new GatewayError(
      `Gateway unter ${baseUrl} nicht erreichbar. Läuft es, und ist diese Web-Adresse in GATEWAY_ALLOWED_ORIGINS freigegeben?`,
      null,
    );
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    const parsed = ErrorResponseSchema.safeParse(body);
    throw new GatewayError(
      parsed.success ? parsed.data.error.message : `Gateway antwortet mit Status ${res.status}.`,
      res.status,
    );
  }
  return body;
}

/** Einmalcode gegen Token tauschen (POST /api/auth/pair). */
export async function pairGateway(baseUrl: string, code: string): Promise<GatewaySession> {
  const body = await call(baseUrl, '/api/auth/pair', {
    method: 'POST',
    body: JSON.stringify({ code: code.trim() }),
  });
  const parsed = TokenResponseSchema.safeParse(body);
  if (!parsed.success) throw new GatewayError('Antwort des Gateways ist ungültig.', null);
  const session: GatewaySession = { baseUrl, ...parsed.data };
  store(session);
  useGatewayStore.setState({ session });
  return session;
}

/** Geräte-Test (POST /api/devices/test). Bei 401 wird die Kopplung verworfen. */
export async function requestDeviceTest(req: DeviceTestRequest): Promise<DeviceTestResponse> {
  const session = activeSession();
  if (!session) throw new GatewayError('Gateway nicht gekoppelt oder Kopplung abgelaufen.', 401);
  try {
    const body = await call(session.baseUrl, '/api/devices/test', {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.token}` },
      body: JSON.stringify(req),
    });
    const parsed = DeviceTestResponseSchema.safeParse(body);
    if (!parsed.success) throw new GatewayError('Antwort des Gateways ist ungültig.', null);
    return parsed.data;
  } catch (error) {
    if (error instanceof GatewayError && error.status === 401) forgetGateway();
    throw error;
  }
}

type Schema<T> = { safeParse(v: unknown): { success: true; data: T } | { success: false } };

async function authorizedGet<T>(path: string, schema: Schema<T>): Promise<T> {
  return authorized(path, schema, 'GET');
}

/** POST immer mit JSON-Körper (Fastify lehnt leere Körper mit JSON-Content-Type ab). */
async function authorizedPost<T>(
  path: string,
  schema: Schema<T>,
  payload: unknown = {},
): Promise<T> {
  return authorized(path, schema, 'POST', payload);
}

async function authorized<T>(
  path: string,
  schema: Schema<T>,
  method: 'GET' | 'POST',
  payload?: unknown,
): Promise<T> {
  const session = activeSession();
  if (!session) throw new GatewayError('Gateway nicht gekoppelt oder Kopplung abgelaufen.', 401);
  try {
    const body = await call(session.baseUrl, path, {
      method,
      headers: { Authorization: `Bearer ${session.token}` },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    });
    const parsed = schema.safeParse(body);
    if (!parsed.success) throw new GatewayError('Antwort des Gateways ist ungültig.', null);
    return parsed.data;
  } catch (error) {
    if (error instanceof GatewayError && error.status === 401) forgetGateway();
    throw error;
  }
}

/** Verbindung des Gateways zu Loxone Config prüfen (GET /api/config/status, ADR 0013). */
export function requestConfigStatus(): Promise<ConfigMcpStatusResponse> {
  return authorizedGet('/api/config/status', ConfigMcpStatusResponseSchema);
}

/** Config-Erkundung, nur lesend (GET /api/config/discovery, Plan 6.3). */
export function requestConfigDiscovery(): Promise<ConfigDiscoveryResponse> {
  return authorizedGet('/api/config/discovery', ConfigDiscoveryResponseSchema);
}

/** Übergabeplan in Config anlegen (POST /api/config/handover, Plan 6.5). */
export function requestConfigHandover(
  plan: ConfigHandoverPlanInput,
): Promise<ConfigHandoverResponse> {
  return authorizedPost('/api/config/handover', ConfigHandoverResponseSchema, { plan });
}

/** Letzten Schritt in Config rückgängig machen (POST /api/config/undo). */
export function requestConfigUndo(): Promise<ConfigUndoResponse> {
  return authorizedPost('/api/config/undo', ConfigUndoResponseSchema);
}

/** Projekt in Config speichern (POST /api/config/save). */
export function requestConfigSave(): Promise<ConfigSaveResponse> {
  return authorizedPost('/api/config/save', ConfigSaveResponseSchema);
}
