import { checkProjectInvariants, type InvariantCode } from '../../model';
import { formatA } from '../../calc/units';
import { finding, type Finding, type Rule, type RuleId } from '../types';

/**
 * Invarianten aus dem Domänenmodell als Prüfmeldungen (ADR 0004).
 * CP_GROUP_MISSING → CP_NO_GROUP, CP_CURRENT_RANGE → CP_MIN_MAX, alle übrigen → STRUCTURE.
 */
const RULE_FOR: Record<InvariantCode, RuleId> = {
  CP_GROUP_MISSING: 'CP_NO_GROUP',
  CP_CURRENT_RANGE: 'CP_MIN_MAX',
  DUPLICATE_ID: 'STRUCTURE',
  DUPLICATE_CP_LABEL: 'STRUCTURE',
  DUPLICATE_CLUSTER_NAME: 'STRUCTURE',
  DUPLICATE_GROUP_NAME: 'STRUCTURE',
  GROUP_CLUSTER_MISSING: 'STRUCTURE',
  CLUSTER_PARENT_MISSING: 'STRUCTURE',
  CLUSTER_CYCLE: 'STRUCTURE',
};

function invariantRule(id: RuleId): Rule {
  const rule: Rule = {
    id,
    severity: 'error',
    check({ project }): Finding[] {
      return checkProjectInvariants(project)
        .filter((issue) => RULE_FOR[issue.code] === id)
        .map((issue) => finding(rule, issue.message, issue.targetIds));
    },
  };
  return rule;
}

export const cpNoGroupRule = invariantRule('CP_NO_GROUP');
export const structureRule = invariantRule('STRUCTURE');

const cpRangeInvariants = invariantRule('CP_MIN_MAX');

/**
 * CP_MIN_MAX: 6 A ≤ minA ≤ maxA ≤ fuseA (Invariante) und zusätzlich innerhalb der Grenzen des Modells.
 */
export const cpMinMaxRule: Rule = {
  id: 'CP_MIN_MAX',
  severity: 'error',
  check(context) {
    const findings = cpRangeInvariants.check(context);
    for (const cp of context.project.chargePoints) {
      const model = context.catalog.get(cp.libraryModelId);
      if (!model) continue;
      const problems: string[] = [];
      // null = Grenze im Modell noch TODO → nicht prüfbar (MODEL_INCOMPLETE meldet das Modell)
      const { minA, maxA } = model.electrical;
      if (maxA !== null && cp.maxA > maxA) {
        problems.push(`Maximalstrom ${formatA(cp.maxA)} über Modell-Maximum ${formatA(maxA)}`);
      }
      if (minA !== null && cp.minA < minA) {
        problems.push(`Mindeststrom ${formatA(cp.minA)} unter Modell-Minimum ${formatA(minA)}`);
      }
      if (problems.length > 0) {
        findings.push(
          finding(cpMinMaxRule, `${cp.label} (${model.displayName}): ${problems.join('; ')}`, [
            cp.id,
          ]),
        );
      }
    }
    return findings;
  },
};
