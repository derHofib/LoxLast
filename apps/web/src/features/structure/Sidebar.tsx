import { PropertyGroup, PropertyPanel } from '@lastplan/ui';
import { useChecksStore } from '../../state/checksStore';
import { useEditorStore } from '../../state/editorStore';
import { useProjectStore } from '../../state/projectStore';
import { ChecksPanel } from './ChecksPanel';
import { PhaseLoad } from './PhaseLoad';
import { PropertiesPanel } from './PropertiesPanel';
import { SimulationPanel } from './SimulationPanel';
import { SITE_LEVEL_ID } from '@lastplan/core';

/** Rechte Seitenleiste, 340 px: Übersicht (Phasenlast, Prüfung, Simulation) oder Eigenschaften der Auswahl. */
export function Sidebar() {
  const project = useProjectStore((s) => s.project);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const analysis = useChecksStore((s) => s.result?.analysis ?? null);
  if (!project) return null;

  if (selectedIds.length > 0) {
    return <PropertiesPanel project={project} selectedIds={selectedIds} />;
  }
  return (
    <PropertyPanel title="Übersicht" subtitle={project.name}>
      <PropertyGroup title="Phasenlast (Worst Case)">
        <PhaseLoad
          analysis={analysis}
          levelId={SITE_LEVEL_ID}
          maxUnbalanceA={project.settings.maxUnbalanceA}
        />
      </PropertyGroup>
      <PropertyGroup title="Prüfung">
        <ChecksPanel />
      </PropertyGroup>
      <PropertyGroup title="Simulation">
        <SimulationPanel />
      </PropertyGroup>
    </PropertyPanel>
  );
}
