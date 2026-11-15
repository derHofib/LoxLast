import { formatA } from '../../calc/units';
import { finding, type Rule } from '../types';
import { checkedLevels, exceedance, levelTarget } from './level-checks';

/**
 * PHASE_OVERLOAD: Worst-Case-Phasenlast (Summe der Max-Ströme) über dem verfügbaren Limit.
 * Laut Entscheidung des Auftraggebers vom 2026-11-15 ein Hinweis, kein Fehler: Das Lastmanagement
 * drosselt genau in diesem Fall (ADR 0007).
 */
export const phaseOverloadRule: Rule = {
  id: 'PHASE_OVERLOAD',
  severity: 'warning',
  check({ analysis }) {
    return checkedLevels(analysis.levels).flatMap((level) => {
      const load = analysis.loadByLevel.get(level.id);
      if (!load) return [];
      const over = exceedance(load.worstCase, level.available);
      if (!over) return [];
      const phaseText = over.phases.length === 1 ? over.worst : over.phases.join('/');
      const valueText =
        over.phases.length === 1 ? formatA(over.value) : `bis ${formatA(over.value)}`;
      return [
        finding(
          phaseOverloadRule,
          `${level.name} ${phaseText}: ${valueText} über ${formatA(over.limit)} – Lastmanagement drosselt im Volllastfall`,
          levelTarget(level),
        ),
      ];
    });
  },
};
