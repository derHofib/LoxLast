import { analyzeProject, optimizePhaseRotations, type Project } from '@lastplan/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { sampleProject } from '../test-fixtures';
import {
  addChargePointCommand,
  addClusterCommand,
  addGroupCommand,
  applyFixCommand,
  deleteCommand,
  duplicateCommand,
  moveChargePointsCommand,
  moveClusterCommand,
  moveGroupsCommand,
  updateChargePointsCommand,
  updateClusterCommand,
  updateGroupCommand,
  updateSiteCommand,
} from './commands';
import type { Command } from './history';
import { useProjectStore } from './projectStore';

const s = () => useProjectStore.getState();
const p = () => s().project as Project;

/** Führt aus, macht rückgängig, wiederholt – Ergebnis muss jeweils exakt stimmen. */
function roundTrip(cmd: Command) {
  const before = JSON.stringify({ ...p(), updatedAt: '' });
  s().execute(cmd);
  const after = JSON.stringify({ ...p(), updatedAt: '' });
  expect(after).not.toBe(before);
  expect(s().past.at(-1)?.label).toBe(cmd.label);
  s().undo();
  expect(JSON.stringify({ ...p(), updatedAt: '' })).toBe(before);
  s().redo();
  expect(JSON.stringify({ ...p(), updatedAt: '' })).toBe(after);
}

beforeEach(() => s().open(sampleProject()));

describe('Befehle mit Undo/Redo', () => {
  it('anlegen', () => {
    const cluster = addClusterCommand({ name: 'UV-TG2' });
    roundTrip(cluster.command);
    expect(p().clusters.at(-1)?.id).toBe(cluster.id);
    const group = addGroupCommand({ clusterId: cluster.id, name: 'Gäste' });
    roundTrip(group.command);
    const cp = addChargePointCommand({ groupId: group.id });
    roundTrip(cp.command);
    expect(p().chargePoints.find((c) => c.id === cp.id)).toMatchObject({
      label: 'LP04',
      groupId: group.id,
    });
  });

  it('ändern, inklusive Entfernen optionaler Felder im Immer-Draft', () => {
    const fleet = p().groups[1]!;
    roundTrip(updateGroupCommand(fleet.id, { maxA: undefined, priority: 4 }));
    expect(p().groups[1]).not.toHaveProperty('maxA');
    roundTrip(updateClusterCommand(p().clusters[0]!.id, { limitA: 100 }));
    roundTrip(updateSiteCommand({ buildingReserveA: 40 }));
  });

  it('Massenbearbeitung ist ein Undo-Schritt', () => {
    const cmd = updateChargePointsCommand(
      p().chargePoints.map((c) => c.id),
      { minA: 8 },
    );
    expect(cmd.label).toBe('3 Ladepunkte ändern');
    roundTrip(cmd);
    expect(p().chargePoints.every((c) => c.minA === 8)).toBe(true);
    expect(updateChargePointsCommand([p().chargePoints[0]!.id], { minA: 7 }).label).toBe(
      'Ladepunkt ändern',
    );
  });

  it('verschieben', () => {
    const [tenants, fleet] = p().groups;
    roundTrip(moveChargePointsCommand([p().chargePoints[0]!.id], fleet!.id));
    const other = addClusterCommand({ name: 'UV-TG2' });
    s().execute(other.command);
    roundTrip(moveGroupsCommand([tenants!.id], other.id));
    roundTrip(moveClusterCommand(other.id, p().clusters[0]!.id));
  });

  it('löschen mit Undo statt Rückfrage', () => {
    const cmd = deleteCommand(p(), [p().groups[0]!.id]);
    expect(cmd.label).toBe('Mieter löschen');
    roundTrip(cmd);
    expect(p().chargePoints.map((c) => c.label)).toEqual(['LP03']);
    expect(deleteCommand(p(), [p().chargePoints[0]!.id]).label).toBe('LP03 löschen');
    expect(deleteCommand(p(), [p().clusters[0]!.id]).label).toBe('UV-TG1 löschen');
    expect(deleteCommand(p(), ['a', 'b']).label).toBe('2 Elemente löschen');
    expect(deleteCommand(p(), ['fehlt']).label).toBe('Element löschen');
  });

  it('duplizieren liefert stabile IDs auch nach Undo/Redo', () => {
    const { command, created } = duplicateCommand(p(), [p().chargePoints[0]!.id]);
    roundTrip(command);
    expect(created).toHaveLength(1);
    expect(p().chargePoints.find((c) => c.id === created[0])?.label).toBe('LP04');
  });

  it('Lösungsvorschlag anwenden', () => {
    const fix = optimizePhaseRotations(p());
    const cmd = applyFixCommand({ label: 'Phasenlage ändern', changes: fix.changes });
    roundTrip(cmd);
    expect(analyzeProject(p()).loadByLevel.get('site')?.unbalanceA).toBe(0);
  });
});
