import { CP_DATA_FIELDS, CP_DATA_FIELD_LABEL } from '../../model';
import { finding, type Finding, type Rule } from '../types';

/**
 * CP_DATA_MISSING: Angaben, die beim Import fehlten, sind nur Platzhalter. Sie müssen nachgetragen
 * oder bestätigt werden, bevor exportiert wird. Ladepunkte mit denselben Lücken werden in einer
 * Meldung zusammengefasst.
 */
export const cpDataMissingRule: Rule = {
  id: 'CP_DATA_MISSING',
  severity: 'error',
  check({ project }) {
    const bySet = new Map<string, { labels: string[]; ids: string[] }>();
    for (const cp of project.chargePoints) {
      if (!cp.missingFields || cp.missingFields.length === 0) continue;
      const fields = CP_DATA_FIELDS.filter((f) => cp.missingFields?.includes(f));
      const key = fields.map((f) => CP_DATA_FIELD_LABEL[f]).join(', ');
      const entry = bySet.get(key) ?? { labels: [], ids: [] };
      entry.labels.push(cp.label);
      entry.ids.push(cp.id);
      bySet.set(key, entry);
    }
    const findings: Finding[] = [];
    for (const [fields, { labels, ids }] of bySet) {
      const who =
        labels.length === 1 ? labels[0] : `${labels.length} Ladepunkten (${labels.join(', ')})`;
      findings.push(
        finding(
          cpDataMissingRule,
          `Angaben fehlen bei ${who ?? ''}: ${fields} – bitte in der Ladepunkte-Ansicht nachtragen oder bestätigen`,
          ids,
        ),
      );
    }
    return findings;
  },
};
