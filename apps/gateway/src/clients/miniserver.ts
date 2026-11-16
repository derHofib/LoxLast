import { randomUUID } from 'node:crypto';
import type { MiniserverStatus } from '@lastplan/protocol';
import { backoffDelayMs } from '../backoff';
import { EncryptedSession, publicKeyFromCertificate } from './miniserver-crypto';
import {
  KEEPALIVE_COMMAND,
  MINISERVER_WS_PATH,
  MINISERVER_WS_PROTOCOL,
  MessageType,
  TokenPermission,
  credentialHash,
  expectsPayload,
  isLoxoneUuid,
  parseCommandResponse,
  parseHeader,
  parseKeyInfo,
  parseTextEvents,
  parseTokenInfo,
  parseValueEvents,
  tokenHash,
  type CommandResponse,
  type KeyInfo,
  type MessageHeader,
  type TokenInfo,
} from './miniserver-protocol';
import type {
  LiveValue,
  LiveValueSource,
  MiniserverClient,
  MiniserverConnection,
  SetVirtualInputOptions,
} from './types';

/**
 * Miniserver-Client per WebSocket nach der offiziellen Doku „Communicating with the Miniserver“
 * (V17.0, ADR 0008 Variante B). Ablauf:
 * 1. WebSocket `ws(s)://{host}:{port}/ws/rfc6455`, Subprotokoll `remotecontrol`.
 * 2. Ohne TLS: Schlüsseltausch (getcertificate, keyexchange), Token-Befehle verschlüsselt.
 * 3. `getkey2` → Token per `getjwt` (erste Verbindung) bzw. `authwithtoken` (danach).
 * 4. `enablebinstatusupdate` → Wert-Events (UUID + Double).
 * 5. Keepalive, Token rechtzeitig per `refreshjwt` erneuern, Wiederverbinden mit Backoff.
 *
 * Sicherheit: Passwort und Token bleiben im Speicher dieses Objekts, werden nie geloggt und
 * nie in Statusmeldungen übernommen. Das Token wird nicht gespeichert (bei Neustart neu holen).
 */

export interface MiniserverCredentials {
  host: string;
  user: string;
  password: string;
  /** Standard 80 (ohne TLS) bzw. 443 (mit TLS). */
  port?: number;
  /** WSS (nur Miniserver Gen 2, Zertifikat gilt für den Hostnamen, nicht für IPs). */
  tls?: boolean;
}

/** Zugang aus dem Credential-Store (`Secret`) in Verbindungsdaten umsetzen. */
export function credentialsFromSecret(
  secret:
    | { host?: string; username?: string; password: string; port?: number; tls?: boolean }
    | undefined,
): MiniserverCredentials | undefined {
  if (!secret?.host || !secret.username) return undefined;
  const c: MiniserverCredentials = {
    host: secret.host,
    user: secret.username,
    password: secret.password,
  };
  if (secret.port !== undefined) c.port = secret.port;
  if (secret.tls !== undefined) c.tls = secret.tls;
  return c;
}

/** Minimale WebSocket-Schnittstelle (WHATWG), damit Tests einen eigenen Socket einsetzen können. */
export interface WsLike {
  binaryType: string;
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: 'open', l: () => void): void;
  addEventListener(type: 'message', l: (ev: { data: unknown }) => void): void;
  addEventListener(type: 'close', l: (ev: { code: number; reason: string }) => void): void;
  addEventListener(type: 'error', l: (ev: unknown) => void): void;
}

export interface MiniserverWsOptions {
  /** Zugangsdaten werden bei jedem Verbindungsaufbau frisch geholt (Credential-Store). */
  credentials: () => MiniserverCredentials | undefined;
  /** Verschlüsselung der Token-Befehle: `auto` = nur ohne TLS (Standard). */
  encryption?: 'auto' | 'always' | 'never';
  /** Berechtigung des Tokens; Standard App (4, mehrere Wochen gültig). */
  permission?: (typeof TokenPermission)[keyof typeof TokenPermission];
  /** Kennung dieses Clients beim Miniserver (UUID) und Klartext-Info. */
  clientUuid?: string;
  clientInfo?: string;
  keepaliveIntervalMs?: number;
  keepaliveTimeoutMs?: number;
  commandTimeoutMs?: number;
  readBackTimeoutMs?: number;
  /** Token so lange vor Ablauf erneuern. */
  tokenRefreshMarginMs?: number;
  /** Nach Verbindungsverlust automatisch neu verbinden (Standard: ja). */
  reconnect?: boolean;
  backoff?: { baseMs?: number; maxMs?: number };
  createSocket?: (url: string, protocol: string) => WsLike;
  now?: () => Date;
}

/** Fehler mit Kennung für die Statusanzeige; `fatal` = nicht automatisch erneut versuchen. */
export class MiniserverError extends Error {
  constructor(
    message: string,
    readonly code: 'auth' | 'blocked' | 'protocol' | 'timeout' | 'connection' | 'command',
    readonly fatal = false,
  ) {
    super(message);
    this.name = 'MiniserverError';
  }
}

/** Längstes setTimeout in Node (≈ 24,8 Tage); längere Fristen werden in Etappen geprüft. */
const MAX_TIMER_MS = 2_147_483_647;
const OPEN = 1;

interface Pending {
  resolve: (r: CommandResponse) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class MiniserverWsClient implements MiniserverClient, LiveValueSource {
  private connection: MiniserverConnection = 'disconnected';
  private message: string | undefined;
  private lastValuesAt: Date | undefined;
  private socket: WsLike | undefined;
  private header: MessageHeader | undefined;
  private pending: Pending | undefined;
  private queue: Promise<unknown> = Promise.resolve();
  private session: EncryptedSession | undefined;
  private token: TokenInfo | undefined;
  private tokenUser: string | undefined;
  private keepaliveTimer: ReturnType<typeof setInterval> | undefined;
  private keepaliveDeadline: ReturnType<typeof setTimeout> | undefined;
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private attempt = 0;
  private outOfService = false;
  private wanted = false;
  private connecting: Promise<void> | undefined;
  private readonly values = new Map<string, number | string>();
  private readonly valueListeners = new Set<(v: readonly LiveValue[], at: Date) => void>();
  private readonly statusListeners = new Set<(s: MiniserverStatus) => void>();
  private readonly clientUuid: string;
  private readonly now: () => Date;

  constructor(private readonly opts: MiniserverWsOptions) {
    this.clientUuid = opts.clientUuid ?? randomUUID();
    this.now = opts.now ?? (() => new Date());
  }

  get state(): MiniserverConnection {
    return this.connection;
  }

  get status(): MiniserverStatus {
    const s: MiniserverStatus = {
      state: this.connection,
      lastValuesAt: this.lastValuesAt?.toISOString() ?? null,
    };
    if (this.message !== undefined) s.message = this.message;
    return s;
  }

  latest(uuid: string): number | string | undefined {
    return this.values.get(uuid.toLowerCase());
  }

  onValues(listener: (values: readonly LiveValue[], at: Date) => void): () => void {
    this.valueListeners.add(listener);
    return () => this.valueListeners.delete(listener);
  }

  onStatus(listener: (status: MiniserverStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  /** Verbinden; bei Fehlern wird (außer bei Anmeldefehlern) im Hintergrund erneut versucht. */
  async connect(): Promise<void> {
    this.wanted = true;
    if (this.connection === 'connected') return;
    this.connecting ??= this.connectOnce().finally(() => {
      this.connecting = undefined;
    });
    return this.connecting;
  }

  async disconnect(): Promise<void> {
    this.wanted = false;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    if (this.connection === 'connected' && this.token && this.tokenUser) {
      // Token beim Miniserver widerrufen (S. 29); Fehler hier sind unkritisch.
      try {
        const info = await this.getKey(this.tokenUser);
        await this.command(
          `jdev/sys/killtoken/${tokenHash(this.token.token, info)}/${encodeURIComponent(this.tokenUser)}`,
        );
      } catch {
        // ignorieren
      }
    }
    this.token = undefined;
    this.teardown(1000, 'Client beendet');
    this.setState('disconnected', undefined);
  }

  /** Zugangsdaten geändert: Token verwerfen und neu verbinden. */
  async restart(): Promise<void> {
    await this.disconnect();
    this.attempt = 0;
    await this.connect();
  }

  async readValue(address: string): Promise<number | string> {
    this.assertConnected();
    const v = this.latest(address);
    if (v === undefined) {
      throw new MiniserverError(
        `Für UUID ${address} liegt noch kein Wert vor. Der Miniserver meldet nur Bausteine, die in der Visualisierung verwendet werden.`,
        'command',
      );
    }
    return v;
  }

  async setVirtualInput(
    address: string,
    value: number,
    options: SetVirtualInputOptions = {},
  ): Promise<{ readBack: number; confirmed: boolean }> {
    this.assertConnected();
    if (!isLoxoneUuid(address)) throw new MiniserverError(`Ungültige UUID: ${address}`, 'command');
    if (!Number.isFinite(value))
      throw new MiniserverError('Wert muss eine endliche Zahl sein.', 'command');
    const stateUuid = (options.stateUuid ?? address).toLowerCase();
    const readBack = this.waitForValue(stateUuid, value, this.opts.readBackTimeoutMs ?? 5000);
    const res = await this.command(`jdev/sps/io/${address}/${value}`);
    if (res.code !== 200) {
      readBack.cancel();
      throw new MiniserverError(
        `Miniserver hat den Befehl abgelehnt (Code ${res.code}).`,
        'command',
      );
    }
    const got = await readBack.promise;
    const current = got ?? this.latest(stateUuid);
    const num = typeof current === 'number' ? current : Number.NaN;
    return { readBack: num, confirmed: num === value };
  }

  // ---------------------------------------------------------------- Verbindung

  private async connectOnce(): Promise<void> {
    const creds = this.opts.credentials();
    if (!creds) {
      this.wanted = false;
      this.setState('disconnected', 'Kein Miniserver-Zugang eingerichtet.');
      throw new MiniserverError('Kein Miniserver-Zugang eingerichtet.', 'auth', true);
    }
    if (this.tokenUser !== undefined && this.tokenUser !== creds.user) this.token = undefined;
    this.setState('connecting', undefined);
    try {
      await this.open(creds);
      await this.authenticate(creds);
      const res = await this.command('jdev/sps/enablebinstatusupdate');
      if (res.code !== 200) {
        throw new MiniserverError(`Statusmeldungen abgelehnt (Code ${res.code}).`, 'protocol');
      }
      this.attempt = 0;
      this.startKeepalive();
      this.setState('connected', undefined);
    } catch (e) {
      const error =
        e instanceof MiniserverError
          ? e
          : new MiniserverError(e instanceof Error ? e.message : String(e), 'connection');
      this.teardown(1000, 'Fehler beim Verbinden');
      this.setState('error', error.message);
      if (error.fatal) this.wanted = false;
      else this.scheduleReconnect();
      throw error;
    }
  }

  private open(creds: MiniserverCredentials): Promise<void> {
    const tls = creds.tls ?? false;
    const port = creds.port ?? (tls ? 443 : 80);
    const url = `${tls ? 'wss' : 'ws'}://${creds.host}:${port}${MINISERVER_WS_PATH}`;
    const create =
      this.opts.createSocket ??
      ((u: string, p: string): WsLike => new WebSocket(u, p) as unknown as WsLike);
    return new Promise((resolve, reject) => {
      let opened = false;
      const ws = create(url, MINISERVER_WS_PROTOCOL);
      ws.binaryType = 'arraybuffer';
      this.socket = ws;
      this.header = undefined;
      const timer = setTimeout(() => {
        reject(
          new MiniserverError(
            `Keine Verbindung zu ${creds.host}:${port} (Zeitüberschreitung).`,
            'timeout',
          ),
        );
        ws.close();
      }, this.opts.commandTimeoutMs ?? 10_000);
      ws.addEventListener('open', () => {
        opened = true;
        clearTimeout(timer);
        resolve();
      });
      ws.addEventListener('error', () => {
        if (!opened) {
          clearTimeout(timer);
          reject(new MiniserverError(`Keine Verbindung zu ${creds.host}:${port}.`, 'connection'));
        }
      });
      ws.addEventListener('message', (ev) => {
        if (this.socket === ws) this.onMessage(ev.data);
      });
      ws.addEventListener('close', (ev) => {
        clearTimeout(timer);
        if (this.socket === ws) this.onClose(ev.code);
      });
    });
  }

  private encrypt(creds: MiniserverCredentials): boolean {
    const mode = this.opts.encryption ?? 'auto';
    return mode === 'always' || (mode === 'auto' && !(creds.tls ?? false));
  }

  private async authenticate(creds: MiniserverCredentials): Promise<void> {
    const user = encodeURIComponent(creds.user);
    if (this.encrypt(creds)) {
      const cert = await this.command('jdev/sys/getcertificate');
      if (cert.code !== 200 || typeof cert.value !== 'string') {
        throw new MiniserverError('Zertifikat des Miniservers nicht erhalten.', 'protocol');
      }
      const session = new EncryptedSession();
      // TODO(verify): Die Doku nennt für den WebSocket kein URI-Encoding des Base64-Werts.
      const kx = await this.command(
        `jdev/sys/keyexchange/${session.keyExchangePayload(publicKeyFromCertificate(cert.value))}`,
      );
      if (kx.code !== 200) {
        throw new MiniserverError(`Schlüsseltausch abgelehnt (Code ${kx.code}).`, 'protocol');
      }
      this.session = session;
    } else {
      this.session = undefined;
    }

    let info: KeyInfo | undefined = await this.getKey(creds.user);
    if (this.token && this.token.validUntil.getTime() > this.now().getTime()) {
      const res = await this.command(
        this.secure(`authwithtoken/${tokenHash(this.token.token, info)}/${user}`),
      );
      if (res.code === 200) {
        this.scheduleRefresh();
        return;
      }
      // Token abgelaufen/widerrufen: neu holen, mit frischem Schlüssel (TODO(verify): ob nötig).
      this.token = undefined;
      if (res.code !== 401) this.throwAuth(res.code);
      info = undefined;
    }
    const fresh = info ?? (await this.getKey(creds.user));
    const permission = this.opts.permission ?? TokenPermission.App;
    const clientInfo = encodeURIComponent(this.opts.clientInfo ?? 'LastPlan-Gateway');
    // TODO(verify): Ob die Verbindung nach getjwt bereits angemeldet ist (so hier angenommen).
    const res = await this.command(
      this.secure(
        `jdev/sys/getjwt/${credentialHash(creds.user, creds.password, fresh)}/${user}/${permission}/${this.clientUuid}/${clientInfo}`,
      ),
    );
    if (res.code !== 200) this.throwAuth(res.code);
    this.token = parseTokenInfo(res.value);
    this.tokenUser = creds.user;
    this.scheduleRefresh();
  }

  private throwAuth(code: number): never {
    if (code === 401) {
      throw new MiniserverError(
        'Anmeldung abgelehnt: Benutzer oder Passwort falsch. Zugang im Gateway prüfen.',
        'auth',
        true,
      );
    }
    if (code === 400) {
      throw new MiniserverError(
        'Anmeldung abgelehnt (Code 400). Ggf. verlangt der Miniserver Verschlüsselung.',
        'auth',
        true,
      );
    }
    throw new MiniserverError(`Anmeldung fehlgeschlagen (Code ${code}).`, 'auth', code === 403);
  }

  private secure(cmd: string): string {
    return this.session ? this.session.encryptCommand(cmd) : cmd;
  }

  private async getKey(user: string): Promise<KeyInfo> {
    const res = await this.command(`jdev/sys/getkey2/${encodeURIComponent(user)}`);
    if (res.code !== 200)
      throw new MiniserverError(`getkey2 abgelehnt (Code ${res.code}).`, 'auth');
    return parseKeyInfo(res.value);
  }

  // ---------------------------------------------------------------- Token

  private scheduleRefresh(): void {
    clearTimeout(this.refreshTimer);
    if (!this.token) return;
    const margin = this.opts.tokenRefreshMarginMs ?? 60 * 60 * 1000;
    const remaining = this.token.validUntil.getTime() - this.now().getTime();
    // Kurzlebige Tokens (z. B. Web-Berechtigung): spätestens zur Hälfte der Restlaufzeit erneuern.
    const due = remaining > 2 * margin ? remaining - margin : remaining / 2;
    const wait = Math.max(0, Math.min(due, MAX_TIMER_MS));
    this.refreshTimer = setTimeout(() => {
      if (due > MAX_TIMER_MS) this.scheduleRefresh();
      else void this.refreshToken();
    }, wait);
  }

  private async refreshToken(): Promise<void> {
    if (!this.token || !this.tokenUser || this.connection !== 'connected') return;
    try {
      const info = await this.getKey(this.tokenUser);
      const res = await this.command(
        this.secure(
          `jdev/sys/refreshjwt/${tokenHash(this.token.token, info)}/${encodeURIComponent(this.tokenUser)}`,
        ),
      );
      if (res.code !== 200) throw new MiniserverError(`Code ${res.code}`, 'auth');
      this.token = parseTokenInfo(res.value, this.token);
      this.scheduleRefresh();
    } catch {
      // Erneuern fehlgeschlagen: Token verwerfen; die nächste Verbindung holt ein neues.
      this.token = undefined;
      this.teardown(1000, 'Token-Erneuerung fehlgeschlagen');
      this.setState('connecting', 'Token wird neu angefordert.');
      this.scheduleReconnect();
    }
  }

  // ---------------------------------------------------------------- Nachrichten

  private command(cmd: string): Promise<CommandResponse> {
    const run = (): Promise<CommandResponse> =>
      new Promise((resolve, reject) => {
        const ws = this.socket;
        if (!ws || ws.readyState !== OPEN) {
          reject(new MiniserverError('Keine Verbindung zum Miniserver.', 'connection'));
          return;
        }
        const timer = setTimeout(() => {
          this.pending = undefined;
          reject(
            new MiniserverError('Miniserver antwortet nicht (Zeitüberschreitung).', 'timeout'),
          );
          // Antwortreihenfolge ist danach unklar: Verbindung neu aufbauen.
          this.teardown(1000, 'Zeitüberschreitung');
          if (this.connection === 'connected') {
            this.setState('connecting', 'Zeitüberschreitung, verbinde neu.');
            this.scheduleReconnect();
          }
        }, this.opts.commandTimeoutMs ?? 10_000);
        this.pending = { resolve, reject, timer };
        ws.send(cmd);
      });
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => undefined);
    return p;
  }

  private onMessage(data: unknown): void {
    if (typeof data === 'string') {
      this.onText(data);
      return;
    }
    const buf =
      data instanceof ArrayBuffer
        ? new Uint8Array(data)
        : ArrayBuffer.isView(data)
          ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
          : undefined;
    if (!buf) return;
    const header = parseHeader(buf);
    // Ein Header ersetzt einen noch offenen (geschätzter Header, danach exakter; S. 18).
    if (header && (this.header === undefined || this.header.length !== buf.length)) {
      this.onHeader(header);
      return;
    }
    const pending = this.header;
    this.header = undefined;
    if (!pending) return;
    try {
      switch (pending.type) {
        case MessageType.Text:
          this.onText(new TextDecoder().decode(buf));
          break;
        case MessageType.ValueEvents:
          this.onValueEvents(parseValueEvents(buf));
          break;
        case MessageType.TextEvents:
          for (const e of parseTextEvents(buf)) this.values.set(e.uuid, e.text);
          break;
        default:
          // Tageszeitschaltuhren, Wetter, Dateien: für LastPlan nicht benötigt.
          break;
      }
    } catch {
      // Defekte Tabelle verwerfen; Verbindung bleibt bestehen.
    }
  }

  private onHeader(h: MessageHeader): void {
    if (h.type === MessageType.Keepalive) {
      clearTimeout(this.keepaliveDeadline);
      this.keepaliveDeadline = undefined;
      this.header = undefined;
      return;
    }
    if (h.type === MessageType.OutOfService) {
      // Der Miniserver trennt danach selbst; Meldung beim Schließen übernehmen.
      this.header = undefined;
      this.outOfService = true;
      return;
    }
    this.header = expectsPayload(h) ? h : undefined;
  }

  private onText(text: string): void {
    this.header = undefined;
    const p = this.pending;
    if (!p) return;
    const res = parseCommandResponse(text);
    if (!res) return;
    clearTimeout(p.timer);
    this.pending = undefined;
    p.resolve(res);
  }

  private onValueEvents(events: LiveValue[]): void {
    if (events.length === 0) return;
    const at = this.now();
    for (const e of events) this.values.set(e.uuid, e.value);
    this.lastValuesAt = at;
    for (const l of this.valueListeners) l(events, at);
    for (const w of this.waiters) w(events);
  }

  private readonly waiters = new Set<(events: readonly LiveValue[]) => void>();

  private waitForValue(
    uuid: string,
    target: number,
    timeoutMs: number,
  ): { promise: Promise<number | undefined>; cancel: () => void } {
    let done: (v: number | undefined) => void = () => undefined;
    const promise = new Promise<number | undefined>((resolve) => {
      done = resolve;
    });
    let last: number | undefined;
    const waiter = (events: readonly LiveValue[]): void => {
      for (const e of events) {
        if (e.uuid !== uuid) continue;
        last = e.value;
        if (e.value === target) finish();
      }
    };
    const timer = setTimeout(() => finish(), timeoutMs);
    const finish = (): void => {
      clearTimeout(timer);
      this.waiters.delete(waiter);
      done(last);
    };
    this.waiters.add(waiter);
    return { promise, cancel: finish };
  }

  // ---------------------------------------------------------------- Keepalive & Wiederverbinden

  private startKeepalive(): void {
    clearInterval(this.keepaliveTimer);
    this.keepaliveTimer = setInterval(() => {
      const ws = this.socket;
      if (!ws || ws.readyState !== OPEN) return;
      ws.send(KEEPALIVE_COMMAND);
      this.keepaliveDeadline ??= setTimeout(() => {
        this.keepaliveDeadline = undefined;
        this.teardown(1000, 'Keepalive ohne Antwort');
        this.setState('connecting', 'Keepalive ohne Antwort, verbinde neu.');
        this.scheduleReconnect();
      }, this.opts.keepaliveTimeoutMs ?? 30_000);
    }, this.opts.keepaliveIntervalMs ?? 60_000);
  }

  private onClose(code: number): void {
    this.socket = undefined;
    this.stopTimers();
    this.failPending(new MiniserverError('Verbindung zum Miniserver getrennt.', 'connection'));
    if (!this.wanted) return;
    if (code === 4003) {
      // Gesperrter Client (S. 8): nicht weiter anklopfen, sonst verlängert sich die Sperre.
      this.wanted = false;
      this.setState('error', 'Der Miniserver hat dieses Gateway gesperrt (zu viele Fehlversuche).');
      return;
    }
    if (this.connection === 'connected' || this.outOfService) {
      this.setState(
        'connecting',
        this.outOfService
          ? 'Miniserver ist außer Betrieb (z. B. Update oder Neustart), verbinde neu.'
          : 'Verbindung getrennt, verbinde neu.',
      );
      this.outOfService = false;
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (!this.wanted || this.opts.reconnect === false || this.reconnectTimer) return;
    const delay = backoffDelayMs(this.attempt++, this.opts.backoff ?? {});
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      if (this.wanted) this.connect().catch(() => undefined);
    }, delay);
  }

  private stopTimers(): void {
    clearInterval(this.keepaliveTimer);
    clearTimeout(this.keepaliveDeadline);
    clearTimeout(this.refreshTimer);
    this.keepaliveTimer = undefined;
    this.keepaliveDeadline = undefined;
    this.refreshTimer = undefined;
  }

  private failPending(e: Error): void {
    const p = this.pending;
    this.pending = undefined;
    if (p) {
      clearTimeout(p.timer);
      p.reject(e);
    }
  }

  private teardown(code: number, reason: string): void {
    this.stopTimers();
    const ws = this.socket;
    this.socket = undefined;
    this.session = undefined;
    this.header = undefined;
    this.failPending(new MiniserverError('Verbindung zum Miniserver getrennt.', 'connection'));
    if (ws) {
      try {
        ws.close(code, reason);
      } catch {
        // bereits geschlossen
      }
    }
  }

  private setState(state: MiniserverConnection, message: string | undefined): void {
    const changed = state !== this.connection || message !== this.message;
    this.connection = state;
    this.message = message;
    if (!changed) return;
    const s = this.status;
    for (const l of this.statusListeners) l(s);
  }

  private assertConnected(): void {
    if (this.connection !== 'connected') {
      throw new MiniserverError('Miniserver nicht verbunden.', 'connection');
    }
  }
}
