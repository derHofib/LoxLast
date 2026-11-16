import { describe, expect, it } from 'vitest';
import { bundledCatalog, bundledLibrary, bundledModelFiles } from './catalog';

describe('mitgelieferte Bibliothek', () => {
  it('enthält die Modelldateien des Repos, gültig', () => {
    expect(bundledModelFiles.map((f) => f.path)).toContain('abl/em4-twin@1.json');
    expect(bundledLibrary.ok).toBe(true);
  });

  it('ABL eM4 Twin ist bis zur Herstellerdoku unvollständig', () => {
    const model = bundledCatalog.get('abl/em4-twin@1');
    expect(model?.complete).toBe(false);
    expect(model?.missingFields.length).toBeGreaterThan(0);
    expect(model?.electrical.maxA).toBeNull();
  });
});
