import type { LoadedModel, LibraryCheck, ModelFile } from './loader';
import { loadLibrary } from './loader';
import type { WallboxModel } from './model';
import { checkModel, type ModelCheck, type ValidationIssue } from './validate';

/**
 * Veröffentlichtes Bibliothekspaket (ADR 0002): `library.json` enthält alle gültigen Modelle,
 * `index.json` nur Version und Anzahl, damit die App billig prüfen kann, ob es etwas Neues gibt.
 */
export const LIBRARY_FORMAT_VERSION = 1;

export interface LibraryPackage {
  formatVersion: typeof LIBRARY_FORMAT_VERSION;
  /** Commit-SHA aus der CI oder ein Zeitstempel bei lokalem Bau. */
  version: string;
  generatedAt: string;
  models: WallboxModel[];
}

export interface LibraryIndex {
  version: string;
  modelCount: number;
}

export type PackageCheck =
  { ok: true; library: LibraryPackage; checks: ModelCheck[] } | { ok: false; errors: string[] };

export type PackageBuild =
  { ok: true; library: LibraryPackage; index: LibraryIndex } | { ok: false; errors: string[] };

export interface PackageMeta {
  version: string;
  generatedAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describeIssues(issues: ValidationIssue[]): string {
  return issues.map((issue) => `${issue.path} ${issue.message}`).join('; ');
}

/**
 * Prüft ein geparstes Paket (z. B. aus dem Netz): Format, Pflichtfelder und jedes Modell
 * mit Schema und Regeln. Unvollständige Modelle sind gültig; ungültige machen das Paket ungültig.
 */
export function checkLibraryPackage(data: unknown): PackageCheck {
  if (!isRecord(data)) return { ok: false, errors: ['Paket ist kein JSON-Objekt.'] };

  const errors: string[] = [];
  if (data['formatVersion'] !== LIBRARY_FORMAT_VERSION) {
    errors.push(
      `formatVersion ${JSON.stringify(data['formatVersion'])} wird nicht unterstützt (erwartet ${LIBRARY_FORMAT_VERSION}).`,
    );
  }
  if (typeof data['version'] !== 'string' || data['version'].trim() === '') {
    errors.push('version fehlt.');
  }
  if (typeof data['generatedAt'] !== 'string') errors.push('generatedAt fehlt.');
  if (!Array.isArray(data['models'])) errors.push('models fehlt oder ist keine Liste.');
  if (errors.length > 0 || !Array.isArray(data['models'])) return { ok: false, errors };

  const checks: ModelCheck[] = [];
  const models: WallboxModel[] = [];
  const ids = new Map<string, number>();
  data['models'].forEach((entry: unknown, index: number) => {
    const check = checkModel(entry);
    const label =
      isRecord(entry) && typeof entry['id'] === 'string' ? entry['id'] : `Modell #${index + 1}`;
    if (check.status === 'invalid' || !check.model) {
      errors.push(`${label}: ${describeIssues(check.issues)}`);
      return;
    }
    ids.set(check.model.id, (ids.get(check.model.id) ?? 0) + 1);
    checks.push(check);
    models.push(check.model);
  });
  for (const [id, count] of ids) {
    if (count > 1) errors.push(`Kennung ${id} kommt ${count}-mal vor.`);
  }
  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    library: {
      formatVersion: LIBRARY_FORMAT_VERSION,
      version: data['version'] as string,
      generatedAt: data['generatedAt'] as string,
      models,
    },
    checks,
  };
}

/**
 * Baut das Paket aus den Modelldateien. Scheitert, sobald eine Datei ungültig ist oder
 * eine Kennung doppelt vorkommt; dann wird nichts veröffentlicht.
 */
export function buildLibraryPackage(files: ModelFile[], meta: PackageMeta): PackageBuild {
  const library: LibraryCheck = loadLibrary(files);
  const errors = [
    ...library.models
      .filter((model: LoadedModel) => model.status === 'invalid')
      .map((model) => `${model.path}: ${describeIssues(model.issues)}`),
    ...library.duplicateIds.map((id) => `Kennung ${id} kommt mehrfach vor.`),
  ];
  if (errors.length > 0) return { ok: false, errors };

  const models = library.models
    .flatMap((model) => (model.model ? [model.model] : []))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const pkg: LibraryPackage = {
    formatVersion: LIBRARY_FORMAT_VERSION,
    version: meta.version,
    generatedAt: meta.generatedAt,
    models,
  };

  // Rundlauf über den Paketprüfer: Was veröffentlicht wird, ist genau das, was die App annimmt.
  const roundTrip = checkLibraryPackage(JSON.parse(JSON.stringify(pkg)));
  if (!roundTrip.ok) return roundTrip;

  return {
    ok: true,
    library: pkg,
    index: { version: meta.version, modelCount: models.length },
  };
}
