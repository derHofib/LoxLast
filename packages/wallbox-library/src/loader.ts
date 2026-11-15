import { checkModel, type ModelCheck, type ValidationIssue } from './validate';

/** Eine Modelldatei aus dem Repo oder aus einem Paket. `path` ist relativ zu `models/`. */
export interface ModelFile {
  /** z. B. "abl/em4-twin@1.json" */
  path: string;
  content: string;
}

export interface LoadedModel extends ModelCheck {
  path: string;
  /** Kennung aus dem Pfad, z. B. "abl/em4-twin@1". */
  expectedId: string;
}

export interface LibraryCheck {
  models: LoadedModel[];
  /** Kennungen, die mehrfach vorkommen. */
  duplicateIds: string[];
  /** Ungültige Dateien oder doppelte Kennungen. Nur dann bricht die CI ab. */
  ok: boolean;
}

const PATH_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*\/[a-z0-9]+(-[a-z0-9]+)*@[1-9][0-9]*\.json$/;

/** Prüft eine Datei: JSON lesbar, Schema, Regeln, Kennung passend zum Pfad. */
export function checkModelFile(file: ModelFile): LoadedModel {
  const expectedId = file.path.replace(/\.json$/, '');
  const pathIssues: ValidationIssue[] = PATH_PATTERN.test(file.path)
    ? []
    : [
        {
          severity: 'error',
          path: '/',
          message: `Dateiname muss <hersteller>/<modell>@<version>.json sein, gefunden: ${file.path}`,
        },
      ];

  let data: unknown;
  try {
    data = JSON.parse(file.content);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      path: file.path,
      expectedId,
      status: 'invalid',
      todos: [],
      issues: [
        ...pathIssues,
        { severity: 'error', path: '/', message: `Kein gültiges JSON: ${reason}` },
      ],
    };
  }

  const check = checkModel(data);
  const issues = [...pathIssues, ...check.issues];
  if (check.model && check.model.id !== expectedId) {
    issues.push({
      severity: 'error',
      path: '/id',
      message: `Kennung "${check.model.id}" passt nicht zum Pfad "${expectedId}".`,
    });
  }
  const status = issues.length > 0 ? 'invalid' : check.status;
  return { ...check, status, issues, path: file.path, expectedId };
}

/** Prüft eine ganze Bibliothek. Kennungen müssen eindeutig sein. */
export function loadLibrary(files: ModelFile[]): LibraryCheck {
  const models = files.map(checkModelFile);
  const counts = new Map<string, number>();
  for (const model of models) counts.set(model.expectedId, (counts.get(model.expectedId) ?? 0) + 1);
  const duplicateIds = [...counts].filter(([, count]) => count > 1).map(([id]) => id);
  const ok = duplicateIds.length === 0 && models.every((model) => model.status !== 'invalid');
  return { models, duplicateIds, ok };
}
