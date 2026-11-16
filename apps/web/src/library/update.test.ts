import 'fake-indexeddb/auto';
import { buildLibraryPackage, type LibraryPackage } from '@lastplan/wallbox-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bundledCatalog, bundledModelFiles } from './catalog';
import type { LibraryCache } from './cache';
import { dexieLibraryCache } from './cache';
import { LIBRARY_URL } from './config';
import { resetToBundledLibrary, useLibraryStore } from './libraryStore';
import type { FetchFn } from './remote';
import {
  checkForLibraryUpdate,
  restoreCachedLibrary,
  startLibraryUpdates,
  type UpdateOptions,
} from './update';
import type { LibraryCacheRow } from '../storage/db';

const URL_UNDER_TEST = 'https://example.test/library.json';

function packageBody(version: string): Record<string, unknown> {
  const built = buildLibraryPackage(bundledModelFiles, {
    version,
    generatedAt: '2026-11-16T00:00:00.000Z',
  });
  if (!built.ok) throw new Error(built.errors.join('; '));
  return JSON.parse(JSON.stringify(built.library)) as Record<string, unknown>;
}

function respond(body: unknown): FetchFn {
  return vi.fn<FetchFn>(async () => ({ ok: true, status: 200, json: async () => body }));
}

function memoryCache(initial?: LibraryCacheRow): LibraryCache & { writes: LibraryCacheRow[] } {
  let row = initial;
  const writes: LibraryCacheRow[] = [];
  return {
    writes,
    read: async () => row,
    write: async (next) => {
      writes.push(next);
      row = next;
    },
  };
}

function options(extra: Partial<UpdateOptions> = {}): UpdateOptions {
  return { url: URL_UNDER_TEST, cache: memoryCache(), ...extra };
}

beforeEach(() => resetToBundledLibrary());
afterEach(() => resetToBundledLibrary());

describe('checkForLibraryUpdate', () => {
  it('übernimmt eine neue Version und speichert sie zwischen', async () => {
    const cache = memoryCache();
    const result = await checkForLibraryUpdate(
      options({ cache, fetchFn: respond(packageBody('v2')), now: () => new Date('2026-11-16') }),
    );
    expect(result).toEqual({ status: 'updated', version: 'v2', cached: true });
    expect(useLibraryStore.getState()).toMatchObject({ source: 'nachgeladen', version: 'v2' });
    expect(cache.writes).toHaveLength(1);
    expect(cache.writes[0]).toMatchObject({
      key: 'remote',
      url: URL_UNDER_TEST,
      fetchedAt: '2026-11-16T00:00:00.000Z',
    });
  });

  it('tut nichts, wenn die Version gleich bleibt', async () => {
    const cache = memoryCache();
    const fetchFn = respond(packageBody('v2'));
    await checkForLibraryUpdate(options({ cache, fetchFn }));
    const before = useLibraryStore.getState();

    const again = await checkForLibraryUpdate(options({ cache, fetchFn }));
    expect(again).toEqual({ status: 'unchanged', version: 'v2' });
    expect(cache.writes).toHaveLength(1);
    expect(useLibraryStore.getState()).toBe(before);
  });

  it('lässt die gebündelte Bibliothek bei Netzwerkfehler unverändert', async () => {
    const failing: FetchFn = vi.fn(async () => {
      throw new TypeError('offline');
    });
    const cache = memoryCache();
    const result = await checkForLibraryUpdate(options({ cache, fetchFn: failing }));
    expect(result.status).toBe('error');
    expect(cache.writes).toHaveLength(0);
    expect(useLibraryStore.getState()).toMatchObject({
      source: 'gebündelt',
      version: null,
      catalog: bundledCatalog,
    });
  });

  it('übernimmt kein ungültiges Paket', async () => {
    const body = packageBody('v3');
    (body['models'] as unknown[]).push({ id: 'abl/kaputt@1' });
    const result = await checkForLibraryUpdate(options({ fetchFn: respond(body) }));
    expect(result.status).toBe('error');
    expect(useLibraryStore.getState().source).toBe('gebündelt');
  });

  it('übernimmt das Paket auch, wenn der Speicher nicht schreibbar ist', async () => {
    const broken: LibraryCache = {
      read: async () => undefined,
      write: async () => {
        throw new Error('QuotaExceeded');
      },
    };
    const result = await checkForLibraryUpdate(
      options({ cache: broken, fetchFn: respond(packageBody('v4')) }),
    );
    expect(result).toEqual({ status: 'updated', version: 'v4', cached: false });
    expect(useLibraryStore.getState().version).toBe('v4');
  });
});

describe('restoreCachedLibrary', () => {
  it('stellt ein zuvor geprüftes Paket wieder her', async () => {
    const cache = memoryCache({
      key: 'remote',
      url: URL_UNDER_TEST,
      fetchedAt: '2026-11-15T00:00:00.000Z',
      library: packageBody('alt') as unknown as LibraryPackage,
    });
    expect(await restoreCachedLibrary(options({ cache }))).toBe(true);
    expect(useLibraryStore.getState()).toMatchObject({ source: 'nachgeladen', version: 'alt' });
  });

  it('prüft den Zwischenspeicher erneut und verwirft Beschädigtes', async () => {
    const cache = memoryCache({
      key: 'remote',
      url: URL_UNDER_TEST,
      fetchedAt: '2026-11-15T00:00:00.000Z',
      library: {
        formatVersion: 1,
        version: 'x',
        generatedAt: 'x',
        models: [{ id: 'kaputt' }],
      } as unknown as LibraryPackage,
    });
    expect(await restoreCachedLibrary(options({ cache }))).toBe(false);
    expect(useLibraryStore.getState().source).toBe('gebündelt');
  });

  it('übernimmt keinen Zwischenspeicher einer anderen URL', async () => {
    const cache = memoryCache({
      key: 'remote',
      url: 'https://anders.test/library.json',
      fetchedAt: '2026-11-15T00:00:00.000Z',
      library: packageBody('alt') as unknown as LibraryPackage,
    });
    expect(await restoreCachedLibrary(options({ cache }))).toBe(false);
  });

  it('schluckt Lesefehler und bleibt bei der gebündelten Bibliothek', async () => {
    const cache: LibraryCache = {
      read: async () => {
        throw new Error('gesperrt');
      },
      write: async () => undefined,
    };
    expect(await restoreCachedLibrary(options({ cache }))).toBe(false);
  });
});

describe('startLibraryUpdates', () => {
  it('fragt in Tests nicht beim Start nach (kein Netz)', async () => {
    const fetchFn = respond(packageBody('v9'));
    const result = await startLibraryUpdates(options({ fetchFn }));
    expect(result).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe('Zwischenspeicher in IndexedDB', () => {
  it('speichert das Paket in Dexie und liest es beim nächsten Start wieder', async () => {
    const remote = await checkForLibraryUpdate({
      url: LIBRARY_URL,
      fetchFn: respond(packageBody('dexie-1')),
      cache: dexieLibraryCache,
    });
    expect(remote).toMatchObject({ status: 'updated', cached: true });

    resetToBundledLibrary();
    expect(await restoreCachedLibrary({ url: LIBRARY_URL, cache: dexieLibraryCache })).toBe(true);
    expect(useLibraryStore.getState().version).toBe('dexie-1');
  });
});
