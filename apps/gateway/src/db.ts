import Database from 'better-sqlite3';

export type Db = Database.Database;

/** Schemaversion der Gateway-Datenbank, über `PRAGMA user_version` geführt. */
const MIGRATIONS: readonly string[] = [
  `
  -- tenant_id ist für den späteren Server-Betrieb vorgesehen (Kap. 12), wird noch nicht genutzt.
  CREATE TABLE credentials (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    label TEXT NOT NULL,
    has_username INTEGER NOT NULL,
    tenant_id TEXT NOT NULL DEFAULT 'default',
    iv BLOB NOT NULL,
    tag BLOB NOT NULL,
    ciphertext BLOB NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE changelog (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT NOT NULL,
    tenant_id TEXT NOT NULL DEFAULT 'default',
    actor TEXT,
    action TEXT NOT NULL,
    project_id TEXT,
    target TEXT,
    before_json TEXT,
    after_json TEXT
  );
  CREATE TABLE tokens (
    hash TEXT PRIMARY KEY,
    expires_at INTEGER NOT NULL
  );
  -- Das Änderungsprotokoll ist append-only.
  CREATE TRIGGER changelog_no_update BEFORE UPDATE ON changelog
    BEGIN SELECT RAISE(ABORT, 'Änderungsprotokoll ist unveränderlich'); END;
  CREATE TRIGGER changelog_no_delete BEFORE DELETE ON changelog
    BEGIN SELECT RAISE(ABORT, 'Änderungsprotokoll ist unveränderlich'); END;
  `,
];

export function openDb(path: string): Db {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  const current = db.pragma('user_version', { simple: true }) as number;
  if (current > MIGRATIONS.length) {
    throw new Error(
      `Datenbank stammt aus einer neueren Gateway-Version (Schema ${current}). Bitte Gateway aktualisieren.`,
    );
  }
  for (let v = current; v < MIGRATIONS.length; v++) {
    const sql = MIGRATIONS[v] as string;
    db.transaction(() => {
      db.exec(sql);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
  return db;
}
