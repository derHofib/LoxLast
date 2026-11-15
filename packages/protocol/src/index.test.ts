import { describe, expect, it } from 'vitest';
import {
  ChangelogQuerySchema,
  ClientMessageSchema,
  CredentialIdSchema,
  CredentialWriteSchema,
  HealthResponseSchema,
  PairRequestSchema,
  ServerMessageSchema,
} from './index';

describe('HealthResponseSchema', () => {
  it('akzeptiert gültige Antwort', () =>
    expect(
      HealthResponseSchema.safeParse({
        status: 'ok',
        service: 'lastplan-gateway',
        version: '0.1.0',
      }).success,
    ).toBe(true));
  it('lehnt fremde Dienste ab', () =>
    expect(
      HealthResponseSchema.safeParse({ status: 'ok', service: 'x', version: '0.1.0' }).success,
    ).toBe(false));
});

describe('PairRequestSchema', () => {
  it('normalisiert Groß-/Kleinschreibung und Leerraum', () =>
    expect(PairRequestSchema.parse({ code: ' abcd-2345 ' }).code).toBe('ABCD-2345'));
  it.each(['ABCD2345', 'ABCD-234', 'OOOO-1111', ''])('lehnt %j ab', (code) =>
    expect(PairRequestSchema.safeParse({ code }).success).toBe(false),
  );
});

describe('Credentials', () => {
  it('ID-Format', () => {
    expect(CredentialIdSchema.safeParse('miniserver-1').success).toBe(true);
    expect(CredentialIdSchema.safeParse('../etc').success).toBe(false);
    expect(CredentialIdSchema.safeParse('Gross').success).toBe(false);
  });
  it('Passwort ist Pflicht', () =>
    expect(
      CredentialWriteSchema.safeParse({ kind: 'device', label: 'x', password: '' }).success,
    ).toBe(false));
});

describe('Changelog-Abfrage', () => {
  it('Standardlimit 100', () => expect(ChangelogQuerySchema.parse({}).limit).toBe(100));
  it('begrenzt auf 500', () =>
    expect(ChangelogQuerySchema.safeParse({ limit: '501' }).success).toBe(false));
});

describe('WebSocket-Nachrichten', () => {
  it('auth braucht Token', () => {
    expect(ClientMessageSchema.safeParse({ type: 'auth', token: 'x' }).success).toBe(false);
    expect(ClientMessageSchema.safeParse({ type: 'auth', token: 'x'.repeat(30) }).success).toBe(
      true,
    );
  });
  it('unbekannter Typ wird abgelehnt', () => {
    expect(ClientMessageSchema.safeParse({ type: 'boom' }).success).toBe(false);
    expect(ServerMessageSchema.safeParse({ type: 'pong' }).success).toBe(true);
  });
});
