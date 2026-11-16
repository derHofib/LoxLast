import { afterEach, describe, expect, it } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import {
  EncryptedSession,
  aesDecrypt,
  aesEncrypt,
  publicKeyFromCertificate,
  rsaDecrypt,
} from './miniserver-crypto';
import {
  MessageType,
  credentialHash,
  encodeHeader,
  encodeValueEvents,
  expectsPayload,
  fromLoxoneSeconds,
  parseCommandResponse,
  parseHeader,
  parseKeyInfo,
  parseTextEvents,
  parseTokenInfo,
  parseValueEvents,
  passwordHash,
  readUuid,
  toLoxoneSeconds,
} from './miniserver-protocol';
import { MiniserverSimulator, type MiniserverSimulatorOptions } from './miniserver-simulator';
import { MiniserverError, MiniserverWsClient, type MiniserverWsOptions } from './miniserver';

const UUID_A = '0f86a2fe-0378-3e08-ffff112233445566';
const UUID_B = '1a2b3c4d-0001-0002-0102030405060708';

describe('Binärprotokoll', () => {
  it('liest den 8-Byte-Header (Länge little endian)', () => {
    const h = encodeHeader(MessageType.ValueEvents, 0x01020304);
    expect(Array.from(h)).toEqual([3, 2, 0, 0, 4, 3, 2, 1]);
    expect(parseHeader(h)).toEqual({ type: 2, info: 0, length: 0x01020304 });
    expect(parseHeader(new Uint8Array([4, 0, 0, 0, 0, 0, 0, 0]))).toBeUndefined();
    expect(parseHeader(new Uint8Array(7))).toBeUndefined();
    expect(expectsPayload({ type: MessageType.Keepalive, info: 0, length: 0 })).toBe(false);
    expect(expectsPayload({ type: MessageType.Text, info: 0, length: 5 })).toBe(true);
  });

  it('liest UUIDs nach Doku-Layout (Data1–3 little endian)', () => {
    const bytes = new Uint8Array([
      0xfe, 0xa2, 0x86, 0x0f, 0x78, 0x03, 0x08, 0x3e, 0xff, 0xff, 0x11, 0x22, 0x33, 0x44, 0x55,
      0x66,
    ]);
    expect(readUuid(new DataView(bytes.buffer), 0)).toBe(UUID_A);
  });

  it('liest Wert-Event-Tabellen (UUID + Double)', () => {
    const buf = encodeValueEvents([
      { uuid: UUID_A, value: 16.5 },
      { uuid: UUID_B, value: -1 },
    ]);
    expect(buf.length).toBe(48);
    expect(parseValueEvents(buf)).toEqual([
      { uuid: UUID_A, value: 16.5 },
      { uuid: UUID_B, value: -1 },
    ]);
    expect(() => parseValueEvents(new Uint8Array(23))).toThrow();
  });

  it('liest Text-Events mit Auffüllung auf 4 Byte', () => {
    const text = new TextEncoder().encode('Fehler');
    const entry = new Uint8Array(36 + 8);
    const v = new DataView(entry.buffer);
    entry.set(encodeValueEvents([{ uuid: UUID_A, value: 0 }]).subarray(0, 16), 0);
    entry.set(encodeValueEvents([{ uuid: UUID_B, value: 0 }]).subarray(0, 16), 16);
    v.setUint32(32, text.length, true);
    entry.set(text, 36);
    expect(parseTextEvents(entry)).toEqual([{ uuid: UUID_A, iconUuid: UUID_B, text: 'Fehler' }]);
    expect(() => parseTextEvents(entry.subarray(0, 38))).toThrow();
  });

  it('liest Befehlsantworten tolerant (Code als Zahl oder Text)', () => {
    expect(parseCommandResponse('{"LL":{"control":"x","value":"1","Code":"200"}}')).toEqual({
      control: 'x',
      code: 200,
      value: '1',
    });
    expect(parseCommandResponse('{"LL":{"control":"x","code":401}}')?.code).toBe(401);
    expect(parseCommandResponse('kein json')).toBeUndefined();
    expect(parseCommandResponse('{"LL":{"control":"x"}}')).toBeUndefined();
    expect(parseCommandResponse('[1]')).toBeUndefined();
  });
});

describe('Anmeldung (Hashes, Token)', () => {
  it('bildet pwHash in Großbuchstaben und den HMAC über user:pwHash', () => {
    // SHA1("geheim:SALT") – Kontrollwert mit Node berechnet, Format laut Doku S. 26.
    expect(passwordHash('geheim', 'SALT', 'SHA1')).toMatch(/^[0-9A-F]{40}$/);
    expect(passwordHash('geheim', 'SALT', 'SHA256')).toMatch(/^[0-9A-F]{64}$/);
    const info = { key: '41424344', salt: 'SALT', hashAlg: 'SHA1' as const };
    expect(credentialHash('u', 'geheim', info)).toMatch(/^[0-9a-f]{40}$/);
    expect(credentialHash('u', 'geheim', info)).not.toBe(credentialHash('u', 'anders', info));
  });

  it('liest getkey2-Antworten als Objekt oder JSON-Text', () => {
    expect(parseKeyInfo({ key: 'aa', salt: 'bb', hashAlg: 'sha256' })).toEqual({
      key: 'aa',
      salt: 'bb',
      hashAlg: 'SHA256',
    });
    expect(parseKeyInfo('{"key":"aa","salt":"bb"}').hashAlg).toBe('SHA1');
    expect(() => parseKeyInfo({ key: 'aa' })).toThrow();
    expect(() => parseKeyInfo({ key: 'aa', salt: 'b', hashAlg: 'MD5' })).toThrow();
    expect(() => parseKeyInfo('kaputt')).toThrow();
  });

  it('rechnet validUntil ab 1.1.2009', () => {
    expect(fromLoxoneSeconds(0).toISOString()).toBe('2009-01-01T00:00:00.000Z');
    const d = new Date('2026-11-16T12:00:00Z');
    expect(fromLoxoneSeconds(toLoxoneSeconds(d)).getTime()).toBe(d.getTime());
    const t = parseTokenInfo({ token: 'abc', validUntil: 100, key: 'k', unsecurePass: true });
    expect(t).toMatchObject({ token: 'abc', key: 'k', unsecurePass: true });
    expect(parseTokenInfo({ validUntil: 200 }, t).token).toBe('abc');
    expect(() => parseTokenInfo({ token: 'x' })).toThrow();
  });
});

describe('Verschlüsselung', () => {
  it('AES-256-CBC mit Zero-Byte-Padding ist umkehrbar', () => {
    const s = new EncryptedSession();
    const c = aesEncrypt('salt/ab/jdev/sys/getjwt/x', s.key, s.iv);
    expect(aesDecrypt(c, s.key, s.iv)).toBe('salt/ab/jdev/sys/getjwt/x');
    expect(aesDecrypt(aesEncrypt('0123456789abcdef', s.key, s.iv), s.key, s.iv)).toBe(
      '0123456789abcdef',
    );
  });

  it('tauscht den Sitzungsschlüssel per RSA und wechselt den Salt', () => {
    const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 1024 });
    const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const asCert = pem.replace(/PUBLIC KEY/g, 'CERTIFICATE');
    for (const text of [pem, asCert]) {
      const s = new EncryptedSession();
      const kx = s.keyExchangePayload(publicKeyFromCertificate(text));
      expect(rsaDecrypt(kx, privateKey)).toBe(`${s.key.toString('hex')}:${s.iv.toString('hex')}`);
    }
    expect(() => publicKeyFromCertificate('nichts')).toThrow();

    let n = 0;
    const s = new EncryptedSession(() => `s${n++}`);
    const dec = (cmd: string): string =>
      aesDecrypt(decodeURIComponent(cmd.replace('jdev/sys/enc/', '')), s.key, s.iv);
    expect(dec(s.encryptCommand('a'))).toBe('salt/s0/a');
    expect(dec(s.encryptCommand('b'))).toBe('nextSalt/s0/s1/b');
    expect(dec(s.encryptCommand('c'))).toBe('nextSalt/s1/s2/c');
  });
});

describe('MiniserverWsClient gegen den Simulator', () => {
  let sim: MiniserverSimulator;
  let client: MiniserverWsClient | undefined;

  afterEach(async () => {
    await client?.disconnect();
    client = undefined;
    await sim?.stop();
  });

  async function setup(
    simOpts: MiniserverSimulatorOptions = {},
    clientOpts: Partial<MiniserverWsOptions> = {},
  ): Promise<MiniserverWsClient> {
    sim = new MiniserverSimulator({ values: { [UUID_A]: 10, [UUID_B]: 0 }, ...simOpts });
    const port = await sim.start();
    client = new MiniserverWsClient({
      credentials: () => ({ host: '127.0.0.1', port, user: sim.user, password: sim.password }),
      commandTimeoutMs: 1000,
      readBackTimeoutMs: 300,
      backoff: { baseMs: 20, maxMs: 50 },
      ...clientOpts,
    });
    return client;
  }

  const until = async (cond: () => boolean, ms = 2000): Promise<void> => {
    const start = Date.now();
    while (!cond()) {
      if (Date.now() - start > ms) throw new Error('Bedingung nicht erfüllt');
      await new Promise((r) => setTimeout(r, 10));
    }
  };

  it('verbindet verschlüsselt, holt ein Token und empfängt Werte', async () => {
    const c = await setup({ requireEncryption: true });
    const states: string[] = [];
    c.onStatus((s) => states.push(s.state));
    await c.connect();
    expect(c.state).toBe('connected');
    expect(states).toEqual(['connecting', 'connected']);
    expect(sim.commands).toContain('jdev/sps/enablebinstatusupdate');
    // Passwort und Token-Anforderung nie im Klartext auf der Leitung.
    expect(sim.raw.some((r) => r.includes('getjwt'))).toBe(false);
    expect(sim.raw.some((r) => r.includes(sim.password))).toBe(false);
    await until(() => c.latest(UUID_A) === 10);
    expect(await c.readValue(UUID_A)).toBe(10);
    expect(c.status.lastValuesAt).not.toBeNull();
  });

  it('meldet neue Werte an Abonnenten', async () => {
    const c = await setup({ estimatedHeaders: true });
    await c.connect();
    const got: number[] = [];
    const off = c.onValues((vals) => vals.forEach((v) => v.uuid === UUID_B && got.push(v.value)));
    sim.setValue(UUID_B, 7.25);
    await until(() => got.includes(7.25));
    off();
    sim.setValue(UUID_B, 8);
    await until(() => c.latest(UUID_B) === 8);
    expect(got).toEqual([7.25]);
  });

  it('setzt einen virtuellen Eingang und liest ihn zurück', async () => {
    const c = await setup();
    await c.connect();
    expect(await c.setVirtualInput(UUID_A, 16)).toEqual({ readBack: 16, confirmed: true });
    expect(sim.values.get(UUID_A)).toBe(16);
  });

  it('meldet „nicht bestätigt“, wenn der Wert nicht übernommen wird', async () => {
    const c = await setup();
    await c.connect();
    sim.fault = 'ignoreWrites';
    expect(await c.setVirtualInput(UUID_A, 20)).toEqual({ readBack: 10, confirmed: false });
  });

  it('wirft bei abgelehntem Befehl und ungültiger Eingabe', async () => {
    const c = await setup();
    await c.connect();
    sim.fault = 'rejectWrites';
    await expect(c.setVirtualInput(UUID_A, 1)).rejects.toThrow(/Code 403/);
    await expect(c.setVirtualInput('VI1', 1)).rejects.toThrow(/Ungültige UUID/);
    await expect(c.setVirtualInput(UUID_A, Number.NaN)).rejects.toThrow(/endliche/);
    await expect(c.readValue('00000000-0000-0000-0000000000000000')).rejects.toThrow(
      /noch kein Wert/,
    );
  });

  it('bricht bei falschem Passwort ab und versucht es nicht erneut', async () => {
    const c = await setup();
    const port = (sim as unknown as { http: { address(): { port: number } } }).http.address().port;
    const wrong = new MiniserverWsClient({
      credentials: () => ({ host: '127.0.0.1', port, user: sim.user, password: 'pw-wrong-123' }),
      backoff: { baseMs: 10, maxMs: 10 },
    });
    await expect(wrong.connect()).rejects.toMatchObject({ code: 'auth', fatal: true });
    expect(wrong.state).toBe('error');
    expect(wrong.status.message).toMatch(/Passwort/);
    expect(wrong.status.message).not.toContain('pw-wrong-123');
    await new Promise((r) => setTimeout(r, 80));
    expect(sim.connections).toBe(1);
    await wrong.disconnect();
    expect(c.state).toBe('disconnected');
  });

  it('meldet fehlenden Zugang', async () => {
    const c = new MiniserverWsClient({ credentials: () => undefined });
    await expect(c.connect()).rejects.toBeInstanceOf(MiniserverError);
    expect(c.status).toMatchObject({ state: 'disconnected', message: expect.any(String) });
    sim = new MiniserverSimulator();
  });

  it('meldet 400, wenn der Miniserver Verschlüsselung verlangt', async () => {
    const c = await setup({ requireEncryption: true }, { encryption: 'never' });
    await expect(c.connect()).rejects.toThrow(/Verschlüsselung/);
  });

  it('verbindet nach Abbruch neu und meldet sich mit dem Token an', async () => {
    const c = await setup();
    await c.connect();
    const getjwt = (): number => sim.commands.filter((x) => x.startsWith('jdev/sys/getjwt')).length;
    expect(getjwt()).toBe(1);
    sim.dropConnections();
    await until(() => c.state === 'connecting');
    await until(() => c.state === 'connected');
    expect(sim.commands.some((x) => x.startsWith('authwithtoken/'))).toBe(true);
    expect(getjwt()).toBe(1);
  });

  it('holt ein neues Token, wenn das alte widerrufen wurde', async () => {
    const c = await setup();
    await c.connect();
    sim.revokeTokens();
    sim.dropConnections();
    await until(() => c.state === 'connected' && sim.connections === 2);
    expect(sim.commands.filter((x) => x.startsWith('jdev/sys/getjwt')).length).toBe(2);
  });

  it('erneuert das Token vor Ablauf', async () => {
    const c = await setup({ tokenLifetimeS: 2 }, { tokenRefreshMarginMs: 1900 });
    await c.connect();
    await until(() => sim.commands.some((x) => x.startsWith('jdev/sys/refreshjwt/')));
    expect(c.state).toBe('connected');
  });

  it('sendet Keepalive und verbindet neu, wenn keine Antwort kommt', async () => {
    const c = await setup({}, { keepaliveIntervalMs: 30, keepaliveTimeoutMs: 40 });
    await c.connect();
    await until(() => sim.raw.includes('keepalive'));
    expect(c.state).toBe('connected');
    sim.fault = 'noKeepalive';
    await until(() => c.state !== 'connected');
    sim.fault = undefined;
    await until(() => c.state === 'connected' && sim.connections >= 2);
  });

  it('verbindet neu bei Zeitüberschreitung eines Befehls', async () => {
    const c = await setup({}, { commandTimeoutMs: 100 });
    await c.connect();
    sim.fault = 'silent';
    await expect(c.setVirtualInput(UUID_A, 3)).rejects.toThrow(/Zeitüberschreitung/);
    sim.fault = undefined;
    await until(() => c.state === 'connected' && sim.connections >= 2);
  });

  it('behandelt „außer Betrieb“ und Sperre (4003)', async () => {
    const c = await setup({}, { reconnect: false });
    sim.fault = 'outOfService';
    await c.connect();
    await until(() => c.state === 'connecting');
    expect(c.status.message).toMatch(/außer Betrieb/);
    await c.disconnect();

    sim.fault = 'blocked';
    const port = (sim as unknown as { http: { address(): { port: number } } }).http.address().port;
    const blocked = new MiniserverWsClient({
      credentials: () => ({ host: '127.0.0.1', port, user: sim.user, password: sim.password }),
      commandTimeoutMs: 500,
    });
    await expect(blocked.connect()).rejects.toBeInstanceOf(MiniserverError);
    await blocked.disconnect();
  });

  it('widerruft das Token beim Trennen', async () => {
    const c = await setup();
    await c.connect();
    expect(sim.tokens.size).toBe(1);
    await c.disconnect();
    expect(sim.commands.some((x) => x.startsWith('jdev/sys/killtoken/'))).toBe(true);
    expect(sim.tokens.size).toBe(0);
    expect(c.state).toBe('disconnected');
    await expect(c.readValue(UUID_A)).rejects.toThrow(/nicht verbunden/);
  });

  it('meldet eine nicht erreichbare Adresse', async () => {
    const c = await setup({}, { reconnect: false });
    await sim.stop();
    await expect(c.connect()).rejects.toThrow(/Keine Verbindung/);
    expect(c.state).toBe('error');
    sim = new MiniserverSimulator();
  });

  it('startet mit neuen Zugangsdaten neu', async () => {
    const c = await setup();
    await c.connect();
    await c.restart();
    expect(c.state).toBe('connected');
    expect(sim.connections).toBe(2);
  });
});
