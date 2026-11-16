import Dexie, { type EntityTable } from 'dexie';
import { loadProject, type Project } from '@lastplan/core';
import type { LibraryPackage } from '@lastplan/wallbox-library';

/** Kopfdaten für die Projektübersicht, ohne das ganze Projekt zu laden. */
export interface ProjectSummary {
  id: string;
  name: string;
  customer?: string;
  address?: string;
  updatedAt: string;
  chargePointCount: number;
}

interface ProjectRow {
  id: string;
  name: string;
  updatedAt: string;
  /** Rohdokument; wird beim Lesen über loadProject() migriert und geprüft. */
  doc: Project;
}

/** Zwischenspeicher des zuletzt geprüften Bibliothekspakets (ADR 0002). Schlüssel: „remote“. */
export interface LibraryCacheRow {
  key: string;
  url: string;
  fetchedAt: string;
  library: LibraryPackage;
}

export class LastPlanDB extends Dexie {
  projects!: EntityTable<ProjectRow, 'id'>;
  libraryCache!: EntityTable<LibraryCacheRow, 'key'>;
  constructor(name = 'lastplan') {
    super(name);
    this.version(1).stores({ projects: 'id, name, updatedAt' });
    // Version 2: Tabelle für das nachgeladene Bibliothekspaket. Projekte bleiben unverändert.
    this.version(2).stores({ libraryCache: 'key' });
  }
}

export class ProjectRepository {
  constructor(private readonly db: LastPlanDB) {}

  async save(project: Project): Promise<void> {
    await this.db.projects.put({
      id: project.id,
      name: project.name,
      updatedAt: project.updatedAt,
      doc: project,
    });
  }

  /** Lädt über loadProject (Migration + Formprüfung). Wirft bei defekten Daten mit lesbarer Meldung. */
  async get(id: string): Promise<Project | undefined> {
    const row = await this.db.projects.get(id);
    if (!row) return undefined;
    const result = loadProject(row.doc);
    if (!result.ok) {
      throw new Error(`Projekt „${row.name}“ ist beschädigt: ${result.errors.join('; ')}`);
    }
    return result.project;
  }

  async list(): Promise<ProjectSummary[]> {
    const rows = await this.db.projects.orderBy('updatedAt').reverse().toArray();
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      ...(r.doc.customer ? { customer: r.doc.customer } : {}),
      ...(r.doc.address ? { address: r.doc.address } : {}),
      updatedAt: r.updatedAt,
      chargePointCount: Array.isArray(r.doc.chargePoints) ? r.doc.chargePoints.length : 0,
    }));
  }

  async remove(id: string): Promise<void> {
    await this.db.projects.delete(id);
  }
}

export const db = new LastPlanDB();
export const repository = new ProjectRepository(db);
