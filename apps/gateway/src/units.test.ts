import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './config';
import { open, seal } from './crypto';
import { openDb } from './db';
import { CredentialStore } from './credential-store';
import { PairingService } from './pairing';
import { MockMiniserverClient, MockModbusClient } from './clients/mocks';

const KEY = 'ab'.repeat(32);

describe('crypto', () => {
  it('Rundreise und Manipulationserkennung', () => {
    const key = randomBytes(32);
    const s = seal(key, 'hallo', 'id1');
    expect(open(key, s, 'id1')).toBe('hallo');
    expect(() => open(key, s, 'id2')).toThrow(); // AAD
    expect(() => open(randomBytes(32), s, 'id1')).toThrow(); // falscher Schlüssel
    s.ciphertext[0] = (s.ciphertext[0] as number) ^ 1;
    expect(() => open(key, s, 'id1')).toThrow();
  });
});

describe('CredentialStore', () => {
  it('vertauschte Zeilen werden erkannt', () => {
    const db = openDb(':memory:');
    const store = new CredentialStore(db, randomBytes(32));
    store.set('a', { kind: 'device', label: 'A', password: 'pa' });
    store.set('b', { kind: 'device', label: 'B', password: 'pb' });
    const rowA = db
      .prepare("SELECT iv, tag, ciphertext FROM credentials WHERE id='a'")
      .get() as Record<string, Buffer>;
    db.prepare("UPDATE credentials SET iv=?, tag=?, ciphertext=? WHERE id='b'").run(
      rowA['iv'],
      rowA['tag'],
      rowA['ciphertext'],
    );
    expect(() => store.getSecret('b')).toThrow();
    expect(store.getSecret('unbekannt')).toBeUndefined();
  });
});

describe('Pairing-Ablauf', () => {
  it('Code und Token laufen ab', () => {
    let t = 1_000_000;
    const p = new PairingService(
      openDb(':memory:'),
      { codeTtlMs: 1000, tokenTtlMs: 2000 },
      () => t,
    );
    expect(p.redeem('AAAA-BBBB')).toBeUndefined(); // kein Code ausgegeben
    const { code } = p.issueCode();
    t += 1001;
    expect(p.redeem(code)).toBeUndefined(); // Code abgelaufen
    const second = p.issueCode().code;
    const tok = p.redeem(second);
    expect(tok && p.verify(tok.token)).toBe(true);
    t += 2001;
    expect(tok && p.verify(tok.token)).toBe(false);
    expect(tok && p.refresh(tok.token)).toBeUndefined();
  });
});

describe('Konfiguration', () => {
  const dir = () => mkdtempSync(join(tmpdir(), 'gw-'));
  it('local: Standardwerte, Schlüsseldatei wird angelegt und wiederverwendet', () => {
    const d = dir();
    const c = loadConfig({ GATEWAY_DATA_DIR: d });
    expect(c.profile).toBe('local');
    expect(c.host).toBe('127.0.0.1');
    expect(c.allowedOrigins).toContain('http://localhost:5173');
    expect(statSync(join(d, 'secret.key')).mode & 0o777).toBe(0o600);
    const again = loadConfig({ GATEWAY_DATA_DIR: d });
    expect(again.secretKey.equals(c.secretKey)).toBe(true);
    expect(readFileSync(join(d, 'secret.key'), 'utf8')).toHaveLength(64);
  });
  it('server: Schlüssel und Origins sind Pflicht', () => {
    expect(() => loadConfig({ GATEWAY_PROFILE: 'server' })).toThrow(/GATEWAY_SECRET_KEY/);
    expect(() => loadConfig({ GATEWAY_PROFILE: 'server', GATEWAY_SECRET_KEY: KEY })).toThrow(
      /ALLOWED_ORIGINS/,
    );
    const c = loadConfig({
      GATEWAY_PROFILE: 'server',
      GATEWAY_SECRET_KEY: KEY,
      GATEWAY_ALLOWED_ORIGINS: 'https://lastplan.example.de/',
    });
    expect(c.host).toBe('0.0.0.0');
    expect(c.allowedOrigins).toEqual(['https://lastplan.example.de']);
  });
  it('lehnt ungültige Werte ab', () => {
    expect(() => loadConfig({ GATEWAY_PROFILE: 'x' })).toThrow(ConfigError);
    expect(() =>
      loadConfig({
        GATEWAY_PROFILE: 'server',
        GATEWAY_SECRET_KEY: 'zu-kurz',
        GATEWAY_ALLOWED_ORIGINS: 'https://a.de',
      }),
    ).toThrow(/32 Byte/);
    expect(() =>
      loadConfig({
        GATEWAY_PROFILE: 'server',
        GATEWAY_SECRET_KEY: KEY,
        GATEWAY_ALLOWED_ORIGINS: '*',
      }),
    ).toThrow(ConfigError);
    expect(() =>
      loadConfig({
        GATEWAY_PROFILE: 'server',
        GATEWAY_SECRET_KEY: KEY,
        GATEWAY_ALLOWED_ORIGINS: 'https://a.de/pfad',
      }),
    ).toThrow(ConfigError);
    const base64 = randomBytes(32).toString('base64');
    expect(
      loadConfig({
        GATEWAY_PROFILE: 'server',
        GATEWAY_SECRET_KEY: base64,
        GATEWAY_ALLOWED_ORIGINS: 'https://a.de',
      }).secretKey,
    ).toHaveLength(32);
  });
});

describe('Mocks', () => {
  it('Modbus lesen/schreiben', async () => {
    const m = new MockModbusClient();
    const ep = { host: '10.0.0.5', port: 502, unitId: 1 };
    m.seed(ep, 100, [1, 2]);
    expect(await m.readHoldingRegisters(ep, 100, 2)).toEqual([1, 2]);
    await m.writeSingleRegister(ep, 100, 9);
    expect(await m.readHoldingRegisters(ep, 100, 1)).toEqual([9]);
    await expect(m.readHoldingRegisters(ep, 5, 1)).rejects.toThrow();
  });
  it('Miniserver: Rücklesen bestätigt oder meldet Abweichung', async () => {
    const ms = new MockMiniserverClient();
    await expect(ms.readValue('x')).rejects.toThrow(/nicht verbunden/);
    await ms.connect();
    expect(await ms.setVirtualInput('VI1', 16)).toEqual({ readBack: 16, confirmed: true });
    expect(await ms.readValue('VI1')).toBe(16);
    ms.dropWrites = true;
    expect(await ms.setVirtualInput('VI1', 10)).toEqual({ readBack: 16, confirmed: false });
    await expect(ms.readValue('nope')).rejects.toThrow();
    await ms.disconnect();
    expect(ms.state).toBe('disconnected');
  });
});
