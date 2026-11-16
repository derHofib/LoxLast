import { createHash, createHmac } from 'node:crypto';

/**
 * Protokoll-Bausteine nach der offiziellen Loxone-Doku „Communicating with the Miniserver“
 * (V17.0, 31.3.2026; ADR 0008). Seitenangaben beziehen sich auf diese Ausgabe.
 * Alles, was die Doku nicht eindeutig festlegt, ist mit TODO(verify) markiert und am
 * Test-Miniserver zu prüfen.
 */

/** WebSocket-Pfad und Subprotokoll (S. 7). */
export const MINISERVER_WS_PATH = '/ws/rfc6455';
export const MINISERVER_WS_PROTOCOL = 'remotecontrol';

/** Ohne Nachricht trennt der Miniserver nach 5 Minuten (S. 18f.); wir senden deutlich öfter. */
export const KEEPALIVE_COMMAND = 'keepalive';

/** Kennungen im Binär-Header (S. 18f.). */
export const MessageType = {
  Text: 0,
  BinaryFile: 1,
  ValueEvents: 2,
  TextEvents: 3,
  DaytimerEvents: 4,
  OutOfService: 5,
  Keepalive: 6,
  WeatherEvents: 7,
} as const;
export type MessageTypeId = (typeof MessageType)[keyof typeof MessageType];

export const HEADER_LENGTH = 8;
const HEADER_MAGIC = 0x03;

export interface MessageHeader {
  type: number;
  /** Info-Flags (Byte 3); Bit „Estimated“: die Länge ist geschätzt, ein exakter Header folgt. */
  info: number;
  /** Länge der Nutzdaten, die als eigene WebSocket-Nachricht folgen. */
  length: number;
}

/**
 * 8-Byte-Header: 0x03, Kennung, Info, reserviert, uint32 LE Länge (S. 18).
 * Gibt `undefined` zurück, wenn die Nachricht kein Header ist.
 */
export function parseHeader(buf: Uint8Array): MessageHeader | undefined {
  if (buf.length !== HEADER_LENGTH || buf[0] !== HEADER_MAGIC) return undefined;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  return { type: buf[1] as number, info: buf[2] as number, length: view.getUint32(4, true) };
}

export function encodeHeader(type: number, length: number, info = 0): Uint8Array {
  const buf = new Uint8Array(HEADER_LENGTH);
  const view = new DataView(buf.buffer);
  buf[0] = HEADER_MAGIC;
  buf[1] = type;
  buf[2] = info;
  view.setUint32(4, length, true);
  return buf;
}

/** Kommt nach diesem Header eine Nutzdaten-Nachricht? Keepalive-Antwort und Länge 0: nein. */
export function expectsPayload(h: MessageHeader): boolean {
  return h.type !== MessageType.Keepalive && h.type !== MessageType.OutOfService && h.length > 0;
}

const hex = (b: number): string => b.toString(16).padStart(2, '0');

/** UUID: Data1 uint32 LE, Data2 uint16 LE, Data3 uint16 LE, Data4 8 Byte (S. 21). */
export function readUuid(view: DataView, offset: number): string {
  const d1 = view.getUint32(offset, true).toString(16).padStart(8, '0');
  const d2 = view
    .getUint16(offset + 4, true)
    .toString(16)
    .padStart(4, '0');
  const d3 = view
    .getUint16(offset + 6, true)
    .toString(16)
    .padStart(4, '0');
  let d4 = '';
  for (let i = 0; i < 8; i++) d4 += hex(view.getUint8(offset + 8 + i));
  return `${d1}-${d2}-${d3}-${d4}`;
}

const UUID_RE = /^([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{16})$/i;

/** Gegenstück zu `readUuid` (für den Simulator und Tests). */
export function writeUuid(view: DataView, offset: number, uuid: string): void {
  const m = UUID_RE.exec(uuid);
  if (!m) throw new Error(`Ungültige Loxone-UUID: ${uuid}`);
  view.setUint32(offset, parseInt(m[1] as string, 16), true);
  view.setUint16(offset + 4, parseInt(m[2] as string, 16), true);
  view.setUint16(offset + 6, parseInt(m[3] as string, 16), true);
  const d4 = m[4] as string;
  for (let i = 0; i < 8; i++)
    view.setUint8(offset + 8 + i, parseInt(d4.slice(i * 2, i * 2 + 2), 16));
}

export function isLoxoneUuid(s: string): boolean {
  return UUID_RE.test(s);
}

export interface ValueEvent {
  uuid: string;
  value: number;
}

const VALUE_EVENT_LENGTH = 24;

/** Wert-Event-Tabelle: je 16 Byte UUID + 8 Byte double LE (S. 19f.). */
export function parseValueEvents(buf: Uint8Array): ValueEvent[] {
  if (buf.length % VALUE_EVENT_LENGTH !== 0) {
    throw new Error(`Wert-Event-Tabelle mit ungültiger Länge ${buf.length}`);
  }
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const out: ValueEvent[] = [];
  for (let o = 0; o < buf.length; o += VALUE_EVENT_LENGTH) {
    out.push({ uuid: readUuid(view, o), value: view.getFloat64(o + 16, true) });
  }
  return out;
}

export function encodeValueEvents(events: readonly ValueEvent[]): Uint8Array {
  const buf = new Uint8Array(events.length * VALUE_EVENT_LENGTH);
  const view = new DataView(buf.buffer);
  events.forEach((e, i) => {
    writeUuid(view, i * VALUE_EVENT_LENGTH, e.uuid);
    view.setFloat64(i * VALUE_EVENT_LENGTH + 16, e.value, true);
  });
  return buf;
}

export interface TextEvent {
  uuid: string;
  iconUuid: string;
  text: string;
}

/** Text-Event-Tabelle: UUID, Icon-UUID, uint32 LE Länge, Text, Auffüllen auf 4 Byte (S. 20). */
export function parseTextEvents(buf: Uint8Array): TextEvent[] {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const out: TextEvent[] = [];
  let o = 0;
  while (o + 36 <= buf.length) {
    const uuid = readUuid(view, o);
    const iconUuid = readUuid(view, o + 16);
    const len = view.getUint32(o + 32, true);
    const start = o + 36;
    if (start + len > buf.length) throw new Error('Text-Event-Tabelle abgeschnitten');
    const text = new TextDecoder().decode(buf.subarray(start, start + len));
    out.push({ uuid, iconUuid, text });
    o = start + len + ((4 - (len % 4)) % 4);
  }
  return out;
}

/** Antwort auf einen Befehl. TODO(verify): Hülle „LL“ und Feldname „Code“/„code“ (Doku S. 14/30 nennt nur „Code“). */
export interface CommandResponse {
  control: string;
  code: number;
  value: unknown;
}

export function parseCommandResponse(text: string): CommandResponse | undefined {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof json !== 'object' || json === null) return undefined;
  const ll = (json as Record<string, unknown>)['LL'];
  if (typeof ll !== 'object' || ll === null) return undefined;
  const r = ll as Record<string, unknown>;
  const rawCode = r['Code'] ?? r['code'];
  const code = typeof rawCode === 'number' ? rawCode : Number(rawCode);
  if (!Number.isFinite(code)) return undefined;
  return { control: typeof r['control'] === 'string' ? r['control'] : '', code, value: r['value'] };
}

/** Manche Antworten liefern JSON als Zeichenkette im Feld `value`. TODO(verify). */
export function valueAsObject(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      return typeof parsed === 'object' && parsed !== null
        ? (parsed as Record<string, unknown>)
        : undefined;
    } catch {
      return undefined;
    }
  }
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

export type HashAlg = 'SHA1' | 'SHA256';

export interface KeyInfo {
  /** Hex-codierter Schlüssel für HMAC. */
  key: string;
  /** Benutzer-Salt für den Passwort-Hash. */
  salt: string;
  hashAlg: HashAlg;
}

/** Antwort auf `jdev/sys/getkey2/{user}`. TODO(verify): Feldnamen key/salt/hashAlg (Doku S. 26 nennt sie, ohne JSON-Beispiel). */
export function parseKeyInfo(value: unknown): KeyInfo {
  const v = valueAsObject(value);
  const key = v?.['key'];
  const salt = v?.['salt'];
  const alg = String(v?.['hashAlg'] ?? 'SHA1').toUpperCase();
  if (typeof key !== 'string' || typeof salt !== 'string') {
    throw new Error('getkey2: Antwort ohne key/salt');
  }
  if (alg !== 'SHA1' && alg !== 'SHA256') throw new Error(`getkey2: unbekannter hashAlg ${alg}`);
  return { key, salt, hashAlg: alg };
}

const nodeAlg = (a: HashAlg): string => (a === 'SHA256' ? 'sha256' : 'sha1');

/** `{pwHash}` = Großbuchstaben von hashAlg("{password}:{userSalt}") (S. 26). TODO(verify): Hex-Darstellung. */
export function passwordHash(password: string, salt: string, alg: HashAlg): string {
  return createHash(nodeAlg(alg)).update(`${password}:${salt}`, 'utf8').digest('hex').toUpperCase();
}

/**
 * HMAC mit dem Schlüssel aus getkey2; Ergebnis hex, Groß-/Kleinschreibung unverändert (S. 15, 26).
 * TODO(verify): Der Schlüssel ist hex-codiert; wir verwenden die dekodierten Bytes („might need to
 * be converted to ASCII“). Algorithmus: hashAlg aus getkey2.
 */
export function hmacHex(message: string, keyHex: string, alg: HashAlg): string {
  return createHmac(nodeAlg(alg), Buffer.from(keyHex, 'hex')).update(message, 'utf8').digest('hex');
}

/** Hash für getjwt: HMAC("{user}:{pwHash}") (S. 26). */
export function credentialHash(user: string, password: string, info: KeyInfo): string {
  return hmacHex(
    `${user}:${passwordHash(password, info.salt, info.hashAlg)}`,
    info.key,
    info.hashAlg,
  );
}

/** Token-Hash für authwithtoken/refreshjwt/killtoken: HMAC("{token}") (S. 27f.). */
export function tokenHash(token: string, info: Pick<KeyInfo, 'key' | 'hashAlg'>): string {
  return hmacHex(token, info.key, info.hashAlg);
}

/** Berechtigung beim Token-Abruf (S. 27): 2 = Web (kurzlebig), 4 = App (mehrere Wochen). */
export const TokenPermission = { Web: 2, App: 4 } as const;

export interface TokenInfo {
  token: string;
  /** Ablauf als Date (Doku: Sekunden seit 1.1.2009). */
  validUntil: Date;
  /** Schlüssel für spätere Token-Hashes (S. 27), falls mitgeliefert. */
  key: string | undefined;
  unsecurePass: boolean;
}

/** 1.1.2009. TODO(verify): Zeitzone (Doku nennt keine; wir nehmen UTC). */
export const LOXONE_EPOCH_MS = Date.UTC(2009, 0, 1);

export function fromLoxoneSeconds(seconds: number): Date {
  return new Date(LOXONE_EPOCH_MS + seconds * 1000);
}

export function toLoxoneSeconds(date: Date): number {
  return Math.floor((date.getTime() - LOXONE_EPOCH_MS) / 1000);
}

/** Antwort auf getjwt/refreshjwt (S. 27f.). Bei refreshjwt fehlen ggf. token/key. */
export function parseTokenInfo(value: unknown, previous?: TokenInfo): TokenInfo {
  const v = valueAsObject(value);
  const token = v?.['token'] ?? previous?.token;
  const validUntil = Number(v?.['validUntil']);
  if (typeof token !== 'string' || token.length === 0 || !Number.isFinite(validUntil)) {
    throw new Error('Token-Antwort ohne token/validUntil');
  }
  const key = typeof v?.['key'] === 'string' ? (v['key'] as string) : previous?.key;
  return {
    token,
    validUntil: fromLoxoneSeconds(validUntil),
    key,
    unsecurePass: v?.['unsecurePass'] === true,
  };
}
