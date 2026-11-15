import { loadProject, newId, type Project } from '@lastplan/core';

export type ImportResult =
  { ok: true; project: Project; migratedFrom: number | null } | { ok: false; errors: string[] };

/** Liest JSON-Text als Projekt; defekte Dateien liefern lesbare Fehler statt Absturz. */
export function parseProjectJson(text: string): ImportResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return {
      ok: false,
      errors: [
        'Datei ist kein gültiges JSON. Bitte eine mit LastPlan exportierte .json-Datei wählen.',
      ],
    };
  }
  return loadProject(raw);
}

/** Importierte Projekte bekommen eine neue ID, damit ein vorhandenes nie überschrieben wird. */
export const withFreshId = (p: Project): Project => ({ ...p, id: newId() });

export const serializeProject = (p: Project): string => JSON.stringify(p, null, 2) + '\n';

export function exportFileName(p: Project): string {
  const slug = p.name
    .toLowerCase()
    .replace(/[^a-z0-9äöüß]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${slug || 'projekt'}.lastplan.json`;
}

export function downloadProject(p: Project): void {
  const url = URL.createObjectURL(new Blob([serializeProject(p)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = exportFileName(p);
  a.click();
  URL.revokeObjectURL(url);
}
