import type { Db } from './db';
import { open, seal } from './crypto';

export type CredentialKind = 'miniserver' | 'device';

export interface Secret {
  host?: string;
  username?: string;
  password: string;
}

export interface CredentialMeta {
  id: string;
  kind: CredentialKind;
  label: string;
  createdAt: string;
  updatedAt: string;
}

interface Row {
  id: string;
  kind: CredentialKind;
  label: string;
  iv: Uint8Array;
  tag: Uint8Array;
  ciphertext: Uint8Array;
  created_at: string;
  updated_at: string;
}

const toMeta = (r: Row): CredentialMeta => ({
  id: r.id,
  kind: r.kind,
  label: r.label,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

/**
 * Verschlüsselter Speicher für Miniserver-/Geräte-Zugangsdaten (Kap. 12).
 * Klartext verlässt nur `getSecret` (für Hardware-Clients im Gateway), nie die API.
 */
export class CredentialStore {
  constructor(
    private readonly db: Db,
    private readonly key: Buffer,
    private readonly now: () => Date = () => new Date(),
  ) {}

  set(
    id: string,
    kind: CredentialKind,
    label: string,
    secret: Secret,
  ): { meta: CredentialMeta; created: boolean } {
    const ts = this.now().toISOString();
    const payload: Secret = { password: secret.password };
    if (secret.host !== undefined) payload.host = secret.host;
    if (secret.username !== undefined) payload.username = secret.username;
    const sealed = seal(this.key, JSON.stringify(payload), id);
    const existing = this.getMeta(id);
    this.db
      .prepare(
        `INSERT INTO credentials (id, kind, label, has_username, iv, tag, ciphertext, created_at, updated_at)
         VALUES (@id, @kind, @label, @hasUsername, @iv, @tag, @ciphertext, @ts, @ts)
         ON CONFLICT(id) DO UPDATE SET kind=@kind, label=@label, has_username=@hasUsername,
           iv=@iv, tag=@tag, ciphertext=@ciphertext, updated_at=@ts`,
      )
      .run({ id, kind, label, hasUsername: secret.username !== undefined ? 1 : 0, ...sealed, ts });
    return { meta: this.getMeta(id) as CredentialMeta, created: existing === undefined };
  }

  getMeta(id: string): CredentialMeta | undefined {
    const row = this.db.prepare('SELECT * FROM credentials WHERE id = ?').get(id) as
      Row | undefined;
    return row && toMeta(row);
  }

  getSecret(id: string): Secret | undefined {
    const row = this.db.prepare('SELECT * FROM credentials WHERE id = ?').get(id) as
      Row | undefined;
    if (!row) return undefined;
    return JSON.parse(open(this.key, row, id)) as Secret;
  }

  delete(id: string): boolean {
    return Number(this.db.prepare('DELETE FROM credentials WHERE id = ?').run(id).changes) > 0;
  }
}
