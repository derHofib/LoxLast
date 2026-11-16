import { newId, structureHash, type ExportRecord, type Project } from '@lastplan/core';
import { command, type Command } from '../../state/history';

export interface ExportRecordInput {
  mode: ExportRecord['mode'];
  configVersion?: string | undefined;
  /** UUIDs, die die Übergabe in Config angelegt hat (6.6). */
  config?: ExportRecord['config'] | undefined;
  /** Nur für Tests. */
  now?: Date;
  id?: string;
}

/**
 * Hängt nach erfolgreichem Export einen ExportRecord an (Kap. 7.2 Schritt 6). Der Struktur-Hash
 * wird vom Stand des Projekts beim Export genommen. Läuft über das Undo (ein Schritt).
 * In der Oberfläche erst aktiv, wenn ein Generator existiert.
 */
export function recordExportCommand(project: Project, input: ExportRecordInput): Command {
  const record: ExportRecord = {
    id: input.id ?? newId(),
    createdAt: (input.now ?? new Date()).toISOString(),
    mode: input.mode,
    structureHash: structureHash(project),
    ...(input.configVersion ? { configVersion: input.configVersion } : {}),
    ...(input.config ? { config: input.config } : {}),
  };
  return command('Export vermerken', (d) => {
    d.exportHistory.push(record);
  });
}

export function lastExport(project: Project): ExportRecord | undefined {
  return project.exportHistory[project.exportHistory.length - 1];
}

/** Hat sich die Struktur seit dem letzten Export geändert? Ohne Export: false. */
export function structureChangedSinceExport(project: Project): boolean {
  const last = lastExport(project);
  return last !== undefined && last.structureHash !== structureHash(project);
}
