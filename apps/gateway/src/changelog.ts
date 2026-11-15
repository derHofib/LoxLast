import type { ChangelogAction, ChangelogEntry } from '@lastplan/protocol';
import type { Db } from './db';

interface Row {
  id: number;
  at: string;
  action: ChangelogAction;
  target: string | null;
  detail: string | null;
}

/** Append-only (auch per DB-Trigger erzwungen). `detail` darf nie Geheimnisse enthalten. */
export class Changelog {
  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date(),
  ) {}

  record(
    action: ChangelogAction,
    target: string | null = null,
    detail?: Record<string, unknown>,
  ): void {
    this.db
      .prepare('INSERT INTO changelog (at, action, target, detail) VALUES (?, ?, ?, ?)')
      .run(this.now().toISOString(), action, target, detail ? JSON.stringify(detail) : null);
  }

  list(limit: number, beforeId?: number): ChangelogEntry[] {
    const rows = (
      beforeId === undefined
        ? this.db.prepare('SELECT * FROM changelog ORDER BY id DESC LIMIT ?').all(limit)
        : this.db
            .prepare('SELECT * FROM changelog WHERE id < ? ORDER BY id DESC LIMIT ?')
            .all(beforeId, limit)
    ) as Row[];
    return rows.map((r) => ({
      id: r.id,
      at: r.at,
      action: r.action,
      target: r.target,
      detail: r.detail ? (JSON.parse(r.detail) as Record<string, unknown>) : null,
    }));
  }
}
