import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildLibraryPackage, checkLibraryPackage, LIBRARY_FORMAT_VERSION } from './package';
import { loadLibrary } from './loader';

const ABL_PATH = 'abl/em4-twin@1.json';
const ablContent = readFileSync(
  fileURLToPath(new URL(`../models/${ABL_PATH}`, import.meta.url)),
  'utf-8',
);
const META = { version: 'abc1234', generatedAt: '2026-11-16T00:00:00.000Z' };

function validPackage(): Record<string, unknown> {
  const built = buildLibraryPackage([{ path: ABL_PATH, content: ablContent }], META);
  if (!built.ok) throw new Error(built.errors.join('; '));
  return JSON.parse(JSON.stringify(built.library)) as Record<string, unknown>;
}

describe('buildLibraryPackage', () => {
  it('baut Paket und Index aus gültigen Modelldateien', () => {
    const result = buildLibraryPackage([{ path: ABL_PATH, content: ablContent }], META);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.library.formatVersion).toBe(LIBRARY_FORMAT_VERSION);
    expect(result.library.version).toBe('abc1234');
    expect(result.library.generatedAt).toBe(META.generatedAt);
    expect(result.library.models.map((model) => model.id)).toEqual(['abl/em4-twin@1']);
    expect(result.index).toEqual({ version: 'abc1234', modelCount: 1 });
  });

  it('veröffentlicht nichts, wenn eine Datei ungültig ist', () => {
    const result = buildLibraryPackage(
      [{ path: 'abl/kaputt@1.json', content: '{ "id": "abl/kaputt@1" }' }],
      META,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toMatch(/^abl\/kaputt@1\.json:/);
  });

  it('bricht ab, wenn eine Kennung doppelt vorkommt', () => {
    const result = buildLibraryPackage(
      [
        { path: ABL_PATH, content: ablContent },
        { path: ABL_PATH, content: ablContent },
      ],
      META,
    );
    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(result.errors).toEqual(['Kennung abl/em4-twin@1 kommt mehrfach vor.']);
  });

  it('sortiert die Modelle nach Kennung', () => {
    const other = JSON.parse(ablContent) as Record<string, unknown>;
    other['id'] = 'abl/aaa@1';
    const result = buildLibraryPackage(
      [
        { path: ABL_PATH, content: ablContent },
        { path: 'abl/aaa@1.json', content: JSON.stringify(other) },
      ],
      META,
    );
    expect(result.ok && result.library.models.map((model) => model.id)).toEqual([
      'abl/aaa@1',
      'abl/em4-twin@1',
    ]);
  });
});

describe('checkLibraryPackage', () => {
  it('nimmt ein gebautes Paket an, auch mit unvollständigen Modellen', () => {
    const result = checkLibraryPackage(validPackage());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.checks.map((check) => check.status)).toEqual(['incomplete']);
    expect(result.library.models).toHaveLength(1);
  });

  it('lehnt andere formatVersion ab', () => {
    const data = { ...validPackage(), formatVersion: 2 };
    const result = checkLibraryPackage(data);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(' ')).toContain('formatVersion 2 wird nicht unterstützt');
  });

  it('lehnt ein Paket ohne version oder mit kaputter Modellliste ab', () => {
    const noVersion = { ...validPackage(), version: '' };
    expect(checkLibraryPackage(noVersion).ok).toBe(false);
    const noList = { ...validPackage(), models: 'abl' };
    expect(checkLibraryPackage(noList).ok).toBe(false);
  });

  it('lehnt das ganze Paket ab, wenn ein einziges Modell ungültig ist', () => {
    const data = validPackage();
    const models = data['models'] as Array<Record<string, unknown>>;
    models.push({ id: 'abl/kaputt@1', vendor: 'ABL' });
    const result = checkLibraryPackage(data);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((error) => error.startsWith('abl/kaputt@1:'))).toBe(true);
  });

  it('lehnt doppelte Kennungen im Paket ab', () => {
    const data = validPackage();
    const models = data['models'] as unknown[];
    models.push(models[0]);
    const result = checkLibraryPackage(data);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toContain('Kennung abl/em4-twin@1 kommt 2-mal vor.');
  });

  it('lehnt Nicht-Objekte ab', () => {
    expect(checkLibraryPackage(null).ok).toBe(false);
    expect(checkLibraryPackage([]).ok).toBe(false);
  });

  it('bleibt mit dem Loader konsistent', () => {
    const check = loadLibrary([{ path: ABL_PATH, content: ablContent }]);
    expect(check.ok).toBe(true);
  });
});
