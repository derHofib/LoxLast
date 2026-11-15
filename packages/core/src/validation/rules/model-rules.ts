import { finding, type Rule } from '../types';

/**
 * MODEL_INCOMPLETE: Modell fehlt in der Bibliothek oder hat noch TODO-Register. Blockiert den Export.
 * Eine Meldung je Modell, mit allen betroffenen Ladepunkten.
 */
export const modelIncompleteRule: Rule = {
  id: 'MODEL_INCOMPLETE',
  severity: 'error',
  check({ project, catalog }) {
    const byModel = new Map<string, { id: string; label: string }[]>();
    for (const cp of project.chargePoints) {
      byModel.set(cp.libraryModelId, [...(byModel.get(cp.libraryModelId) ?? []), cp]);
    }
    return [...byModel].flatMap(([modelId, cps]) => {
      const model = catalog.get(modelId);
      const affected = `betrifft ${cps.map((cp) => cp.label).join(', ')}`;
      if (!model) {
        return [
          finding(
            modelIncompleteRule,
            `Modell „${modelId}“ nicht in der Bibliothek – ${affected}`,
            cps.map((cp) => cp.id),
          ),
        ];
      }
      if (model.complete) return [];
      const count = model.missingFields.length;
      const missing = count === 1 ? '1 Angabe fehlt' : `${count} Angaben fehlen`;
      return [
        finding(
          modelIncompleteRule,
          `Modell ${model.displayName} unvollständig (${missing}) – Export gesperrt, ${affected}`,
          cps.map((cp) => cp.id),
        ),
      ];
    });
  },
};

/** PHASE_SWITCH_UNSUPPORTED: Phasenumschaltung aktiv, Modell kann es nicht. */
export const phaseSwitchRule: Rule = {
  id: 'PHASE_SWITCH_UNSUPPORTED',
  severity: 'error',
  check({ project, catalog }) {
    return project.chargePoints.flatMap((cp) => {
      if (!cp.phaseSwitching) return [];
      const model = catalog.get(cp.libraryModelId);
      if (!model || model.electrical.phaseSwitching) return [];
      return [
        finding(
          phaseSwitchRule,
          `${cp.label}: Phasenumschaltung aktiv, ${model.displayName} unterstützt sie nicht`,
          [cp.id],
        ),
      ];
    });
  },
};
