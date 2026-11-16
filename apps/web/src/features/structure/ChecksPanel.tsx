import { SEVERITY_LABEL, type Finding, type Project, type ProjectChange } from '@lastplan/core';
import { Button } from '@lastplan/ui';
import { useState } from 'react';
import { useChecksStore } from '../../state/checksStore';
import { applyFixCommand } from '../../state/commands';
import { useEditorStore } from '../../state/editorStore';
import { useProjectStore } from '../../state/projectStore';

/** Prüfung: alle Meldungen, Klick springt zum Element, Lösungsvorschlag mit Vorschau (Kap. 5, 11.1). */

const findingKey = (f: Finding) => `${f.ruleId}|${f.targetIds.join(',')}|${f.message}`;

export function describeChange(project: Project, change: ProjectChange): string {
  const label =
    project.chargePoints.find((c) => c.id === change.chargePointId)?.label ?? 'Ladepunkt';
  return `${label}: Phasenlage ${change.from} → ${change.to}`;
}

function FixPreview({
  finding,
  project,
  onClose,
}: {
  finding: Finding;
  project: Project;
  onClose: () => void;
}) {
  const fix = finding.fix;
  if (!fix) return null;
  return (
    <div className="structure-fix" role="group" aria-label="Lösungsvorschlag">
      <p className="structure-fix__title">
        <strong>{fix.label}</strong>
      </p>
      <p className="structure-muted">Vorschau der Änderungen:</p>
      <ul className="structure-fix__changes">
        {fix.changes.map((c) => (
          <li key={`${c.chargePointId}`}>{describeChange(project, c)}</li>
        ))}
      </ul>
      <div className="structure-fix__actions">
        <Button
          variant="primary"
          size="sm"
          onClick={() => {
            useProjectStore.getState().execute(applyFixCommand(fix));
            onClose();
          }}
        >
          Übernehmen
        </Button>
        <Button size="sm" onClick={onClose}>
          Abbrechen
        </Button>
      </div>
    </div>
  );
}

/** `only`: nur Meldungen zu diesen Elementen (Eigenschaften-Panel), sonst alle. */
export function ChecksPanel({ only }: { only?: readonly string[] }) {
  const result = useChecksStore((s) => s.result);
  const pending = useChecksStore((s) => s.pending);
  const project = useProjectStore((s) => s.project);
  const [openKey, setOpenKey] = useState<string | null>(null);
  if (!project) return null;
  const all = result?.findings ?? [];
  const findings = only ? all.filter((f) => f.targetIds.some((t) => only.includes(t))) : all;
  const errors = findings.filter((f) => f.severity === 'error').length;
  const warnings = findings.length - errors;

  return (
    <div className="structure-checks" aria-busy={pending}>
      <p className="structure-checks__summary" role="status">
        {findings.length === 0
          ? only
            ? 'Keine Meldungen zu diesem Element.'
            : 'Keine Meldungen – die Anlage ist stimmig.'
          : `${errors} Fehler, ${warnings} ${warnings === 1 ? 'Hinweis' : 'Hinweise'}`}
      </p>
      <ul className="structure-checks__list">
        {findings.map((f) => {
          const key = findingKey(f);
          const open = openKey === key;
          return (
            <li key={key} className={`lp-notice lp-notice--${f.severity} structure-finding`}>
              <div className="lp-notice__body">
                <button
                  type="button"
                  className="structure-finding__jump"
                  disabled={f.targetIds.length === 0}
                  onClick={() => useEditorStore.getState().revealIds(f.targetIds)}
                >
                  <span className="lp-notice__stage">{SEVERITY_LABEL[f.severity]}: </span>
                  {f.message}
                </button>
                {f.fix && !open ? (
                  <Button variant="text" size="sm" onClick={() => setOpenKey(key)}>
                    Lösung: {f.fix.label}
                  </Button>
                ) : null}
                {f.fix && open ? (
                  <FixPreview finding={f} project={project} onClose={() => setOpenKey(null)} />
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
