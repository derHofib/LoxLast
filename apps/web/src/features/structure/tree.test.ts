import { SITE_LEVEL_ID } from '@lastplan/core';
import { describe, expect, it } from 'vitest';
import { sampleProject } from '../../test-fixtures';
import { buildTree, navigate } from './tree';

describe('buildTree', () => {
  it('ordnet Netzanschluss, Cluster, Gruppen und Ladepunkte in Tiefensuche-Reihenfolge', () => {
    const p = sampleProject();
    const tree = buildTree(p);
    const [cluster] = p.clusters;
    expect(tree.order).toEqual([
      SITE_LEVEL_ID,
      cluster!.id,
      p.groups[0]!.id,
      p.chargePoints[0]!.id,
      p.chargePoints[1]!.id,
      p.groups[1]!.id,
      p.chargePoints[2]!.id,
    ]);
    expect(tree.items.get(p.groups[0]!.id)).toMatchObject({ parentId: cluster!.id, kind: 'group' });
  });

  it('hängt Unter-Cluster unter ihren Cluster und behandelt Zyklen und verwaiste Cluster robust', () => {
    const p = sampleProject();
    const a = p.clusters[0]!.id;
    p.clusters.push(
      { id: 'sub', name: 'Sub', limitA: 32, parentClusterId: a },
      { id: 'orphan', name: 'Waise', limitA: 32, parentClusterId: 'weg' },
    );
    const tree = buildTree(p);
    expect(tree.items.get('sub')?.parentId).toBe(a);
    expect(tree.items.get('orphan')?.parentId).toBe(SITE_LEVEL_ID);
    // Zyklus: x ↔ y hängen an keinem Top-Cluster und tauchen nicht auf (Prüfung meldet es)
    p.clusters.push(
      { id: 'x', name: 'X', limitA: 32, parentClusterId: 'y' },
      { id: 'y', name: 'Y', limitA: 32, parentClusterId: 'x' },
    );
    expect(buildTree(p).items.has('x')).toBe(false);
  });
});

describe('navigate – Pfeiltasten im Baum', () => {
  const p = sampleProject();
  const tree = buildTree(p);
  const cluster = p.clusters[0]!.id;
  const mieter = p.groups[0]!.id;
  const lp01 = p.chargePoints[0]!.id;

  it('Auf/Ab folgt der Reihenfolge und bleibt an den Enden stehen', () => {
    expect(navigate(tree, SITE_LEVEL_ID, 'ArrowDown')).toBe(cluster);
    expect(navigate(tree, cluster, 'ArrowUp')).toBe(SITE_LEVEL_ID);
    expect(navigate(tree, SITE_LEVEL_ID, 'ArrowUp')).toBe(SITE_LEVEL_ID);
    const last = tree.order.at(-1)!;
    expect(navigate(tree, last, 'ArrowDown')).toBe(last);
  });

  it('Rechts geht ins erste Kind, Links zum Elternelement', () => {
    expect(navigate(tree, cluster, 'ArrowRight')).toBe(mieter);
    expect(navigate(tree, mieter, 'ArrowRight')).toBe(lp01);
    expect(navigate(tree, lp01, 'ArrowRight')).toBe(lp01);
    expect(navigate(tree, lp01, 'ArrowLeft')).toBe(mieter);
    expect(navigate(tree, SITE_LEVEL_ID, 'ArrowLeft')).toBe(SITE_LEVEL_ID);
  });

  it('Pos1/Ende und unbekannte Ausgangslage', () => {
    expect(navigate(tree, lp01, 'Home')).toBe(SITE_LEVEL_ID);
    expect(navigate(tree, lp01, 'End')).toBe(tree.order.at(-1));
    expect(navigate(tree, undefined, 'ArrowDown')).toBe(SITE_LEVEL_ID);
    expect(navigate(tree, 'weg', 'ArrowDown')).toBe(SITE_LEVEL_ID);
  });
});
