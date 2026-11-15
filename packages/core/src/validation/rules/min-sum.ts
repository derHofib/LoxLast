import { formatA } from '../../calc/units';
import { finding, type Rule } from '../types';
import { checkedLevels, exceedance, levelTarget, symmetric } from './level-checks';

/** MIN_SUM: Summe der Mindestströme passt nicht ins verfügbare Limit der Ebene (Kap. 4.4). */
export const minSumRule: Rule = {
  id: 'MIN_SUM',
  severity: 'error',
  check({ analysis }) {
    return checkedLevels(analysis.levels).flatMap((level) => {
      const load = analysis.loadByLevel.get(level.id);
      if (!load) return [];
      const over = exceedance(load.minSum, level.available);
      if (!over) return [];
      const where = symmetric(load.minSum, level.available)
        ? level.name
        : `${level.name} ${over.worst}`;
      return [
        finding(
          minSumRule,
          `${where}: Mindeststrom-Summe ${formatA(over.value)} über Limit ${formatA(over.limit)}`,
          levelTarget(level),
        ),
      ];
    });
  },
};
