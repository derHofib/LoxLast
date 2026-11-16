import { z } from 'zod';
import { DEFAULT_NAMING_SCHEME, NAMING_SCHEME_V1 } from '../model/naming';
import { CURRENT_SCHEMA_VERSION, ProjectSchema, type Project } from '../model/project';

/**
 * Migrationsrahmen für gespeicherte Projekte (Kap. 3).
 *
 * Jede Migration hebt ein Rohdokument von Version n auf n + 1 und ist eine reine Funktion.
 * Neue Formatversion:
 *   1. CURRENT_SCHEMA_VERSION erhöhen,
 *   2. Migration `n: (doc) => …` in MIGRATIONS eintragen,
 *   3. Test mit einem echten Dokument der alten Version unter migrations/__fixtures__ ergänzen.
 */
export type RawDocument = Record<string, unknown>;
export type Migration = (doc: RawDocument) => RawDocument;

const isRecord = (v: unknown): v is RawDocument =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * 1 → 2: neues Standard-Benennungsschema (2026-11-16). Nur Vorlagen, die noch dem alten Standard
 * entsprechen, werden ersetzt; eigene Vorlagen bleiben.
 */
const migrateNamingV1: Migration = (doc) => {
  const settings = doc['settings'];
  if (!isRecord(settings)) return doc;
  const scheme = settings['namingScheme'];
  if (!isRecord(scheme)) return doc;
  const next: RawDocument = { ...scheme };
  for (const [field, old] of Object.entries(NAMING_SCHEME_V1)) {
    if (scheme[field] === old)
      next[field] = DEFAULT_NAMING_SCHEME[field as keyof typeof NAMING_SCHEME_V1];
  }
  return { ...doc, settings: { ...settings, namingScheme: next } };
};

/** Schlüssel = Ausgangsversion. */
export const MIGRATIONS: Readonly<Record<number, Migration>> = { 1: migrateNamingV1 };

export class ProjectMigrationError extends Error {
  override readonly name = 'ProjectMigrationError';
}

export interface MigrateOptions {
  migrations?: Readonly<Record<number, Migration>>;
  targetVersion?: number;
}

/** Hebt ein Rohdokument auf die Zielversion. Wirft ProjectMigrationError mit deutscher Meldung. */
export function migrateDocument(
  raw: unknown,
  { migrations = MIGRATIONS, targetVersion = CURRENT_SCHEMA_VERSION }: MigrateOptions = {},
): { doc: RawDocument; fromVersion: number } {
  if (!isRecord(raw)) {
    throw new ProjectMigrationError('Datei enthält kein LastPlan-Projekt (JSON-Objekt erwartet)');
  }
  const fromVersion = raw['schemaVersion'];
  if (typeof fromVersion !== 'number' || !Number.isInteger(fromVersion) || fromVersion < 1) {
    throw new ProjectMigrationError(
      'Projektformat-Version fehlt oder ist ungültig (Feld „schemaVersion“)',
    );
  }
  if (fromVersion > targetVersion) {
    throw new ProjectMigrationError(
      `Projekt wurde mit einer neueren LastPlan-Version gespeichert (Format ${fromVersion}, unterstützt bis ${targetVersion}). Bitte LastPlan aktualisieren.`,
    );
  }

  let doc: RawDocument = raw;
  for (let version = fromVersion; version < targetVersion; version++) {
    const migration = migrations[version];
    if (!migration) {
      throw new ProjectMigrationError(
        `Keine Migration von Format ${version} auf ${version + 1} vorhanden`,
      );
    }
    doc = { ...migration(doc), schemaVersion: version + 1 };
  }
  return { doc, fromVersion };
}

export type LoadProjectResult =
  { ok: true; project: Project; migratedFrom: number | null } | { ok: false; errors: string[] };

/** Zod-Pfad als lesbarer Text, z. B. „chargePoints[2].minA“. */
export function formatPath(path: readonly PropertyKey[]): string {
  return path
    .map((segment, i) =>
      typeof segment === 'number' ? `[${segment}]` : `${i === 0 ? '' : '.'}${String(segment)}`,
    )
    .join('');
}

const germanErrors = z.locales.de().localeError;

/**
 * Lädt ein gespeichertes oder importiertes Projekt: migriert und prüft die Form.
 * Fachliche Widersprüche (Invarianten) blockieren das Laden nicht – sie erscheinen in der Prüfung.
 */
export function loadProject(raw: unknown): LoadProjectResult {
  let migrated: { doc: RawDocument; fromVersion: number };
  try {
    migrated = migrateDocument(raw);
  } catch (error) {
    if (error instanceof ProjectMigrationError) return { ok: false, errors: [error.message] };
    throw error;
  }
  const parsed = ProjectSchema.safeParse(migrated.doc, { error: germanErrors });
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((issue) =>
        issue.path.length > 0 ? `${formatPath(issue.path)}: ${issue.message}` : issue.message,
      ),
    };
  }
  return {
    ok: true,
    project: parsed.data,
    migratedFrom: migrated.fromVersion === CURRENT_SCHEMA_VERSION ? null : migrated.fromVersion,
  };
}
