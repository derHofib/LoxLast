import type { ProjectAnalysis } from '../calc/analysis';
import type { ProjectChange } from '../calc/changes';
import type { Project } from '../model';

/** Stufen laut Kap. 5. „ok“ wird nur von der Zusammenfassung verwendet, nie von einer Regel gemeldet. */
export type Severity = 'error' | 'warning' | 'ok';

/** Anzeigewort der Stufe in der Oberfläche. */
export const SEVERITY_LABEL: Record<Severity, string> = {
  error: 'Fehler',
  warning: 'Hinweis',
  ok: 'OK',
};

export interface FixProposal {
  /** Kurzbeschreibung für den Button, z. B. „Phasenlage von 2 Ladepunkten ändern“. */
  label: string;
  /** Wird erst nach Bestätigung angewendet, als ein Undo-Schritt. */
  changes: ProjectChange[];
}

export interface Finding {
  ruleId: RuleId;
  severity: Exclude<Severity, 'ok'>;
  /** Deutsch, konkret mit Zahlen. */
  message: string;
  /** Elemente, zu denen die UI springt ('site' = Netzanschluss). */
  targetIds: string[];
  /** Blockiert den Loxone-Export. Alle Fehler blockieren; Hinweise nicht. */
  blocksExport: boolean;
  fix?: FixProposal;
}

export type RuleId =
  | 'MIN_SUM'
  | 'PHASE_OVERLOAD'
  | 'UNBALANCE'
  | 'DUP_IP'
  | 'CP_NO_GROUP'
  | 'CP_MIN_MAX'
  | 'CP_DATA_MISSING'
  | 'MODEL_INCOMPLETE'
  | 'PHASE_SWITCH_UNSUPPORTED'
  | 'EMPTY_GROUP'
  | 'METER_MISSING'
  | 'STRUCTURE';

/**
 * Sicht der Prüfung auf die Wallbox-Bibliothek. Die Bibliothek (packages/wallbox-library)
 * stellt eine Implementierung bereit; core kennt nur diese Schnittstelle.
 */
export interface CatalogModel {
  id: string;
  /** z. B. „ABL eM4 Twin“ */
  displayName: string;
  /** false, solange Registerwerte fehlen (TODO in der Modelldatei). */
  complete: boolean;
  /** Fehlende Angaben, z. B. ['modbus.registers.setpointCurrent.address']. */
  missingFields: string[];
  /** null = in der Modelldatei noch TODO; die zugehörige Prüfung entfällt dann (MODEL_INCOMPLETE meldet es). */
  electrical: {
    minA: number | null;
    maxA: number | null;
    phases: readonly (1 | 3)[] | null;
    phaseSwitching: boolean | null;
  };
}

export interface ModelCatalog {
  get(modelId: string): CatalogModel | undefined;
}

export interface RuleContext {
  project: Project;
  analysis: ProjectAnalysis;
  catalog: ModelCatalog;
}

export interface Rule {
  id: RuleId;
  /** Stufe der Meldungen dieser Regel. */
  severity: Exclude<Severity, 'ok'>;
  check(context: RuleContext): Finding[];
}

/** Hilfsfunktion: Finding mit Stufe und Exportsperre aus der Regel. */
export function finding(
  rule: Pick<Rule, 'id' | 'severity'>,
  message: string,
  targetIds: string[],
  fix?: FixProposal,
): Finding {
  return {
    ruleId: rule.id,
    severity: rule.severity,
    message,
    targetIds,
    blocksExport: rule.severity === 'error',
    ...(fix ? { fix } : {}),
  };
}
