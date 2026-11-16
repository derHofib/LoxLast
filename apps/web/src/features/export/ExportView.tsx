import {
  formatA,
  SEVERITY_LABEL,
  type ChargePoint,
  type Cluster,
  type Finding,
  type Project,
} from '@lastplan/core';
import { Button, Card, FunctionBlock, IoLegend, Notice } from '@lastplan/ui';
import { TEMPLATE_MISSING_HINT, templateGeneratorAvailable } from '@lastplan/loxone-export';
import { useNavigate } from 'react-router-dom';
import { ConfigStatus } from '../../gateway/ConfigStatus';
import { useChecksStore } from '../../state/checksStore';
import { useEditorStore } from '../../state/editorStore';
import { useProjectStore } from '../../state/projectStore';
import { lastExport, structureChangedSinceExport } from './record';
import { blockerTab, summarize } from './summary';
import './export.css';

const FROM_TEMPLATE = 'TODO(verify) – aus Vorlage';
const MODE_LABEL = { templates: 'Nur Vorlagen', project: 'In bestehendes Projekt einfügen' };

const dateFormat = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' });

function Blockers({ project, blockers }: { project: Project; blockers: Finding[] }) {
  const navigate = useNavigate();
  const jump = (f: Finding) => {
    useEditorStore.getState().revealIds(f.targetIds);
    navigate(`/projekt/${project.id}/${blockerTab(project, f)}`);
  };
  return (
    <div className="export-blockers">
      <Notice
        kind="error"
        title={`Export gesperrt: ${blockers.length} Fehler offen`}
        solution="Die Fehler beheben; ein Klick auf eine Meldung springt zum Element."
      />
      <ul className="export-blockers__list" aria-label="Export-Blocker">
        {blockers.map((f, i) => (
          <li key={`${f.ruleId}|${f.targetIds.join(',')}|${i}`}>
            <button
              type="button"
              className="export-blockers__jump"
              disabled={f.targetIds.length === 0}
              onClick={() => jump(f)}
            >
              <strong>{SEVERITY_LABEL[f.severity]}: </strong>
              {f.message}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function LastExport({ project }: { project: Project }) {
  const last = lastExport(project);
  return (
    <section className="export-last" aria-label="Letzter Export">
      <h3 className="export-h3">Letzter Export</h3>
      {last ? (
        <p>
          {dateFormat.format(new Date(last.createdAt))} · {MODE_LABEL[last.mode]}
          {last.configVersion ? ` · Config-Version ${last.configVersion}` : ''}
        </p>
      ) : (
        <p>Noch nie exportiert</p>
      )}
      {structureChangedSinceExport(project) ? (
        <Notice kind="warning" banner title="Struktur seit dem letzten Export geändert">
          Die Anlage muss neu nach Loxone Config übertragen werden.
        </Notice>
      ) : null}
    </section>
  );
}

function Preview({ project, flagged }: { project: Project; flagged: ReadonlySet<string> }) {
  const clusterParams = (c: Cluster) => [`Limit: ${formatA(c.limitA)}`];
  const cpParams = (c: ChargePoint) => [
    `Min: ${formatA(c.minA)}`,
    `Max: ${formatA(c.maxA)}`,
    ...(flagged.has(c.id) ? ['Prüfbedarf'] : []),
  ];
  return (
    <Card title="Vorschau Logik">
      <p className="export-muted">
        Nur Angaben aus dem Projekt. Ein- und Ausgänge der Bausteine legt die Loxone-Vorlage fest.
      </p>
      <IoLegend />
      <div className="export-preview">
        <section aria-labelledby="exp-l1">
          <h3 id="exp-l1" className="export-h3">
            Ebene 1 · Standort
          </h3>
          <FunctionBlock
            title={project.site.gridConnectionLabel}
            inputs={[FROM_TEMPLATE]}
            outputs={[FROM_TEMPLATE]}
            params={[`Limit: ${formatA(project.site.gridConnectionFuseA)}`]}
          />
        </section>
        <section aria-labelledby="exp-l2">
          <h3 id="exp-l2" className="export-h3">
            Ebene 2 · Cluster
          </h3>
          {project.clusters.length === 0 ? <p className="export-muted">Keine Cluster.</p> : null}
          {project.clusters.map((c) => (
            <FunctionBlock
              key={c.id}
              title={c.name}
              inputs={[FROM_TEMPLATE]}
              outputs={[FROM_TEMPLATE]}
              params={clusterParams(c)}
              needsReview={flagged.has(c.id)}
            />
          ))}
        </section>
        <section aria-labelledby="exp-l3">
          <h3 id="exp-l3" className="export-h3">
            Ebene 3 · Wallboxen
          </h3>
          {project.chargePoints.length === 0 ? (
            <p className="export-muted">Keine Ladepunkte.</p>
          ) : null}
          {project.chargePoints.map((c) => (
            <FunctionBlock
              key={c.id}
              title={c.label}
              inputs={[FROM_TEMPLATE]}
              outputs={[FROM_TEMPLATE]}
              params={cpParams(c)}
              needsReview={flagged.has(c.id)}
            />
          ))}
        </section>
      </div>
    </Card>
  );
}

/** Tab „Export“ (Kap. 11.3). Der Generator fehlt noch (Loxone-Vorlage), daher bleibt der Button gesperrt. */
export function ExportView() {
  const project = useProjectStore((s) => s.project);
  const result = useChecksStore((s) => s.result);
  if (!project) return null;
  const blockers = result?.exportBlockers ?? [];
  const flagged = new Set(blockers.flatMap((f) => f.targetIds));
  const generatorMissing = !templateGeneratorAvailable();
  const s = summarize(project);
  const locked = blockers.length > 0 || generatorMissing;

  return (
    <div className="export-view">
      <div className="export-side">
        <Card title="Exportziel">
          <div className="export-options" role="radiogroup" aria-label="Exportziel">
            <label className="export-option export-option--disabled">
              <input type="radio" name="export-mode" value="project" disabled />
              <span>
                <strong>In bestehendes Projekt einfügen</strong>
                <span className="export-muted">
                  Über die Karte „Loxone Config“: Übergabe an das dort geöffnete Projekt.
                </span>
              </span>
            </label>
            <label className="export-option">
              <input type="radio" name="export-mode" value="templates" checked readOnly />
              <span>
                <strong>Nur Vorlagen</strong>
                <span className="export-muted">Import-Vorlagen für Loxone Config.</span>
              </span>
            </label>
          </div>
        </Card>
        <Card title="Wird erzeugt">
          <dl className="export-summary">
            <dt>Lastmanager (Cluster)</dt>
            <dd>{s.loadManagers}</dd>
            <dt>Gruppen-Limits</dt>
            <dd>{s.groupLimits}</dd>
            <dt>Wallbox-Bausteine</dt>
            <dd>{s.walboxBlocks}</dd>
            <dt>Modbus-Geräte</dt>
            <dd>{s.modbusDevices}</dd>
            <dt>Ein-/Ausgänge</dt>
            <dd>Wird mit der Vorlage festgelegt</dd>
          </dl>
          {blockers.length > 0 ? <Blockers project={project} blockers={blockers} /> : null}
          {generatorMissing ? (
            <Notice kind="info" title="Generator fehlt">
              {TEMPLATE_MISSING_HINT}
            </Notice>
          ) : null}
          <Button
            variant="primary"
            disabled={locked}
            onClick={() => {
              // Der Generator wird mit Meilenstein 6 eingehängt (generator.ts); danach hier
              // erzeugen, herunterladen und recordExportCommand ausführen.
            }}
          >
            Vorlagen erzeugen &amp; herunterladen
          </Button>
          <p className="export-muted">Original bleibt unverändert.</p>
        </Card>
        <Card title="Loxone Config">
          <ConfigStatus />
        </Card>
        <Card>
          <LastExport project={project} />
        </Card>
      </div>
      <Preview project={project} flagged={flagged} />
    </div>
  );
}
