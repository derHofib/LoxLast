import { useMemo, useState } from 'react';
import { formatNumber, type Project } from '@lastplan/core';
import {
  buildHandoverPlan,
  handoverScriptInput,
  hashFromPageName,
  type HandoverPlan,
} from '@lastplan/loxone-export';
import type { ConfigHandoverResponse } from '@lastplan/protocol';
import { Button, Notice, StatusBadge } from '@lastplan/ui';
import { recordExportCommand } from '../features/export/record';
import { useLibrary } from '../library/libraryStore';
import { useChecksStore } from '../state/checksStore';
import { useProjectStore } from '../state/projectStore';
import {
  GatewayError,
  requestConfigHandover,
  requestConfigSave,
  requestConfigUndo,
} from './gatewayStore';

/** UUIDs aus dem letzten Lauf mit Config-Angaben, für das Ersetzen (6.6). */
function previousHandover(project: Project) {
  for (let i = project.exportHistory.length - 1; i >= 0; i--) {
    const c = project.exportHistory[i]?.config;
    if (c) return c;
  }
  return undefined;
}

const kw = (v: number) => `${v.toLocaleString('de-DE', { maximumFractionDigits: 2 })} kW`;

/** Abhak-Liste als Text (für Ausdruck oder Ablage neben dem Config-Projekt). */
export function manualStepsText(plan: HandoverPlan): string {
  const lines = [`LastPlan – Nacharbeit in Loxone Config (${plan.pageName})`, ''];
  for (const step of plan.manualSteps) {
    lines.push(step.title, ...step.items.map((i, n) => (n === 0 ? `  ${i}` : `  [ ] ${i}`)), '');
  }
  return lines.join('\n');
}

function downloadText(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function PlanPreview({ plan }: { plan: HandoverPlan }) {
  return (
    <details className="config-handover__preview">
      <summary>Vorschau: was angelegt wird</summary>
      <table className="config-handover__table">
        <thead>
          <tr>
            <th scope="col">Baustein</th>
            <th scope="col">Typ</th>
            <th scope="col">Wert</th>
          </tr>
        </thead>
        <tbody>
          {plan.loadManagers.map((l) => (
            <tr key={l.key}>
              <td>{l.title}</td>
              <td>Lastmanager</td>
              <td>
                MaxP {kw(l.maxKw)} ({formatNumber(l.maxA)} A)
              </td>
            </tr>
          ))}
          {plan.wallboxManagers.map((w) => (
            <tr key={w.key}>
              <td>{w.title}</td>
              <td>Wallbox Manager</td>
              <td>{w.wallboxes.length} Wallboxen</td>
            </tr>
          ))}
          {plan.wallboxes.map((w) => (
            <tr key={w.key}>
              <td>{w.title}</td>
              <td>Wallbox</td>
              <td>
                {kw(w.minKw)} – {kw(w.maxKw)} ({formatNumber(w.minA)}–{formatNumber(w.maxA)} A,{' '}
                {w.phases}-phasig)
              </td>
            </tr>
          ))}
          {plan.modbusDevices.map((d) => (
            <tr key={d.key}>
              <td>{d.name}</td>
              <td>Modbus-Gerät</td>
              <td>
                {d.serverAddress} · Unit {d.unitId} · {d.registers.length} Register
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

type RunState =
  | { kind: 'idle' }
  | { kind: 'busy'; what: string }
  | { kind: 'done'; response: ConfigHandoverResponse }
  | { kind: 'failed'; message: string };

/**
 * Übergabe an Loxone Config (Plan 6.5): Vorschau, Ausführen, Ergebnis, Rückgängig, Speichern.
 * Speichern und Rückgängig löst nur der Nutzer aus.
 */
export function ConfigHandover({ serverVersion }: { serverVersion?: string | undefined }) {
  const project = useProjectStore((s) => s.project);
  const execute = useProjectStore((s) => s.execute);
  const checks = useChecksStore((s) => s.result);
  const exportBlockers = checks?.exportBlockers ?? [];
  const { models } = useLibrary();
  const plan = useMemo(
    () => (project ? buildHandoverPlan(project, models) : null),
    [project, models],
  );
  const [state, setState] = useState<RunState>({ kind: 'idle' });
  const [note, setNote] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  if (!project || !plan) return null;
  const locked = exportBlockers.length > 0 || plan.blockers.length > 0;

  const failed = (e: unknown, fallback: string) =>
    setState({ kind: 'failed', message: e instanceof GatewayError ? e.message : fallback });

  const run = async (p: Project, replace = false) => {
    setNote(null);
    setSaved(false);
    setState({ kind: 'busy', what: replace ? 'Seite wird ersetzt …' : 'Übergabe läuft …' });
    try {
      const response = await requestConfigHandover(
        handoverScriptInput(plan, { replace, previous: previousHandover(p) }),
      );
      setState({ kind: 'done', response });
      const r = response.result;
      if (r && r.outcome !== 'exists') {
        execute(
          recordExportCommand(p, {
            mode: 'project',
            configVersion: serverVersion,
            config: { pages: r.pages, periphery: r.periphery },
          }),
        );
      }
    } catch (e) {
      failed(e, 'Übergabe fehlgeschlagen.');
    }
  };
  const undo = async () => {
    try {
      const res = await requestConfigUndo();
      setNote(res.message);
      if (res.success) setState({ kind: 'idle' });
    } catch (e) {
      setNote(e instanceof GatewayError ? e.message : 'Rückgängig fehlgeschlagen.');
    }
  };
  const save = async () => {
    try {
      const res = await requestConfigSave();
      setNote(res.message);
      setSaved(res.saved);
    } catch (e) {
      setNote(e instanceof GatewayError ? e.message : 'Speichern fehlgeschlagen.');
    }
  };

  const answer = state.kind === 'done' ? state.response.result : null;
  const existing = answer?.outcome === 'exists' ? answer.existingPages : null;
  const result = answer && answer.outcome !== 'exists' ? answer : null;
  const unchanged =
    existing?.some((pg) => hashFromPageName(pg.name, plan.pageMatch) === plan.pageHash) ?? false;
  const failure = state.kind === 'done' ? state.response.failure : null;
  const issues = result?.validation?.issues ?? [];
  const errors = issues.filter((i) => i.severity === 'error');

  return (
    <section className="config-handover" aria-label="Übergabe an Config">
      <h3 className="export-h3">Übergabe an Config</h3>
      <p className="export-muted">
        Legt im geöffneten Config-Projekt eine neue Seite „{plan.pageName}“ an:{' '}
        {plan.loadManagers.length} Lastmanager, {plan.wallboxManagers.length} Wallbox Manager,{' '}
        {plan.wallboxes.length} Wallboxen, {plan.modbusDevices.length} Modbus-Geräte. Alles zusammen
        ist ein Schritt, den „Rückgängig“ vollständig zurücknimmt. Gespeichert wird nur auf Klick.
        Gibt es die Seite dieses Projekts in Config schon, fragt LastPlan, ob sie ersetzt werden
        soll.
      </p>
      {exportBlockers.length > 0 ? (
        <Notice kind="error" title="Übergabe gesperrt">
          Erst die {exportBlockers.length} Fehler aus der Prüfung beheben.
        </Notice>
      ) : null}
      {plan.blockers.length > 0 ? (
        <Notice kind="error" title="Übergabe gesperrt">
          <ul aria-label="Gründe für die Sperre">
            {plan.blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </Notice>
      ) : null}
      {plan.prerequisites.length > 0 ? (
        <Notice kind="info" title="Vorher in Config anlegen">
          <ul aria-label="Voraussetzungen">
            {plan.prerequisites.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </Notice>
      ) : null}
      {plan.pending.length > 0 ? (
        <ul className="export-muted" aria-label="Noch nicht enthalten">
          {plan.pending.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      ) : null}
      <PlanPreview plan={plan} />
      <div aria-live="polite">
        {state.kind === 'busy' ? <StatusBadge status="ready">{state.what}</StatusBadge> : null}
        {state.kind === 'failed' ? (
          <Notice kind="error" title="Übergabe fehlgeschlagen">
            {state.message}
          </Notice>
        ) : null}
        {state.kind === 'done' && !result && !failure ? (
          <Notice kind="warning" title="Nicht ausgeführt">
            {state.response.status.message}
          </Notice>
        ) : null}
        {failure ? (
          <Notice kind="error" title={`Übergabe abgebrochen (${failure.code})`}>
            {failure.message}
            {failure.undoRecommended
              ? ' Was bis dahin angelegt wurde, nimmt „Rückgängig“ zurück.'
              : ' In Config wurde nichts geändert.'}
          </Notice>
        ) : null}
        {existing ? (
          <Notice kind="warning" title="Seite gibt es schon in Config">
            <ul aria-label="Vorhandene Seiten">
              {existing.map((pg) => (
                <li key={pg.uuid}>{pg.name}</li>
              ))}
            </ul>
            <p>
              {unchanged
                ? 'Die Struktur des Projekts ist seit dieser Übergabe unverändert. Ersetzen lohnt sich nur, wenn sich Namen oder Werte geändert haben.'
                : 'Das Projekt hat sich seit dieser Übergabe geändert.'}{' '}
              Ersetzen entfernt die Seite mit allem, was darauf liegt, auch das, was in den Dialogen
              eingetragen ist (Lasttabellen, Wallbox-Zuordnung), dazu die von LastPlan angelegten
              virtuellen Eingänge und Modbus-Geräte. Danach wird neu angelegt. In Config wurde noch
              nichts geändert.
            </p>
            <Button
              variant="primary"
              disabled={locked || state.kind !== 'done'}
              onClick={() => void run(project, true)}
            >
              Seite ersetzen
            </Button>
          </Notice>
        ) : null}
        {result ? (
          <>
            <StatusBadge status={errors.length > 0 ? 'warning' : 'active'}>
              {Object.keys(result.created).length} Objekte angelegt
            </StatusBadge>
            {result.outcome === 'replaced' ? (
              <p className="export-muted">
                Alte Seite ersetzt, {result.removed} Objekte entfernt. Die Einträge in den Dialogen
                sind neu zu machen (Liste unten).
              </p>
            ) : null}
            <p className="export-muted">
              Prüfung in Config: {errors.length} Fehler, {issues.length - errors.length} Hinweise.
              {saved ? ' Gespeichert.' : ' Noch nicht gespeichert.'}
            </p>
            {issues.length > 0 ? (
              <ul className="config-handover__issues" aria-label="Meldungen der Config-Prüfung">
                {issues.slice(0, 20).map((i, n) => (
                  <li key={`${i.rule}-${n}`}>
                    <strong>{i.rule}</strong>: {i.message}
                  </li>
                ))}
              </ul>
            ) : null}
            <h4 className="export-h3">Nacharbeit in Config</h4>
            {plan.manualSteps.map((step) => (
              <div key={step.block} className="config-handover__step">
                <strong>{step.title}</strong>
                <p className="export-muted">{step.items[0]}</p>
                <ul>
                  {step.items.slice(1).map((i) => (
                    <li key={i}>{i}</li>
                  ))}
                </ul>
              </div>
            ))}
            <Button
              variant="text"
              onClick={() => downloadText('lastplan-nacharbeit.txt', manualStepsText(plan))}
            >
              Liste herunterladen
            </Button>
          </>
        ) : null}
        {note ? <p className="export-muted">{note}</p> : null}
      </div>
      <div className="config-handover__actions">
        <Button
          variant="primary"
          disabled={locked || state.kind === 'busy'}
          onClick={() => void run(project)}
        >
          In Config anlegen
        </Button>
        {result || failure?.undoRecommended ? (
          <Button onClick={() => void undo()}>Rückgängig in Config</Button>
        ) : null}
        {result ? (
          <Button onClick={() => void save()} disabled={saved}>
            In Config speichern
          </Button>
        ) : null}
      </div>
      {result || failure?.undoRecommended ? (
        <p className="export-muted">
          „Rückgängig“ nimmt den letzten Schritt in Config zurück. Direkt nach der Übergabe ist das
          die Übergabe; wer in Config inzwischen weitergearbeitet hat, nimmt sonst seine eigene
          Änderung zurück.
        </p>
      ) : null}
    </section>
  );
}
