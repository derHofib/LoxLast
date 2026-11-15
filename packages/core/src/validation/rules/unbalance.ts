import { SITE_LEVEL_ID } from '../../calc/analysis';
import { optimizePhaseRotations } from '../../calc/optimize';
import { formatA } from '../../calc/units';
import { finding, type FixProposal, type Rule } from '../types';

/**
 * UNBALANCE: Schieflast am Standort (Szenario B: alle Fahrzeuge 1-phasig) über maxUnbalanceA.
 * Mit Lösungsvorschlag aus der Phasenrotations-Optimierung, angewendet erst nach Bestätigung.
 */
export const unbalanceRule: Rule = {
  id: 'UNBALANCE',
  severity: 'warning',
  check({ project, analysis }) {
    const load = analysis.loadByLevel.get(SITE_LEVEL_ID);
    const max = project.settings.maxUnbalanceA;
    if (!load || load.unbalanceA <= max + 1e-9) return [];

    const head = `Schieflast ${formatA(load.unbalanceA)} über ${formatA(max)}`;
    const proposal = optimizePhaseRotations(project, analysis);
    if (proposal.changes.length === 0 || proposal.unbalanceAfterA >= load.unbalanceA - 1e-9) {
      return [
        finding(unbalanceRule, `${head} – mit anderer Phasenlage nicht weiter zu verringern`, [
          SITE_LEVEL_ID,
        ]),
      ];
    }

    const labelOf = new Map(project.chargePoints.map((cp) => [cp.id, cp.label]));
    const first = proposal.changes[0];
    const suggestion =
      proposal.changes.length === 1 && first
        ? `${labelOf.get(first.chargePointId)} auf ${first.to} drehen?`
        : `Phasenlage von ${proposal.changes.length} Ladepunkten ändern?`;
    const fix: FixProposal = {
      label:
        proposal.changes.length === 1
          ? `Phasenlage ändern (Schieflast danach ${formatA(proposal.unbalanceAfterA)})`
          : `Phasenlage von ${proposal.changes.length} Ladepunkten ändern (Schieflast danach ${formatA(proposal.unbalanceAfterA)})`,
      changes: proposal.changes,
    };
    return [
      finding(
        unbalanceRule,
        `${head} – ${suggestion}`,
        [SITE_LEVEL_ID, ...proposal.changes.map((c) => c.chargePointId)],
        fix,
      ),
    ];
  },
};
