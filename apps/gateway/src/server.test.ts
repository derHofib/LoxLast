import { afterEach, describe, expect, it } from 'vitest';
import {
  ChangelogResponseSchema,
  ErrorResponseSchema,
  HealthResponseSchema,
  TokenResponseSchema,
} from '@lastplan/protocol';
import { makeServer, pairedToken } from './test-helpers';

type Ctx = Awaited<ReturnType<typeof makeServer>>;
let ctx: Ctx;
afterEach(async () => ctx.app.close());

describe('GET /api/health', () => {
  it('antwortet mit gültigem Health-Schema', async () => {
    ctx = await makeServer();
    const res = await ctx.app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(HealthResponseSchema.parse(res.json()).service).toBe('lastplan-gateway');
  });
});

describe('Pairing', () => {
  it('Einmalcode → Token, Code nur einmal nutzbar', async () => {
    ctx = await makeServer();
    const { code } = ctx.pairing.issueCode();
    const ok = await ctx.app.inject({
      method: 'POST',
      url: '/api/pair',
      payload: { code: code.toLowerCase() },
    });
    expect(ok.statusCode).toBe(200);
    TokenResponseSchema.parse(ok.json());
    const again = await ctx.app.inject({ method: 'POST', url: '/api/pair', payload: { code } });
    expect(again.statusCode).toBe(401);
    expect(errorCode(again.json())).toBe('pairing_code_invalid');
  });

  it('falscher Code und fehlerhaftes Format', async () => {
    ctx = await makeServer();
    ctx.pairing.issueCode();
    const bad = await ctx.app.inject({
      method: 'POST',
      url: '/api/pair',
      payload: { code: 'AAAA-BBBB' },
    });
    expect(bad.statusCode).toBe(401);
    const fmt = await ctx.app.inject({ method: 'POST', url: '/api/pair', payload: { code: 'x' } });
    expect(fmt.statusCode).toBe(400);
  });

  it('Pairing wird nach 5 Versuchen pro Minute gedrosselt', async () => {
    ctx = await makeServer();
    ctx.pairing.issueCode();
    const codes: number[] = [];
    for (let i = 0; i < 7; i++) {
      const r = await ctx.app.inject({
        method: 'POST',
        url: '/api/pair',
        payload: { code: 'AAAA-BBBB' },
      });
      codes.push(r.statusCode);
    }
    expect(codes.slice(0, 5).every((c) => c === 401)).toBe(true);
    expect(codes[5]).toBe(429);
    expect(errorCode(JSON.parse('{"error":{"code":"rate_limited","message":"x"}}'))).toBe(
      'rate_limited',
    );
  });

  it('Token erneuern widerruft das alte Token', async () => {
    ctx = await makeServer();
    const old = await pairedToken(ctx);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/token/refresh',
      headers: { authorization: `Bearer ${old}` },
    });
    expect(res.statusCode).toBe(200);
    const fresh = (res.json() as { token: string }).token;
    expect(fresh).not.toBe(old);
    const withOld = await ctx.app.inject({
      method: 'GET',
      url: '/api/credentials',
      headers: { authorization: `Bearer ${old}` },
    });
    expect(withOld.statusCode).toBe(401);
    const withNew = await ctx.app.inject({
      method: 'GET',
      url: '/api/credentials',
      headers: { authorization: `Bearer ${fresh}` },
    });
    expect(withNew.statusCode).toBe(200);
  });
});

describe('Authentifizierung', () => {
  it.each([
    ['GET', '/api/credentials'],
    ['GET', '/api/changelog'],
    ['PUT', '/api/credentials/ms-1'],
    ['DELETE', '/api/credentials/ms-1'],
    ['POST', '/api/token/refresh'],
  ] as const)('%s %s ohne Token → 401', async (method, url) => {
    ctx = await makeServer();
    const res = await ctx.app.inject({ method, url });
    expect(res.statusCode).toBe(401);
  });
});

describe('CORS', () => {
  it('erlaubt freigegebene Origin', async () => {
    ctx = await makeServer();
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { origin: 'http://localhost:5173' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });
  it('lehnt fremde Origin mit 403 ab', async () => {
    ctx = await makeServer();
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { origin: 'https://evil.example' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    expect(errorCode(res.json())).toBe('forbidden_origin');
  });
});

describe('Rate-Limit global', () => {
  it('drosselt nach Überschreitung', async () => {
    ctx = await makeServer({ rateLimitPerMinute: 3 });
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++)
      statuses.push((await ctx.app.inject({ method: 'GET', url: '/api/health' })).statusCode);
    expect(statuses).toEqual([200, 200, 200, 429, 429]);
  });
});

describe('Credentials-API', () => {
  it('speichert verschlüsselt, liefert nie Geheimnisse, protokolliert ohne Passwort', async () => {
    ctx = await makeServer();
    const token = await pairedToken(ctx);
    const headers = { authorization: `Bearer ${token}` };
    const put = await ctx.app.inject({
      method: 'PUT',
      url: '/api/credentials/ms-1',
      headers,
      payload: {
        kind: 'miniserver',
        label: 'Test-Miniserver',
        username: 'admin',
        password: 'geheim-123',
      },
    });
    expect(put.statusCode).toBe(201);
    expect(JSON.stringify(put.json())).not.toContain('geheim');

    const list = await ctx.app.inject({ method: 'GET', url: '/api/credentials', headers });
    expect(JSON.stringify(list.json())).not.toContain('geheim');
    expect(list.json().credentials).toHaveLength(1);

    // In der DB steht kein Klartext
    const raw = ctx.db.prepare('SELECT * FROM credentials').get() as { ciphertext: Buffer };
    expect(raw.ciphertext.toString('utf8')).not.toContain('geheim');
    expect(ctx.credentials.getSecret('ms-1')).toEqual({
      username: 'admin',
      password: 'geheim-123',
    });

    const upd = await ctx.app.inject({
      method: 'PUT',
      url: '/api/credentials/ms-1',
      headers,
      payload: { kind: 'miniserver', label: 'Test-Miniserver', password: 'neu' },
    });
    expect(upd.statusCode).toBe(200);
    expect(ctx.credentials.getSecret('ms-1')).toEqual({ password: 'neu' });

    const log = await ctx.app.inject({ method: 'GET', url: '/api/changelog', headers });
    const parsed = ChangelogResponseSchema.parse(log.json());
    expect(parsed.entries.map((e) => e.action)).toEqual([
      'credential.set',
      'credential.set',
      'pairing.success',
    ]);
    expect(JSON.stringify(parsed)).not.toContain('geheim');

    const del = await ctx.app.inject({ method: 'DELETE', url: '/api/credentials/ms-1', headers });
    expect(del.statusCode).toBe(204);
    const del2 = await ctx.app.inject({ method: 'DELETE', url: '/api/credentials/ms-1', headers });
    expect(del2.statusCode).toBe(404);
  });

  it('lehnt ungültige ID und Body ab', async () => {
    ctx = await makeServer();
    const headers = { authorization: `Bearer ${await pairedToken(ctx)}` };
    const badId = await ctx.app.inject({
      method: 'PUT',
      url: '/api/credentials/Gross',
      headers,
      payload: { kind: 'device', label: 'a', password: 'b' },
    });
    expect(badId.statusCode).toBe(400);
    const badBody = await ctx.app.inject({
      method: 'PUT',
      url: '/api/credentials/ok',
      headers,
      payload: { kind: 'x' },
    });
    expect(badBody.statusCode).toBe(400);
    const badDel = await ctx.app.inject({
      method: 'DELETE',
      url: '/api/credentials/Gross',
      headers,
    });
    expect(badDel.statusCode).toBe(400);
  });
});

describe('Änderungsprotokoll', () => {
  it('ist append-only und paginiert', async () => {
    ctx = await makeServer();
    for (let i = 0; i < 5; i++) ctx.changelog.record('token.refresh', `t${i}`);
    expect(() => ctx.db.prepare('DELETE FROM changelog').run()).toThrow(/unveränderlich/);
    expect(() => ctx.db.prepare("UPDATE changelog SET action='x'").run()).toThrow(/unveränderlich/);
    const headers = { authorization: `Bearer ${await pairedToken(ctx)}` };
    const page = await ctx.app.inject({ method: 'GET', url: '/api/changelog?limit=2', headers });
    expect(page.json().entries).toHaveLength(2);
    const bad = await ctx.app.inject({ method: 'GET', url: '/api/changelog?limit=0', headers });
    expect(bad.statusCode).toBe(400);
    const before = page.json().entries[1].id as number;
    const next = await ctx.app.inject({
      method: 'GET',
      url: `/api/changelog?limit=50&beforeId=${before}`,
      headers,
    });
    expect(next.json().entries.every((e: { id: number }) => e.id < before)).toBe(true);
  });
});

function errorCode(body: unknown): string {
  return ErrorResponseSchema.parse(body).error.code;
}
