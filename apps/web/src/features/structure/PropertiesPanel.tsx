import {
  analyzeProject,
  canNestCluster,
  formatA,
  gridPhaseOf,
  PRIORITIES,
  SITE_LEVEL_ID,
  type Priority,
  type Project,
} from '@lastplan/core';
import { Button, PropertyGroup, PropertyPanel, SelectField } from '@lastplan/ui';
import { useMemo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { bundledCatalog } from '../../library/catalog';
import {
  deleteCommand,
  updateClusterCommand,
  updateGroupCommand,
  updateSiteCommand,
} from '../../state/commands';
import { useEditorStore } from '../../state/editorStore';
import { useProjectStore } from '../../state/projectStore';
import { createSubCluster } from './actions';
import { ChecksPanel } from './ChecksPanel';
import { CommitNumber, CommitText } from './EditFields';
import { PhaseLoad } from './PhaseLoad';
import { kindOf } from './dropRules';

/** Eigenschaften des ausgewählten Elements (Kap. 11.1: „statt der Übersicht“). */

const PRIORITY_NAMES: Record<Priority, string> = {
  1: '1 (höchste)',
  2: '2',
  3: '3',
  4: '4',
  5: '5 (niedrigste)',
};

function DeleteButton({ ids, project }: { ids: string[]; project: Project }) {
  return (
    <Button
      variant="danger"
      onClick={() => {
        useProjectStore.getState().execute(deleteCommand(project, ids));
        useEditorStore.getState().clearSelection();
      }}
    >
      Löschen
    </Button>
  );
}

const exec = useProjectStore.getState;

function SiteForm({ project }: { project: Project }) {
  const { site } = project;
  const analysis = useMemo(() => analyzeProject(project), [project]);
  return (
    <>
      <PropertyGroup title="Netzanschluss">
        <CommitText
          label="Bezeichnung"
          value={site.gridConnectionLabel}
          onCommit={(v) => exec().execute(updateSiteCommand({ gridConnectionLabel: v }))}
        />
        <CommitNumber
          label="Absicherung"
          unit="A"
          value={site.gridConnectionFuseA}
          onCommit={(v) =>
            v !== undefined && exec().execute(updateSiteCommand({ gridConnectionFuseA: v }))
          }
        />
        <CommitNumber
          label="Gebäudereserve"
          unit="A"
          allowZero
          value={site.buildingReserveA}
          hint={`Verfügbar für Ladeinfrastruktur: ${formatA(analysis.siteAvailableA)}`}
          onCommit={(v) =>
            v !== undefined && exec().execute(updateSiteCommand({ buildingReserveA: v }))
          }
        />
      </PropertyGroup>
      <PropertyGroup title="Phasenlast (Worst Case)">
        <PhaseLoad
          analysis={analysis}
          levelId={SITE_LEVEL_ID}
          maxUnbalanceA={project.settings.maxUnbalanceA}
        />
      </PropertyGroup>
    </>
  );
}

function ClusterForm({ project, id }: { project: Project; id: string }) {
  const cluster = project.clusters.find((c) => c.id === id);
  const analysis = useMemo(() => analyzeProject(project), [project]);
  if (!cluster) return null;
  const parents = project.clusters.filter((c) => canNestCluster(project, id, c.id));
  return (
    <>
      <PropertyGroup title="Cluster">
        <CommitText
          label="Name"
          value={cluster.name}
          onCommit={(v) => exec().execute(updateClusterCommand(id, { name: v }))}
        />
        <CommitNumber
          label="Limit"
          unit="A"
          value={cluster.limitA}
          onCommit={(v) =>
            v !== undefined && exec().execute(updateClusterCommand(id, { limitA: v }))
          }
        />
        <SelectField
          label="Übergeordnet"
          value={cluster.parentClusterId ?? ''}
          onChange={(e) =>
            exec().execute(
              updateClusterCommand(
                id,
                { parentClusterId: e.target.value || undefined },
                'Cluster verschieben',
              ),
            )
          }
        >
          <option value="">Netzanschluss</option>
          {parents.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </SelectField>
        <div>
          <Button
            onClick={() => {
              const a = createSubCluster(id);
              exec().execute(a.command);
              useEditorStore.getState().select([a.id]);
            }}
          >
            + Untercluster
          </Button>
        </div>
      </PropertyGroup>
      <PropertyGroup title="Phasenlast (Worst Case)">
        <PhaseLoad
          analysis={analysis}
          levelId={id}
          maxUnbalanceA={project.settings.maxUnbalanceA}
        />
      </PropertyGroup>
    </>
  );
}

function GroupForm({ project, id }: { project: Project; id: string }) {
  const group = project.groups.find((g) => g.id === id);
  const analysis = useMemo(() => analyzeProject(project), [project]);
  if (!group) return null;
  return (
    <>
      <PropertyGroup title="Gruppe">
        <CommitText
          label="Name"
          value={group.name}
          onCommit={(v) => exec().execute(updateGroupCommand(id, { name: v }))}
        />
        <SelectField
          label="Cluster"
          value={group.clusterId}
          onChange={(e) =>
            exec().execute(
              updateGroupCommand(id, { clusterId: e.target.value }, 'Gruppe verschieben'),
            )
          }
        >
          {project.clusters.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Priorität"
          value={String(group.priority)}
          onChange={(e) =>
            exec().execute(
              updateGroupCommand(
                id,
                { priority: Number(e.target.value) as Priority },
                'Priorität ändern',
              ),
            )
          }
        >
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {PRIORITY_NAMES[p]}
            </option>
          ))}
        </SelectField>
        <CommitNumber
          label="Gruppen-Limit"
          unit="A"
          optional
          value={group.maxA}
          hint="Leer lassen = kein eigenes Limit"
          onCommit={(v) => exec().execute(updateGroupCommand(id, { maxA: v }))}
        />
        <CommitNumber
          label="Mindeststrom je Ladepunkt"
          unit="A"
          optional
          value={group.minPerChargePointA}
          hint="Leer lassen = Wert des Ladepunkts"
          onCommit={(v) => exec().execute(updateGroupCommand(id, { minPerChargePointA: v }))}
        />
      </PropertyGroup>
      <PropertyGroup title="Phasenlast (Worst Case)">
        <PhaseLoad
          analysis={analysis}
          levelId={id}
          maxUnbalanceA={project.settings.maxUnbalanceA}
        />
      </PropertyGroup>
    </>
  );
}

function ChargePointInfo({ project, id }: { project: Project; id: string }) {
  const cp = project.chargePoints.find((c) => c.id === id);
  if (!cp) return null;
  const group = project.groups.find((g) => g.id === cp.groupId);
  const model = cp.libraryModelId
    ? (bundledCatalog.get(cp.libraryModelId)?.displayName ?? cp.libraryModelId)
    : 'Kein Modell gewählt';
  const rows: [string, ReactNode][] = [
    ['Modell', model],
    ['Gruppe', group?.name ?? '–'],
    ['Adresse', `${cp.network.ip}:${cp.network.port}`],
    ['Strom', `${formatA(cp.minA)} bis ${formatA(cp.maxA)}`],
    [
      'Phasen',
      cp.phases === 1
        ? `1-phasig auf ${gridPhaseOf(cp.phaseRotation, 1)}`
        : `3-phasig, ${cp.phaseRotation}`,
    ],
  ];
  return (
    <>
      <PropertyGroup title="Ladepunkt">
        <dl className="structure-info">
          {rows.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
        <p>
          <Link
            className="lp-btn lp-btn--text"
            to={`/projekt/${project.id}/ladepunkte`}
            onClick={() => useEditorStore.getState().select([id])}
          >
            In Ladepunkte öffnen
          </Link>
        </p>
      </PropertyGroup>
    </>
  );
}

export function PropertiesPanel({
  project,
  selectedIds,
}: {
  project: Project;
  selectedIds: string[];
}) {
  const first = selectedIds[0] as string;
  const kind = selectedIds.length === 1 ? kindOf(project, first) : undefined;
  const deletable = selectedIds.filter((id) => id !== SITE_LEVEL_ID);

  let title = `${selectedIds.length} Elemente ausgewählt`;
  let subtitle: string | undefined;
  let body: ReactNode = (
    <p className="structure-muted">
      Zum Verschieben Strg+X drücken, dann ein Ziel wählen und Strg+V drücken. Entf löscht (mit
      Rückgängig).
    </p>
  );
  if (kind === 'site') {
    title = 'Netzanschluss';
    body = <SiteForm project={project} />;
  } else if (kind === 'cluster') {
    title = project.clusters.find((c) => c.id === first)?.name ?? 'Cluster';
    subtitle = 'Cluster';
    body = <ClusterForm project={project} id={first} />;
  } else if (kind === 'group') {
    title = project.groups.find((g) => g.id === first)?.name ?? 'Gruppe';
    subtitle = 'Gruppe';
    body = <GroupForm project={project} id={first} />;
  } else if (kind === 'chargePoint') {
    title = project.chargePoints.find((c) => c.id === first)?.label ?? 'Ladepunkt';
    subtitle = 'Ladepunkt';
    body = <ChargePointInfo project={project} id={first} />;
  }

  return (
    <PropertyPanel
      title={title}
      {...(subtitle ? { subtitle } : {})}
      footer={
        <div className="structure-footer">
          {deletable.length > 0 ? <DeleteButton ids={deletable} project={project} /> : null}
          <Button onClick={() => useEditorStore.getState().clearSelection()}>
            Zurück zur Übersicht
          </Button>
        </div>
      }
    >
      {body}
      {kind ? (
        <PropertyGroup title="Prüfung">
          <ChecksPanel only={[first]} />
        </PropertyGroup>
      ) : null}
    </PropertyPanel>
  );
}
