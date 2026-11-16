import { formatA, PHASES, type ProjectAnalysis } from '@lastplan/core';
import { ProgressBar, StatusBadge } from '@lastplan/ui';

/** Phasenlast L1–L3 (Worst Case) einer Ebene mit Balken und Schieflast (Kap. 4.1–4.4). */
export function PhaseLoad({
  analysis,
  levelId,
  maxUnbalanceA,
}: {
  analysis: ProjectAnalysis | null;
  levelId: string;
  maxUnbalanceA: number;
}) {
  const level = analysis?.levelById.get(levelId);
  const load = analysis?.loadByLevel.get(levelId);
  if (!level || !load) return <p className="structure-muted">Wird berechnet …</p>;
  const unbalanced = load.unbalanceA > maxUnbalanceA;
  return (
    <div className="structure-phases">
      {PHASES.map((phase) => (
        <div key={phase} className="structure-phase">
          <p className="structure-phase__text">
            <strong>{phase}</strong> {formatA(load.worstCase[phase])} von{' '}
            {formatA(level.available[phase])}
          </p>
          <ProgressBar
            value={load.worstCase[phase]}
            max={level.available[phase]}
            label={`${phase} Worst Case, ${level.name}`}
            errorAt={1.0001}
          />
        </div>
      ))}
      <p className="structure-phase__text">
        Schieflast {formatA(load.unbalanceA)} (zulässig {formatA(maxUnbalanceA)}){' '}
        {unbalanced ? <StatusBadge status="warning">Zu hoch</StatusBadge> : null}
      </p>
    </div>
  );
}
