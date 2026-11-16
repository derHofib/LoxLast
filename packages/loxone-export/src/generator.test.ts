import { afterEach, describe, expect, it } from 'vitest';
import type { Project } from '@lastplan/core';
import {
  getGenerator,
  registerGenerator,
  templateGeneratorAvailable,
  unregisterGenerator,
  type ExportGenerator,
} from './generator';

const fake: ExportGenerator = {
  mode: 'templates',
  generate: () =>
    Promise.resolve({
      file: { fileName: 'x.zip', mimeType: 'application/zip', data: new Uint8Array() },
    }),
};

afterEach(() => unregisterGenerator('templates'));

describe('Generator-Registry', () => {
  it('ohne eingehängten Generator ist der Vorlagen-Export nicht verfügbar', () => {
    expect(templateGeneratorAvailable()).toBe(false);
    expect(getGenerator('templates')).toBeUndefined();
  });

  it('ein eingehängter Generator macht ihn verfügbar und lässt sich wieder entfernen', async () => {
    registerGenerator(fake);
    expect(templateGeneratorAvailable()).toBe(true);
    expect(getGenerator('templates')).toBe(fake);
    expect((await fake.generate({} as Project)).file.fileName).toBe('x.zip');
    unregisterGenerator('templates');
    expect(templateGeneratorAvailable()).toBe(false);
  });
});
