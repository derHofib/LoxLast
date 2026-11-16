import { SITE_LEVEL_ID, type Project } from '@lastplan/core';
import { describe, expect, it } from 'vitest';
import { runCommand } from '../../state/history';
import { sampleProject } from '../../test-fixtures';
import {
  canDrop,
  dropCommand,
  kindOf,
  pasteTarget,
  payloadFrom,
  payloadFromSelection,
} from './dropRules';

/** Anlage mit zwei Clustern: A (Mieter, Flotte) und B (Gäste), B ist leer. Cluster C liegt in A. */
function setup(): {
  project: Project;
  ids: { a: string; c: string; mieter: string; flotte: string; lp01: string; lp03: string };
} {
  const base = sampleProject();
  const a = base.clusters[0]!.id;
  const project: Project = {
    ...base,
    clusters: [
      ...base.clusters,
      { id: 'cluster-b', name: 'UV-TG2', limitA: 63 },
      { id: 'cluster-c', name: 'Unterverteilung', limitA: 32, parentClusterId: a },
    ],
    groups: [
      ...base.groups,
      { id: 'group-gaeste', name: 'Gäste', clusterId: 'cluster-b', priority: 3 },
    ],
  };
  return {
    project,
    ids: {
      a,
      c: 'cluster-c',
      mieter: project.groups[0]!.id,
      flotte: project.groups[1]!.id,
      lp01: project.chargePoints[0]!.id,
      lp03: project.chargePoints[2]!.id,
    },
  };
}

describe('kindOf', () => {
  it('erkennt Art des Elements', () => {
    const { project, ids } = setup();
    expect(kindOf(project, SITE_LEVEL_ID)).toBe('site');
    expect(kindOf(project, ids.a)).toBe('cluster');
    expect(kindOf(project, ids.mieter)).toBe('group');
    expect(kindOf(project, ids.lp01)).toBe('chargePoint');
    expect(kindOf(project, 'gibt-es-nicht')).toBeUndefined();
  });
});

describe('canDrop – Drop-Validierung', () => {
  it('Ladepunkt nur in eine andere Gruppe', () => {
    const { project, ids } = setup();
    const payload = { kind: 'chargePoint', ids: [ids.lp01] } as const;
    expect(canDrop(project, payload, ids.flotte)).toEqual({ ok: true });
    expect(canDrop(project, payload, ids.mieter)).toMatchObject({
      ok: false,
      reason: 'Liegt bereits dort',
    });
    expect(canDrop(project, payload, ids.a)).toMatchObject({ ok: false });
    expect(canDrop(project, payload, SITE_LEVEL_ID)).toMatchObject({ ok: false });
    expect(canDrop(project, payload, 'unbekannt')).toMatchObject({ ok: false });
    expect(canDrop(project, { kind: 'chargePoint', ids: [] }, ids.flotte)).toMatchObject({
      ok: false,
    });
  });

  it('Gruppe nur in einen anderen Cluster', () => {
    const { project, ids } = setup();
    const payload = { kind: 'group', ids: [ids.mieter] } as const;
    expect(canDrop(project, payload, 'cluster-b').ok).toBe(true);
    expect(canDrop(project, payload, ids.a)).toMatchObject({ ok: false });
    expect(canDrop(project, payload, ids.flotte)).toMatchObject({ ok: false });
    expect(canDrop(project, payload, SITE_LEVEL_ID)).toMatchObject({ ok: false });
  });

  it('Cluster in Cluster oder zurück an den Netzanschluss, nie in sich selbst oder einen Nachfahren', () => {
    const { project, ids } = setup();
    expect(canDrop(project, { kind: 'cluster', ids: ['cluster-b'] }, ids.a).ok).toBe(true);
    expect(canDrop(project, { kind: 'cluster', ids: [ids.c] }, SITE_LEVEL_ID).ok).toBe(true);
    expect(canDrop(project, { kind: 'cluster', ids: [ids.a] }, ids.a)).toMatchObject({ ok: false });
    expect(canDrop(project, { kind: 'cluster', ids: [ids.a] }, ids.c)).toMatchObject({ ok: false });
    expect(canDrop(project, { kind: 'cluster', ids: [ids.a] }, SITE_LEVEL_ID)).toMatchObject({
      ok: false,
      reason: 'Liegt bereits dort',
    });
    expect(canDrop(project, { kind: 'cluster', ids: [ids.c] }, ids.mieter)).toMatchObject({
      ok: false,
    });
  });
});

describe('dropCommand', () => {
  it('verschiebt Ladepunkte, Gruppen und Cluster in einem Undo-Schritt', () => {
    const { project, ids } = setup();
    const cp = dropCommand(
      project,
      { kind: 'chargePoint', ids: [ids.lp01, ids.lp03] },
      ids.flotte,
    )!;
    expect(cp.label).toBe('2 Ladepunkte verschieben');
    const moved = runCommand(project, cp)!.project;
    expect(moved.chargePoints.filter((c) => c.groupId === ids.flotte)).toHaveLength(2);

    const g = dropCommand(project, { kind: 'group', ids: [ids.mieter] }, 'cluster-b')!;
    expect(runCommand(project, g)!.project.groups.find((x) => x.id === ids.mieter)?.clusterId).toBe(
      'cluster-b',
    );

    const c = dropCommand(project, { kind: 'cluster', ids: ['cluster-b'] }, ids.a)!;
    expect(
      runCommand(project, c)!.project.clusters.find((x) => x.id === 'cluster-b')?.parentClusterId,
    ).toBe(ids.a);
    const toSite = dropCommand(project, { kind: 'cluster', ids: [ids.c] }, SITE_LEVEL_ID)!;
    expect(
      runCommand(project, toSite)!.project.clusters.find((x) => x.id === ids.c)?.parentClusterId,
    ).toBeUndefined();
  });

  it('liefert null bei ungültigem Ziel', () => {
    const { project, ids } = setup();
    expect(dropCommand(project, { kind: 'cluster', ids: [ids.a] }, ids.c)).toBeNull();
    expect(dropCommand(project, { kind: 'group', ids: [ids.mieter] }, ids.lp01)).toBeNull();
  });

  it('beschriftet Mehrfachverschiebung', () => {
    const { project, ids } = setup();
    expect(
      dropCommand(project, { kind: 'chargePoint', ids: [ids.lp01, ids.lp03] }, ids.flotte)!.label,
    ).toBe('2 Ladepunkte verschieben');
    expect(
      dropCommand(project, { kind: 'group', ids: [ids.mieter, ids.flotte] }, 'cluster-b')!.label,
    ).toBe('2 Gruppen verschieben');
  });
});

describe('payloadFrom / payloadFromSelection', () => {
  it('nimmt die gleichartige Auswahl mit, wenn das angefasste Element dazugehört', () => {
    const { project, ids } = setup();
    expect(payloadFrom(project, ids.lp01, [ids.lp01, ids.lp03, ids.mieter])).toEqual({
      kind: 'chargePoint',
      ids: [ids.lp01, ids.lp03],
    });
    expect(payloadFrom(project, ids.lp01, [ids.lp03])).toEqual({
      kind: 'chargePoint',
      ids: [ids.lp01],
    });
    expect(payloadFrom(project, ids.a, [ids.a, 'cluster-b'])).toEqual({
      kind: 'cluster',
      ids: [ids.a],
    });
    expect(payloadFrom(project, SITE_LEVEL_ID, [])).toBeUndefined();
    expect(payloadFrom(project, 'x', [])).toBeUndefined();
  });

  it('Auswahl ohne bewegbare Elemente ergibt keine Nutzlast', () => {
    const { project, ids } = setup();
    expect(payloadFromSelection(project, [SITE_LEVEL_ID])).toBeUndefined();
    expect(payloadFromSelection(project, [])).toBeUndefined();
    expect(payloadFromSelection(project, [SITE_LEVEL_ID, ids.mieter])).toEqual({
      kind: 'group',
      ids: [ids.mieter],
    });
  });
});

describe('pasteTarget', () => {
  it('wählt das passende Ziel aus der Auswahl', () => {
    const { project, ids } = setup();
    expect(pasteTarget(project, 'chargePoint', ids.flotte)).toBe(ids.flotte);
    expect(pasteTarget(project, 'chargePoint', ids.lp03)).toBe(ids.flotte); // Ladepunkt → seine Gruppe
    expect(pasteTarget(project, 'chargePoint', ids.a)).toBeUndefined();
    expect(pasteTarget(project, 'group', ids.lp01)).toBe(ids.a);
    expect(pasteTarget(project, 'group', ids.mieter)).toBe(ids.a);
    expect(pasteTarget(project, 'cluster', ids.c)).toBe(ids.c);
    expect(pasteTarget(project, 'cluster', ids.a)).toBe(ids.a);
    expect(pasteTarget(project, 'cluster', SITE_LEVEL_ID)).toBe(SITE_LEVEL_ID);
    expect(pasteTarget(project, 'cluster', undefined)).toBe(SITE_LEVEL_ID);
    expect(pasteTarget(project, 'group', undefined)).toBeUndefined();
    expect(pasteTarget(project, 'group', SITE_LEVEL_ID)).toBeUndefined();
    expect(pasteTarget(project, 'group', 'unbekannt')).toBeUndefined();
  });
});
