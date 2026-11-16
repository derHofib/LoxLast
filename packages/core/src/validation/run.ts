import { analyzeProject, type ProjectAnalysis } from '../calc/analysis';
import type { Project } from '../model';
import { cpDataMissingRule } from './rules/data-missing';
import { dupIpRule } from './rules/dup-ip';
import { emptyGroupRule, meterMissingRule } from './rules/hints';
import { minSumRule } from './rules/min-sum';
import { modelIncompleteRule, phaseSwitchRule } from './rules/model-rules';
import { phaseOverloadRule } from './rules/phase-overload';
import { cpMinMaxRule, cpNoGroupRule, structureRule } from './rules/structure';
import { unbalanceRule } from './rules/unbalance';
import type { CatalogModel, Finding, ModelCatalog, Rule, Severity } from './types';

/** Alle Regeln in Anzeigereihenfolge. */
export const RULES: readonly Rule[] = [
  structureRule,
  cpNoGroupRule,
  cpMinMaxRule,
  cpDataMissingRule,
  dupIpRule,
  modelIncompleteRule,
  phaseSwitchRule,
  minSumRule,
  phaseOverloadRule,
  unbalanceRule,
  emptyGroupRule,
  meterMissingRule,
];

export interface CheckResult {
  findings: Finding[];
  /** Gesamtstufe: 'error' bei mindestens einem Fehler, 'warning' bei Hinweisen, sonst 'ok'. */
  severity: Severity;
  /** Fehler, die den Export sperren (Kap. 11.3). */
  exportBlockers: Finding[];
  analysis: ProjectAnalysis;
}

const SEVERITY_ORDER = { error: 0, warning: 1 } as const;

/**
 * Prüft ein Projekt mit allen Regeln. Die Analyse wird einmal berechnet und geteilt.
 * Meldungen sind nach Stufe (Fehler zuerst), dann Regelreihenfolge sortiert.
 */
export function runChecks(
  project: Project,
  catalog: ModelCatalog,
  rules: readonly Rule[] = RULES,
): CheckResult {
  const analysis = analyzeProject(project);
  const context = { project, analysis, catalog };
  const findings = rules
    .flatMap((rule, order) => rule.check(context).map((f) => ({ f, order })))
    .sort(
      (a, b) => SEVERITY_ORDER[a.f.severity] - SEVERITY_ORDER[b.f.severity] || a.order - b.order,
    )
    .map(({ f }) => f);
  const exportBlockers = findings.filter((f) => f.blocksExport);
  const severity: Severity = findings[0]?.severity ?? 'ok';
  return { findings, severity, exportBlockers, analysis };
}

/** Leerer Katalog, z. B. für Tests oder solange die Bibliothek nicht geladen ist. */
export const EMPTY_CATALOG: ModelCatalog = { get: () => undefined };

/** Katalog aus einer Liste von Modellen. */
export function catalogFromModels(models: readonly CatalogModel[]): ModelCatalog {
  const byId = new Map(models.map((m) => [m.id, m]));
  return { get: (id) => byId.get(id) };
}
