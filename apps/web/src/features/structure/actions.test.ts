import { createProject } from '@lastplan/core';
import { describe, expect, it } from 'vitest';
import { runCommand } from '../../state/history';
import { sampleProject } from '../../test-fixtures';
import {
  clusterForSelection,
  createChargePoint,
  createCluster,
  createGroup,
  createSubCluster,
  defaultModelId,
  groupForSelection,
} from './actions';

describe('Anlegen mit sinnvollen Standardeltern', () => {
  it('+ Ladepunkt in leerem Projekt legt Cluster, Gruppe und Ladepunkt in einem Undo-Schritt an', () => {
    const project = createProject({ name: 'Neu' });
    const action = createChargePoint(project, undefined);
    const result = runCommand(project, action.command)!;
    expect(result.project.clusters).toHaveLength(1);
    expect(result.project.groups).toHaveLength(1);
    expect(result.project.chargePoints).toHaveLength(1);
    expect(result.project.chargePoints[0]!.id).toBe(action.id);
    expect(result.project.chargePoints[0]!.libraryModelId).toBe(defaultModelId());
    expect(action.message).toBe('Ladepunkt LP01 angelegt');
  });

  it('+ Gruppe in leerem Projekt legt auch den Cluster an', () => {
    const project = createProject({ name: 'Neu' });
    const action = createGroup(project, undefined);
    const result = runCommand(project, action.command)!;
    expect(result.project.clusters).toHaveLength(1);
    expect(result.project.groups[0]!.clusterId).toBe(result.project.clusters[0]!.id);
    expect(action.message).toMatch(/^Gruppe „Gruppe 1“ angelegt$/);
  });

  it('+ Cluster und + Untercluster', () => {
    const project = sampleProject();
    const top = runCommand(project, createCluster().command)!.project;
    expect(top.clusters.at(-1)!.parentClusterId).toBeUndefined();
    const parent = project.clusters[0]!.id;
    const sub = createSubCluster(parent);
    const next = runCommand(project, sub.command)!.project;
    expect(next.clusters.find((c) => c.id === sub.id)?.parentClusterId).toBe(parent);
    expect(sub.message).toMatch(/Cluster „UV-/);
  });

  it('Eltern aus der Auswahl: Ladepunkt → seine Gruppe, Cluster → erste Gruppe, sonst zuletzt angelegte', () => {
    const p = sampleProject();
    const [mieter, flotte] = p.groups;
    const cluster = p.clusters[0]!.id;
    expect(groupForSelection(p, p.chargePoints[2]!.id)).toBe(flotte!.id);
    expect(groupForSelection(p, mieter!.id)).toBe(mieter!.id);
    expect(groupForSelection(p, cluster)).toBe(mieter!.id);
    expect(groupForSelection(p, undefined)).toBe(flotte!.id);
    expect(groupForSelection(p, 'site')).toBe(flotte!.id);
    expect(clusterForSelection(p, p.chargePoints[0]!.id)).toBe(cluster);
    expect(clusterForSelection(p, mieter!.id)).toBe(cluster);
    expect(clusterForSelection(p, cluster)).toBe(cluster);
    expect(clusterForSelection(p, undefined)).toBe(cluster);
  });

  it('+ Ladepunkt übernimmt Werte des letzten Ladepunkts und zählt fort', () => {
    const p = sampleProject();
    const action = createChargePoint(p, p.groups[0]!.id);
    const next = runCommand(p, action.command)!.project;
    const created = next.chargePoints.find((c) => c.id === action.id)!;
    expect(created.groupId).toBe(p.groups[0]!.id);
    expect(created.label).toBe('LP04');
    expect(created.libraryModelId).toBe('test/wallbox@1');
  });

  it('Gruppe ohne Ladepunkte im Projekt: + Ladepunkt nutzt die Gruppe der Auswahl-Cluster', () => {
    const p = sampleProject();
    p.chargePoints = [];
    const next = runCommand(p, createChargePoint(p, p.clusters[0]!.id).command)!.project;
    expect(next.groups).toHaveLength(2);
    expect(next.chargePoints[0]!.libraryModelId).toBe(defaultModelId());
  });
});
