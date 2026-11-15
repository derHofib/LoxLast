import { createProject } from '@lastplan/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { batch, command, runCommand } from './history';
import { useProjectStore } from './projectStore';

const rename = (name: string) =>
  command(`Umbenennen in ${name}`, (d) => {
    d.name = name;
  });

describe('runCommand', () => {
  it('liefert null, wenn nichts geändert wird', () => {
    const p = createProject({ name: 'A' });
    expect(runCommand(p, rename('A'))).toBeNull();
  });
});

describe('Projekt-Store: Undo/Redo', () => {
  beforeEach(() => useProjectStore.getState().open(createProject({ name: 'A' })));
  const s = () => useProjectStore.getState();

  it('macht Änderungen rückgängig und stellt sie wieder her', () => {
    s().execute(rename('B'));
    s().execute(rename('C'));
    expect(s().project?.name).toBe('C');
    s().undo();
    expect(s().project?.name).toBe('B');
    s().undo();
    expect(s().project?.name).toBe('A');
    s().redo();
    expect(s().project?.name).toBe('B');
    expect(s().future).toHaveLength(1);
  });

  it('neuer Befehl verwirft die Redo-Kette', () => {
    s().execute(rename('B'));
    s().undo();
    s().execute(rename('X'));
    expect(s().future).toHaveLength(0);
    s().redo();
    expect(s().project?.name).toBe('X');
  });

  it('Sammelbefehl ist ein einziger Undo-Schritt', () => {
    s().execute(
      batch('Mehrfach', [
        rename('B'),
        command('Kunde', (d) => {
          d.customer = 'Müller';
        }),
      ]),
    );
    expect(s().past).toHaveLength(1);
    s().undo();
    expect(s().project?.name).toBe('A');
    expect(s().project?.customer).toBeUndefined();
  });

  it('markiert dirty und aktualisiert updatedAt', () => {
    const before = s().project?.updatedAt ?? '';
    expect(s().dirty).toBe(false);
    s().execute(rename('B'));
    expect(s().dirty).toBe(true);
    expect((s().project?.updatedAt ?? '') >= before).toBe(true);
    s().markSaved();
    expect(s().dirty).toBe(false);
  });

  it('begrenzt die Historie', () => {
    for (let i = 0; i < 230; i++) s().execute(rename(`N${i}`));
    expect(s().past.length).toBe(200);
  });

  it('Undo/Redo ohne Einträge ist wirkungslos', () => {
    s().undo();
    s().redo();
    expect(s().project?.name).toBe('A');
  });
});
