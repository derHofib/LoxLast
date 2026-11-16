import { buildLibraryPackage } from '@lastplan/wallbox-library';
import { describe, expect, it, vi } from 'vitest';
import { bundledModelFiles } from './catalog';
import { fetchRemoteLibrary, type FetchFn } from './remote';

const URL_UNDER_TEST = 'https://example.test/library.json';

function validBody(version = 'v1'): Record<string, unknown> {
  const built = buildLibraryPackage(bundledModelFiles, {
    version,
    generatedAt: '2026-11-16T00:00:00.000Z',
  });
  if (!built.ok) throw new Error(built.errors.join('; '));
  return JSON.parse(JSON.stringify(built.library)) as Record<string, unknown>;
}

function respond(body: unknown, status = 200): FetchFn {
  return vi.fn<FetchFn>(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }));
}

describe('fetchRemoteLibrary', () => {
  it('übernimmt ein vollständig gültiges Paket', async () => {
    const result = await fetchRemoteLibrary(URL_UNDER_TEST, respond(validBody('abc1234')));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.remote.library.version).toBe('abc1234');
    expect(result.remote.checks.map((check) => check.model?.id)).toContain('abl/em4-twin@1');
  });

  it('lehnt das ganze Paket ab, wenn ein Modell ungültig ist', async () => {
    const body = validBody();
    (body['models'] as unknown[]).push({ id: 'abl/kaputt@1', vendor: 'ABL' });
    const result = await fetchRemoteLibrary(URL_UNDER_TEST, respond(body));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('ungültig');
    expect(result.error).toContain('abl/kaputt@1');
  });

  it('meldet einen Netzwerkfehler als Ergebnis statt als Ausnahme', async () => {
    const failing: FetchFn = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const result = await fetchRemoteLibrary(URL_UNDER_TEST, failing);
    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(result.error).toContain('keine Verbindung');
  });

  it('meldet HTTP-Fehler und kaputtes JSON als Fehler', async () => {
    const notFound = await fetchRemoteLibrary(URL_UNDER_TEST, respond({}, 404));
    expect(notFound).toMatchObject({ ok: false, error: expect.stringContaining('HTTP 404') });

    const broken: FetchFn = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token');
      },
    }));
    const badJson = await fetchRemoteLibrary(URL_UNDER_TEST, broken);
    expect(badJson).toMatchObject({ ok: false });
  });

  it('schickt nur den Abruf, ohne Zugangsdaten oder Zusatzdaten', async () => {
    const fetchFn = respond(validBody());
    await fetchRemoteLibrary(URL_UNDER_TEST, fetchFn);
    expect(fetchFn).toHaveBeenCalledWith(URL_UNDER_TEST, {
      cache: 'no-store',
      credentials: 'omit',
    });
  });
});
