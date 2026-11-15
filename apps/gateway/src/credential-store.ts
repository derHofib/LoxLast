import type { CredentialKind, CredentialMeta, CredentialWrite } from '@lastplan/protocol';
import type { Db } from './db';
import { open, seal } from './crypto';

export interface Secret {
  username?: string;
  password: string;
}

interface Row {
  id: string;
  kind: CredentialKind;
  label: string;
  has_username: number;
  iv: Buffer;
  tag: Buffer;
  ciphertext: Buffer;
  created_at: string;
  updated_at: string;
}

const toMeta = (r: Row): CredentialMeta => ({
  id: r.id,
  kind: r.kind,
  label: r.label,
  hasUsername: r.has_username === 1,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

/** Verschlüsselter Speicher für Miniserver-/Geräte-Zugangsdaten. Klartext verlässt nur `getSecret`. */
export class CredentialStore {
  constructor(
    private readonly db: Db,
    private readonly key: Buffer,
    private readonly now: () => Date = () => new Date(),
  ) {}

  set(id: string, input: CredentialWrite): { meta: CredentialMeta; created: boolean } {
    const ts = this.now().toISOString();
    const payload: Secret = { password: input.password };
    if (input.username !== undefined) payload.username = input.username;
    const sealed = seal(this.key, JSON.stringify(payload), id);
    const existing = this.db.prepare('SELECT created_at FROM credentials WHERE id = ?').get(id) as
      { created_at: string } | undefined;
    this.db
      .prepare(
        `INSERT INTO credentials (id, kind, label, has_username, iv, tag, ciphertext, created_at, updated_at)
         VALUES (@id, @kind, @label, @hasUsername, @iv, @tag, @ciphertext, @ts, @ts)
         ON CONFLICT(id) DO UPDATE SET kind=@kind, label=@label, has_username=@hasUsername,
           iv=@iv, tag=@tag, ciphertext=@ciphertext, updated_at=@ts`,
      )
      .run({
        id,
        kind: input.kind,
        label: input.label,
        hasUsername: input.username !== undefined ? 1 : 0,
        ...sealed,
        ts,
      });
    return { meta: this.getMeta(id) as CredentialMeta, created: existing === undefined };
  }

  getMeta(id: string): CredentialMeta | undefined {
    const row = this.db.prepare('SELECT * FROM credentials WHERE id = ?').get(id) as
      Row | undefined;
    return row && toMeta(row);
  }

  list(): CredentialMeta[] {
    return (this.db.prepare('SELECT * FROM credentials ORDER BY id').all() as Row[]).map(toMeta);
  }

  /** Nur für Geräte-/Miniserver-Clients im Gateway, nie über die API. */
  getSecret(id: string): Secret | undefined {
    const row = this.db.prepare('SELECT * FROM credentials WHERE id = ?').get(id) as
      Row | undefined;
    if (!row) return undefined;
    return JSON.parse(open(this.key, row, id)) as Secret;
  }

  delete(id: string): boolean {
    return this.db.prepare('DELETE FROM credentials WHERE id = ?').run(id).changes > 0;
  }
}
