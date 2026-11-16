import { generateKeyPairSync, randomBytes, type KeyObject } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, type WebSocket } from 'ws';
import { aesDecrypt, rsaDecrypt } from './miniserver-crypto';
import {
  MINISERVER_WS_PATH,
  MINISERVER_WS_PROTOCOL,
  MessageType,
  credentialHash,
  encodeHeader,
  encodeValueEvents,
  toLoxoneSeconds,
  tokenHash,
  type HashAlg,
  type KeyInfo,
  type ValueEvent,
} from './miniserver-protocol';

/**
 * Miniserver-Simulator für Tests und lokale Entwicklung (kein reales Gerät). Bildet das in
 * „Communicating with the Miniserver“ (V17.0) beschriebene Verhalten nach, soweit der Client es
 * nutzt: getcertificate, keyexchange, enc, getkey2, getjwt, authwithtoken, refreshjwt, killtoken,
 * enablebinstatusupdate, keepalive, jdev/sps/io. Er ersetzt NICHT den Test am echten Miniserver.
 *
 * Fehlerinjektion (`fault`): `noKeepalive` (Keepalive unbeantwortet), `silent` (Befehle
 * unbeantwortet), `ignoreWrites` (io bestätigt, Wert ändert sich nicht), `rejectWrites` (io → Code 403),
 * `outOfService` (meldet „außer Betrieb“ und trennt), `blocked` (trennt mit 4003).
 */
export type MiniserverFault =
  'noKeepalive' | 'silent' | 'ignoreWrites' | 'rejectWrites' | 'outOfService' | 'blocked';

export interface MiniserverSimulatorOptions {
  user?: string;
  password?: string;
  hashAlg?: HashAlg;
  /** Token-Befehle nur verschlüsselt annehmen (sonst 400, Doku S. 27). */
  requireEncryption?: boolean;
  /** Startwerte je UUID; nur diese werden als Events gemeldet. */
  values?: Record<string, number>;
  /** Token-Lebensdauer in Sekunden. */
  tokenLifetimeS?: number;
  /** Event-Header zuerst als „geschätzt“ senden (Doku S. 18). */
  estimatedHeaders?: boolean;
}

interface Conn {
  ws: WebSocket;
  key?: Buffer;
  iv?: Buffer;
  salt?: string;
  keyInfo?: KeyInfo;
  authed: boolean;
  binStatus: boolean;
}

export class MiniserverSimulator {
  readonly values = new Map<string, number>();
  /** Alle empfangenen Befehle im Klartext (nach Entschlüsselung) – für Tests. */
  readonly commands: string[] = [];
  /** Rohdaten wie über die Leitung empfangen (für „Passwort nie im Klartext“). */
  readonly raw: string[] = [];
  readonly tokens = new Map<string, { user: string; validUntil: Date }>();
  fault: MiniserverFault | undefined;
  connections = 0;
  readonly user: string;
  readonly password: string;
  private readonly hashAlg: HashAlg;
  private readonly salt = randomBytes(8).toString('hex');
  private readonly privateKey: KeyObject;
  private readonly publicKeyPem: string;
  private readonly conns = new Set<Conn>();
  private readonly http: Server;
  private readonly wss: WebSocketServer;

  constructor(private readonly opts: MiniserverSimulatorOptions = {}) {
    this.user = opts.user ?? 'lastplan';
    this.password = opts.password ?? 'geheim';
    this.hashAlg = opts.hashAlg ?? 'SHA256';
    for (const [k, v] of Object.entries(opts.values ?? {})) this.values.set(k.toLowerCase(), v);
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    this.privateKey = privateKey;
    this.publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    this.http = createServer((_req, res) => res.writeHead(404).end());
    this.wss = new WebSocketServer({
      server: this.http,
      path: MINISERVER_WS_PATH,
      handleProtocols: (protocols) =>
        protocols.has(MINISERVER_WS_PROTOCOL) ? MINISERVER_WS_PROTOCOL : false,
    });
    this.wss.on('connection', (ws) => this.onConnection(ws));
  }

  async start(): Promise<number> {
    await new Promise<void>((resolve) => this.http.listen(0, '127.0.0.1', resolve));
    return (this.http.address() as AddressInfo).port;
  }

  async stop(): Promise<void> {
    for (const c of this.conns) c.ws.terminate();
    await new Promise<void>((resolve) => this.wss.close(() => resolve()));
    await new Promise<void>((resolve) => this.http.close(() => resolve()));
  }

  /** Alle Verbindungen hart trennen (Netzwerkausfall simulieren). */
  dropConnections(): void {
    for (const c of this.conns) c.ws.terminate();
  }

  /** Wert ändern und an angemeldete Clients mit Statusmeldungen senden. */
  setValue(uuid: string, value: number): void {
    this.values.set(uuid.toLowerCase(), value);
    this.broadcast([{ uuid: uuid.toLowerCase(), value }]);
  }

  /** Token vorzeitig ungültig machen (z. B. am Miniserver widerrufen). */
  revokeTokens(): void {
    this.tokens.clear();
  }

  private broadcast(events: ValueEvent[]): void {
    for (const c of this.conns) if (c.authed && c.binStatus) this.sendEvents(c, events);
  }

  private sendEvents(c: Conn, events: ValueEvent[]): void {
    const payload = encodeValueEvents(events);
    if (this.opts.estimatedHeaders) c.ws.send(encodeHeader(MessageType.ValueEvents, 0, 0x80));
    c.ws.send(encodeHeader(MessageType.ValueEvents, payload.length));
    c.ws.send(payload);
  }

  private onConnection(ws: WebSocket): void {
    this.connections++;
    const c: Conn = { ws, authed: false, binStatus: false };
    this.conns.add(c);
    ws.on('close', () => this.conns.delete(c));
    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      const text = (data as Buffer).toString('utf8');
      this.raw.push(text);
      this.onCommand(c, text);
    });
    if (this.fault === 'blocked') ws.close(4003, 'blocked');
  }

  private reply(c: Conn, control: string, code: number, value: unknown = ''): void {
    if (this.fault === 'silent') return;
    const text = JSON.stringify({ LL: { control, value, Code: String(code) } });
    c.ws.send(encodeHeader(MessageType.Text, Buffer.byteLength(text)));
    c.ws.send(text);
  }

  private onCommand(c: Conn, text: string): void {
    if (text === 'keepalive') {
      if (this.fault !== 'noKeepalive') c.ws.send(encodeHeader(MessageType.Keepalive, 0));
      return;
    }
    let cmd = text;
    let encrypted = false;
    const enc = /^jdev\/sys\/f?enc\/(.+)$/.exec(text);
    if (enc) {
      if (!c.key || !c.iv) return this.reply(c, text, 401);
      const plain = aesDecrypt(decodeURIComponent(enc[1] as string), c.key, c.iv);
      const m =
        /^salt\/([^/]+)\/(.*)$/.exec(plain) ?? /^nextSalt\/([^/]+)\/([^/]+)\/(.*)$/.exec(plain);
      if (!m) return this.reply(c, text, 401);
      if (plain.startsWith('nextSalt/')) {
        if (m[1] !== c.salt) return this.reply(c, text, 401);
        c.salt = m[2] as string;
        cmd = m[3] as string;
      } else {
        c.salt = m[1] as string;
        cmd = m[2] as string;
      }
      encrypted = true;
    }
    this.commands.push(cmd);
    const parts = cmd.split('/');
    const at = (i: number): string => decodeURIComponent(parts[i] ?? '');

    if (cmd === 'jdev/sys/getcertificate') return this.reply(c, cmd, 200, this.publicKeyPem);
    if (cmd.startsWith('jdev/sys/keyexchange/')) {
      try {
        const [k, iv] = rsaDecrypt(
          cmd.slice('jdev/sys/keyexchange/'.length),
          this.privateKey,
        ).split(':');
        c.key = Buffer.from(k as string, 'hex');
        c.iv = Buffer.from(iv as string, 'hex');
        return this.reply(c, 'jdev/sys/keyexchange', 200, '');
      } catch {
        return this.reply(c, 'jdev/sys/keyexchange', 401);
      }
    }
    if (cmd.startsWith('jdev/sys/getkey2/')) {
      c.keyInfo = { key: randomBytes(20).toString('hex'), salt: this.salt, hashAlg: this.hashAlg };
      return this.reply(c, `dev/sys/getkey2/${at(3)}`, 200, c.keyInfo);
    }
    if (cmd.startsWith('jdev/sys/getjwt/')) {
      if (this.opts.requireEncryption && !encrypted) return this.reply(c, 'dev/sys/getjwt', 400);
      const [hash, user] = [at(3), at(4)];
      const expected =
        c.keyInfo && user === this.user ? credentialHash(this.user, this.password, c.keyInfo) : '';
      if (!expected || hash !== expected) return this.reply(c, 'dev/sys/getjwt', 401);
      c.authed = true;
      return this.reply(c, 'dev/sys/getjwt', 200, this.issueToken(user));
    }
    if (cmd.startsWith('authwithtoken/')) {
      const [hash, user] = [at(1), at(2)];
      const ok = [...this.tokens].some(
        ([t, i]) => i.user === user && c.keyInfo && tokenHash(t, c.keyInfo) === hash,
      );
      if (!ok) return this.reply(c, 'authwithtoken', 401);
      c.authed = true;
      return this.reply(c, 'authwithtoken', 200, '');
    }
    if (!c.authed) return this.reply(c, cmd, 400);
    if (cmd.startsWith('jdev/sys/refreshjwt/') || cmd.startsWith('jdev/sys/killtoken/')) {
      const [hash, user] = [at(3), at(4)];
      const entry = [...this.tokens].find(
        ([t, i]) => i.user === user && c.keyInfo && tokenHash(t, c.keyInfo) === hash,
      );
      if (!entry) return this.reply(c, cmd, 401);
      this.tokens.delete(entry[0]);
      if (cmd.startsWith('jdev/sys/killtoken/')) return this.reply(c, 'dev/sys/killtoken', 200, '');
      return this.reply(c, 'dev/sys/refreshjwt', 200, this.issueToken(user));
    }
    if (cmd === 'jdev/sps/enablebinstatusupdate') {
      c.binStatus = true;
      this.reply(c, 'dev/sps/enablebinstatusupdate', 200, '1');
      const all = [...this.values].map(([uuid, value]) => ({ uuid, value }));
      if (all.length) this.sendEvents(c, all);
      if (this.fault === 'outOfService') {
        c.ws.send(encodeHeader(MessageType.OutOfService, 0));
        c.ws.close();
      }
      return undefined;
    }
    const io = /^jdev\/sps\/io\/([0-9a-f-]+)\/(.+)$/i.exec(cmd);
    if (io) {
      const uuid = (io[1] as string).toLowerCase();
      const value = Number(io[2]);
      if (this.fault === 'rejectWrites' || !this.values.has(uuid) || !Number.isFinite(value)) {
        return this.reply(
          c,
          `dev/sps/io/${uuid}/${io[2]}`,
          this.fault === 'rejectWrites' ? 403 : 404,
        );
      }
      this.reply(c, `dev/sps/io/${uuid}/${io[2]}`, 200, String(value));
      if (this.fault !== 'ignoreWrites') this.setValue(uuid, value);
      return undefined;
    }
    return this.reply(c, cmd, 404);
  }

  private issueToken(user: string): Record<string, unknown> {
    const token = randomBytes(24).toString('base64url');
    const validUntil = new Date(Date.now() + (this.opts.tokenLifetimeS ?? 30 * 24 * 3600) * 1000);
    this.tokens.set(token, { user, validUntil });
    return {
      token,
      key: randomBytes(20).toString('hex'),
      validUntil: toLoxoneSeconds(validUntil),
      tokenRights: 4,
      unsecurePass: false,
    };
  }
}
