import type { ChangelogAction, ChangelogEntry } from '@lastplan/protocol';
import type { Db } from './db';

interface Row {
  id: number;
  at: string;
  actor: string | null;
  action: ChangelogAction;
  project_id: string | null;
  target: string | null;
  before_json: string | null;
  after_json: string | null;
}

export interface RecordInput {
  action: ChangelogAction;
  actor?: string | undefined;
  projectId?: string | undefined;
  target?: string | undefined;
  before?: unknown;
  after?: unknown;
}

const parse = (s: string | null): unknown => (s === null ? null : JSON.parse(s));

/** Append-only (auch per DB-Trigger erzwungen). `before`/`after` dürfen nie Geheimnisse enthalten. */
export class Changelog {
  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date(),
  ) {}

  record(input: RecordInput): void {
    this.db
      .prepare(
        `INSERT INTO changelog (at, actor, action, project_id, target, before_json, after_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        this.now().toISOString(),
        input.actor ?? null,
        input.action,
        input.projectId ?? null,
        input.target ?? null,
        input.before === undefined ? null : JSON.stringify(input.before),
        input.after === undefined ? null : JSON.stringify(input.after),
      );
  }

  /** Neueste zuerst. Mit `projectId` nur Einträge dieses Projekts. */
  list(opts: {
    limit: number;
    beforeId?: number | undefined;
    projectId?: string | undefined;
  }): ChangelogEntry[] {
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (opts.projectId !== undefined) {
      where.push('project_id = ?');
      params.push(opts.projectId);
    }
    if (opts.beforeId !== undefined) {
      where.push('id < ?');
      params.push(opts.beforeId);
    }
    const sql = `SELECT * FROM changelog ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT ?`;
    const rows = this.db.prepare(sql).all(...params, opts.limit) as unknown as Row[];
    return rows.map((r) => ({
      id: r.id,
      at: r.at,
      actor: r.actor,
      action: r.action,
      projectId: r.project_id,
      target: r.target,
      before: parse(r.before_json),
      after: parse(r.after_json),
    }));
  }
}
