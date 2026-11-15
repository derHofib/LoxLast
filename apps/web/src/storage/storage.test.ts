import 'fake-indexeddb/auto';
import { createProject } from '@lastplan/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useProjectStore } from '../state/projectStore';
import { command } from '../state/history';
import { startAutosave } from './autosave';
import { LastPlanDB, ProjectRepository } from './db';
import { exportFileName, parseProjectJson, serializeProject, withFreshId } from './exchange';

describe('ProjectRepository', () => {
  let repo: ProjectRepository;
  beforeEach(() => {
    repo = new ProjectRepository(new LastPlanDB(`test-${Math.random()}`));
  });

  it('speichert, listet (neueste zuerst), lädt und löscht', async () => {
    const a = createProject({ name: 'A', now: () => new Date('2026-01-01') });
    const b = createProject({ name: 'B', now: () => new Date('2026-02-01') });
    await repo.save(a);
    await repo.save(b);
    expect((await repo.list()).map((p) => p.name)).toEqual(['B', 'A']);
    expect((await repo.get(a.id))?.name).toBe('A');
    await repo.remove(a.id);
    expect(await repo.get(a.id)).toBeUndefined();
  });

  it('meldet beschädigte Projekte mit lesbarer Meldung', async () => {
    const db = new LastPlanDB(`test-${Math.random()}`);
    const r = new ProjectRepository(db);
    const p = createProject({ name: 'Kaputt' });
    await db.projects.put({
      id: p.id,
      name: p.name,
      updatedAt: p.updatedAt,
      doc: { ...p, schemaVersion: 99 } as unknown as typeof p,
    });
    await expect(r.get(p.id)).rejects.toThrow(/beschädigt/);
  });
});

describe('Austausch', () => {
  it('Roundtrip Export → Import', () => {
    const p = createProject({ name: 'Tiefgarage Süd' });
    const res = parseProjectJson(serializeProject(p));
    expect(res.ok && res.project.name).toBe('Tiefgarage Süd');
    if (res.ok) expect(withFreshId(res.project).id).not.toBe(p.id);
  });
  it('lehnt kaputtes JSON und fremde Dateien verständlich ab', () => {
    const bad = parseProjectJson('{nope');
    expect(!bad.ok && bad.errors[0]).toMatch(/kein gültiges JSON/);
    const foreign = parseProjectJson('{"foo":1}');
    expect(foreign.ok).toBe(false);
  });
  it('bildet Dateinamen', () => {
    expect(exportFileName(createProject({ name: 'Tiefgarage Süd 12!' }))).toBe(
      'tiefgarage-süd-12.lastplan.json',
    );
    expect(exportFileName(createProject({ name: '!!!' }))).toBe('projekt.lastplan.json');
  });
});

describe('Autosave', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useProjectStore.getState().open(createProject({ name: 'A' }));
  });

  it('speichert entprellt und meldet Status', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const status = vi.fn();
    const stop = startAutosave({ save }, status, 100);
    const rename = (n: string) =>
      command('r', (d) => {
        d.name = n;
      });
    useProjectStore.getState().execute(rename('B'));
    useProjectStore.getState().execute(rename('C'));
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(150);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]?.[0].name).toBe('C');
    expect(useProjectStore.getState().dirty).toBe(false);
    expect(status).toHaveBeenLastCalledWith('saved');
    stop();
  });

  it('meldet Fehler und bleibt dirty', async () => {
    const save = vi.fn().mockRejectedValue(new Error('Speicher voll'));
    const status = vi.fn();
    const stop = startAutosave({ save }, status, 50);
    useProjectStore.getState().execute(
      command('r', (d) => {
        d.name = 'B';
      }),
    );
    await vi.advanceTimersByTimeAsync(80);
    expect(status).toHaveBeenLastCalledWith('error', 'Speicher voll');
    expect(useProjectStore.getState().dirty).toBe(true);
    stop();
  });
});
