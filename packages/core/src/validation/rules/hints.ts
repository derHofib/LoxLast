import { SITE_LEVEL_ID } from '../../calc/analysis';
import { formatA } from '../../calc/units';
import { finding, type Rule } from '../types';

/** EMPTY_GROUP: Gruppe ohne Ladepunkte. */
export const emptyGroupRule: Rule = {
  id: 'EMPTY_GROUP',
  severity: 'warning',
  check({ project, analysis }) {
    const used = new Set(project.chargePoints.map((cp) => cp.groupId));
    return project.groups
      .filter((g) => !used.has(g.id))
      .map((g) => {
        const name = analysis.levelById.get(g.id)?.name ?? g.name;
        return finding(emptyGroupRule, `Gruppe ${name} hat keine Ladepunkte`, [g.id]);
      });
  },
};

/** METER_MISSING: kein Netzzähler → statisches Lastmanagement mit festem Limit. */
export const meterMissingRule: Rule = {
  id: 'METER_MISSING',
  severity: 'warning',
  check({ project, analysis }) {
    if (project.site.gridMeter) return [];
    return [
      finding(
        meterMissingRule,
        `Kein Netzzähler definiert – statisches Lastmanagement mit festem Limit ${formatA(analysis.siteAvailableA)}`,
        [SITE_LEVEL_ID],
      ),
    ];
  },
};
