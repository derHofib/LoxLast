import { describe, expect, it } from 'vitest';
import { loadLibrary } from '@lastplan/wallbox-library';
import { bundledModelFiles } from './catalog';

const devFiles = import.meta.glob('./dev-models/**/*.json', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

describe('Entwickler-Testmodell', () => {
  it('ist gültig und vollständig, damit die Übergabe im Testprojekt läuft', () => {
    const files = Object.entries(devFiles).map(([path, content]) => ({
      path: path.replace(/^.*\/dev-models\//, ''),
      content,
    }));
    const lib = loadLibrary(files);
    expect(lib.ok).toBe(true);
    expect(lib.models.map((m) => [m.model?.id, m.status])).toEqual([
      ['lastplan-test/entwicklung@1', 'complete'],
    ]);
    expect(lib.models[0]?.model?.model).toContain('keine echte Wallbox');
  });

  it('ist außerhalb des Entwicklermodus nicht in der Bibliothek', () => {
    expect(bundledModelFiles.some((f) => f.path.startsWith('lastplan-test/'))).toBe(false);
  });
});
