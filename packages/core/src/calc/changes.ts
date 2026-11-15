import type { PhaseRotation, Project } from '../model';

/**
 * Datenbeschreibung einer Projektänderung. Lösungsvorschläge der Prüfung (Kap. 5) bestehen aus
 * solchen Änderungen; die UI verpackt sie in einen Undo-fähigen Command (ein Undo-Schritt).
 */
export type ProjectChange = {
  type: 'setPhaseRotation';
  chargePointId: string;
  from: PhaseRotation;
  to: PhaseRotation;
};

/** Wendet Änderungen unveränderlich an (das Eingabeprojekt bleibt unberührt). */
export function applyChanges(project: Project, changes: readonly ProjectChange[]): Project {
  if (changes.length === 0) return project;
  const rotationById = new Map(changes.map((c) => [c.chargePointId, c.to]));
  return {
    ...project,
    chargePoints: project.chargePoints.map((cp) => {
      const to = rotationById.get(cp.id);
      return to === undefined ? cp : { ...cp, phaseRotation: to };
    }),
  };
}
