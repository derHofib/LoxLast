import { afterEach, describe, expect, it } from 'vitest';
import {
  ChangelogResponseSchema,
  ErrorResponseSchema,
  HealthResponseSchema,
  MiniserverConfigResponseSchema,
  TokenResponseSchema,
} from '@lastplan/protocol';
import { MockMiniserverClient } from './clients/mocks';
import { makeServer, pairedToken } from './test-helpers';

type Ctx = Awaited<ReturnType<typeof makeServer>>;
let ctx: Ctx;
afterEach(async () => ctx.app.close());

const errorCode = (body: unknown): string => ErrorResponseSchema.parse(body).error.code;
const PROJECT = '0190a1b2-c3d4-7e5f-8a6b-1234567890ab';

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
      url: '/api/auth/pair',
      payload: { code: code.toLowerCase() },
    });
    expect(ok.statusCode).toBe(200);
    TokenResponseSchema.parse(ok.json());
    const again = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/pair',
      payload: { code },
    });
    expect(again.statusCode).toBe(401);
    expect(errorCode(again.json())).toBe('pairing_code_invalid');
  });

  it('falscher Code und fehlerhaftes Format', async () => {
    ctx = await makeServer();
    ctx.pairing.issueCode();
    const bad = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/pair',
      payload: { code: 'AAAA-BBBB' },
    });
    expect(bad.statusCode).toBe(401);
    const fmt = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/pair',
      payload: { code: 'x' },
    });
    expect(fmt.statusCode).toBe(400);
  });

  it('Pairing wird nach 5 Versuchen pro Minute gedrosselt', async () => {
    ctx = await makeServer();
    ctx.pairing.issueCode();
    const codes: number[] = [];
    let last: unknown;
    for (let i = 0; i < 7; i++) {
      const r = await ctx.app.inject({
        method: 'POST',
        url: '/api/auth/pair',
        payload: { code: 'AAAA-BBBB' },
      });
      codes.push(r.statusCode);
      last = r.json();
    }
    expect(codes.slice(0, 5).every((c) => c === 401)).toBe(true);
    expect(codes[5]).toBe(429);
    expect(errorCode(last)).toBe('rate_limited');
  });

  it('Token erneuern widerruft das alte Token', async () => {
    ctx = await makeServer();
    const old = await pairedToken(ctx);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      headers: { authorization: `Bearer ${old}` },
    });
    expect(res.statusCode).toBe(200);
    const fresh = (res.json() as { token: string }).token;
    expect(fresh).not.toBe(old);
    const status = (token: string) =>
      ctx.app.inject({
        method: 'GET',
        url: '/api/miniserver/status',
        headers: { authorization: `Bearer ${token}` },
      });
    expect((await status(old)).statusCode).toBe(401);
    expect((await status(fresh)).statusCode).toBe(200);
  });
});

describe('Authentifizierung', () => {
  it.each([
    ['GET', '/api/miniserver/status'],
    ['POST', '/api/miniserver'],
    ['POST', '/api/auth/refresh'],
    ['POST', '/api/devices/test'],
    ['GET', `/api/projects/${PROJECT}/live`],
    ['POST', `/api/projects/${PROJECT}/parameters`],
    ['GET', `/api/projects/${PROJECT}/changelog`],
    ['POST', `/api/projects/${PROJECT}/changelog/1/revert`],
  ] as const)('%s %s ohne Token → 401', async (method, url) => {
    ctx = await makeServer();
    const res = await ctx.app.inject({ method, url });
    expect(res.statusCode).toBe(401);
  });

  it('noch nicht umgesetzte Endpunkte → 501 mit Hinweis', async () => {
    ctx = await makeServer();
    const headers = { authorization: `Bearer ${await pairedToken(ctx)}` };
    for (const [method, url] of [
      ['POST', '/api/devices/test'],
      ['GET', `/api/projects/${PROJECT}/live`],
      ['POST', `/api/projects/${PROJECT}/parameters`],
      ['POST', `/api/projects/${PROJECT}/changelog/1/revert`],
    ] as const) {
      const res = await ctx.app.inject({ method, url, headers });
      expect(res.statusCode).toBe(501);
      expect(errorCode(res.json())).toBe('not_implemented');
    }
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

describe('Miniserver-Zugang', () => {
  it('speichert verschlüsselt, liefert nie das Passwort, protokolliert ohne Passwort', async () => {
    ctx = await makeServer();
    const headers = { authorization: `Bearer ${await pairedToken(ctx)}` };
    const put = await ctx.app.inject({
      method: 'POST',
      url: '/api/miniserver',
      headers,
      payload: { host: '192.168.1.77', user: 'admin', password: 'geheim-123' },
    });
    expect(put.statusCode).toBe(201);
    expect(MiniserverConfigResponseSchema.parse(put.json())).toEqual({
      configured: true,
      host: '192.168.1.77',
      user: 'admin',
    });
    expect(put.body).not.toContain('geheim');

    const raw = ctx.db.prepare('SELECT * FROM credentials').get() as {
      ciphertext: Buffer;
      label: string;
    };
    expect(raw.ciphertext.toString('utf8')).not.toContain('geheim');
    expect(JSON.stringify(raw)).not.toContain('geheim');
    expect(ctx.credentials.getSecret('miniserver')).toEqual({
      host: '192.168.1.77',
      username: 'admin',
      password: 'geheim-123',
    });

    const upd = await ctx.app.inject({
      method: 'POST',
      url: '/api/miniserver',
      headers,
      payload: { host: 'ms.example.de', user: 'admin', password: 'neu' },
    });
    expect(upd.statusCode).toBe(200);

    // Das Protokoll enthält Host/Benutzer, aber nie das Passwort.
    const rows = JSON.stringify(ctx.db.prepare('SELECT * FROM changelog').all());
    expect(rows).toContain('miniserver.configure');
    expect(rows).not.toContain('geheim');
    expect(rows).not.toContain('"neu"');
  });

  it.each([
    [{ host: 'http://x', user: 'a', password: 'b' }],
    [{ host: '192.168.1.1:80', user: 'a', password: 'b' }],
    [{ host: 'ok.de', user: '', password: 'b' }],
    [{ host: 'ok.de', user: 'a' }],
  ])('lehnt ungültige Eingabe %j ab', async (payload) => {
    ctx = await makeServer();
    const headers = { authorization: `Bearer ${await pairedToken(ctx)}` };
    const res = await ctx.app.inject({ method: 'POST', url: '/api/miniserver', headers, payload });
    expect(res.statusCode).toBe(400);
  });

  it('Status: getrennt ohne Client, sonst Zustand des Clients', async () => {
    ctx = await makeServer();
    const headers = { authorization: `Bearer ${await pairedToken(ctx)}` };
    const s1 = await ctx.app.inject({ method: 'GET', url: '/api/miniserver/status', headers });
    expect(s1.json()).toEqual({ state: 'disconnected', lastValuesAt: null, configured: false });
    await ctx.app.close();

    const mock = new MockMiniserverClient();
    await mock.connect();
    ctx = await makeServer({ miniserver: mock });
    const h2 = { authorization: `Bearer ${await pairedToken(ctx)}` };
    const s2 = await ctx.app.inject({ method: 'GET', url: '/api/miniserver/status', headers: h2 });
    expect(s2.json().state).toBe('connected');
  });
});

describe('Änderungsprotokoll', () => {
  it('ist append-only, projektbezogen abfragbar und paginiert', async () => {
    ctx = await makeServer();
    for (let i = 0; i < 5; i++)
      ctx.changelog.record({
        action: 'parameter.write',
        projectId: PROJECT,
        target: `p${i}`,
        before: i,
        after: i + 1,
      });
    ctx.changelog.record({
      action: 'parameter.write',
      projectId: '0190a1b2-c3d4-7e5f-8a6b-ffffffffffff',
      target: 'fremd',
    });
    expect(() => ctx.db.prepare('DELETE FROM changelog').run()).toThrow(/unveränderlich/);
    expect(() => ctx.db.prepare("UPDATE changelog SET action='x'").run()).toThrow(/unveränderlich/);

    const headers = { authorization: `Bearer ${await pairedToken(ctx)}` };
    const page = await ctx.app.inject({
      method: 'GET',
      url: `/api/projects/${PROJECT}/changelog?limit=2`,
      headers,
    });
    const parsed = ChangelogResponseSchema.parse(page.json());
    expect(parsed.entries.map((e) => e.target)).toEqual(['p4', 'p3']);
    expect(parsed.entries[0]).toMatchObject({ before: 4, after: 5, projectId: PROJECT });

    const next = await ctx.app.inject({
      method: 'GET',
      url: `/api/projects/${PROJECT}/changelog?limit=50&beforeId=${parsed.entries[1]?.id}`,
      headers,
    });
    expect(next.json().entries.map((e: { target: string }) => e.target)).toEqual([
      'p2',
      'p1',
      'p0',
    ]);

    expect(
      (
        await ctx.app.inject({
          method: 'GET',
          url: `/api/projects/${PROJECT}/changelog?limit=0`,
          headers,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await ctx.app.inject({ method: 'GET', url: '/api/projects/kein-uuid/changelog', headers }))
        .statusCode,
    ).toBe(400);
  });
});
