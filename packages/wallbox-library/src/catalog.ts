import type { LoadedModel, LibraryCheck } from './loader';

/**
 * Adapter für die Prüfregeln in packages/core (ModelCatalog).
 *
 * Form entspricht packages/core/src/validation/types.ts. `null` steht für einen Wert,
 * der noch TODO ist. Das Modell gilt dann als unvollständig, und MODEL_INCOMPLETE sperrt den Export.
 */
export interface CatalogModel {
  id: string;
  displayName: string;
  complete: boolean;
  /** Pfade der TODO-Felder, z. B. "modbus.registers.power.address". */
  missingFields: string[];
  electrical: {
    minA: number | null;
    maxA: number | null;
    phases: Array<1 | 3> | null;
    phaseSwitching: boolean | null;
  };
}

export interface ModelCatalog {
  get(modelId: string): CatalogModel | undefined;
}

/** "/modbus/registers/power/address" → "modbus.registers.power.address" */
function toFieldPath(pointer: string): string {
  return pointer.replace(/^\//, '').replace(/\//g, '.');
}

function known<T>(value: T | string): T | null {
  return typeof value === 'string' && /^\s*todo/i.test(value) ? null : (value as T);
}

/**
 * Baut den Katalog aus geprüften Modellen. Ungültige Modelle fehlen im Katalog,
 * unvollständige sind enthalten und als unvollständig markiert.
 */
export function toModelCatalog(input: LibraryCheck | LoadedModel[]): ModelCatalog {
  const models = Array.isArray(input) ? input : input.models;
  const entries = new Map<string, CatalogModel>();
  for (const loaded of models) {
    const model = loaded.model;
    if (loaded.status === 'invalid' || !model) continue;
    entries.set(model.id, {
      id: model.id,
      displayName: `${model.vendor} ${model.model}`,
      complete: loaded.status === 'complete',
      missingFields: loaded.todos.map(toFieldPath),
      electrical: {
        minA: known<number>(model.electrical.minA),
        maxA: known<number>(model.electrical.maxA),
        phases: known<Array<1 | 3>>(model.electrical.phases),
        phaseSwitching: known<boolean>(model.electrical.phaseSwitching),
      },
    });
  }
  return { get: (modelId) => entries.get(modelId) };
}
