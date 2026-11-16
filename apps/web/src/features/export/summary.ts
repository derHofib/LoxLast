import type { Finding, Project } from '@lastplan/core';

/** Was ohne Loxone-Vorlage ehrlich zählbar ist (Kap. 11.3). Ein-/Ausgänge hängen von der Vorlage ab. */
export interface ExportSummary {
  loadManagers: number;
  groupLimits: number;
  walboxBlocks: number;
  modbusDevices: number;
}

export function summarize(project: Project): ExportSummary {
  return {
    loadManagers: project.clusters.length,
    groupLimits: project.groups.filter((g) => g.maxA !== undefined).length,
    walboxBlocks: project.chargePoints.length,
    modbusDevices: project.chargePoints.filter((c) => c.protocol === 'modbus-tcp').length,
  };
}

/** Tab, in dem ein Blocker zu bearbeiten ist: reine Ladepunkt-Meldungen im Ladepunkte-Tab, sonst Struktur. */
export function blockerTab(project: Project, finding: Finding): 'struktur' | 'ladepunkte' {
  const cps = new Set(project.chargePoints.map((c) => c.id));
  return finding.targetIds.length > 0 && finding.targetIds.every((id) => cps.has(id))
    ? 'ladepunkte'
    : 'struktur';
}
