import { SITE_LEVEL_ID, type Project } from '@lastplan/core';

/**
 * Baumstruktur der Anlage für Anzeige, Pfeiltasten-Navigation und Auswahlregeln.
 * Reine Funktionen ohne React. Verwaiste Elemente (fehlende Eltern) erscheinen nicht im Baum;
 * sie meldet die Prüfung als Strukturfehler.
 */

export type ElementKind = 'site' | 'cluster' | 'group' | 'chargePoint';

export interface TreeItem {
  id: string;
  kind: ElementKind;
  parentId?: string;
  childIds: string[];
}

export interface Tree {
  items: Map<string, TreeItem>;
  /** Tiefensuche: Netzanschluss, Cluster, dessen Gruppen mit Ladepunkten, dann Unter-Cluster. */
  order: string[];
}

export function buildTree(project: Project): Tree {
  const items = new Map<string, TreeItem>();
  const order: string[] = [];
  const clusterIds = new Set(project.clusters.map((c) => c.id));

  const add = (item: TreeItem) => {
    items.set(item.id, item);
    order.push(item.id);
  };

  const visit = (clusterId: string, seen: Set<string>) => {
    if (seen.has(clusterId)) return;
    seen.add(clusterId);
    const cluster = items.get(clusterId);
    if (!cluster) return;
    for (const group of project.groups.filter((g) => g.clusterId === clusterId)) {
      cluster.childIds.push(group.id);
      const groupItem: TreeItem = {
        id: group.id,
        kind: 'group',
        parentId: clusterId,
        childIds: [],
      };
      add(groupItem);
      for (const cp of project.chargePoints.filter((c) => c.groupId === group.id)) {
        groupItem.childIds.push(cp.id);
        add({ id: cp.id, kind: 'chargePoint', parentId: group.id, childIds: [] });
      }
    }
    for (const sub of project.clusters.filter((c) => c.parentClusterId === clusterId)) {
      cluster.childIds.push(sub.id);
      add({ id: sub.id, kind: 'cluster', parentId: clusterId, childIds: [] });
      visit(sub.id, seen);
    }
  };

  const site: TreeItem = { id: SITE_LEVEL_ID, kind: 'site', childIds: [] };
  add(site);
  const seen = new Set<string>();
  const tops = project.clusters.filter(
    (c) => c.parentClusterId === undefined || !clusterIds.has(c.parentClusterId),
  );
  for (const top of tops) {
    site.childIds.push(top.id);
    add({ id: top.id, kind: 'cluster', parentId: SITE_LEVEL_ID, childIds: [] });
    visit(top.id, seen);
  }
  return { items, order };
}

export type NavKey = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' | 'Home' | 'End';

/** Nächstes Element bei einer Pfeiltaste im Baum (Auf/Ab: Reihenfolge, Links: Eltern, Rechts: erstes Kind). */
export function navigate(
  tree: Tree,
  currentId: string | undefined,
  key: NavKey,
): string | undefined {
  const first = tree.order[0];
  if (key === 'Home') return first;
  if (key === 'End') return tree.order.at(-1);
  if (currentId === undefined || !tree.items.has(currentId)) return first;
  const index = tree.order.indexOf(currentId);
  const item = tree.items.get(currentId);
  switch (key) {
    case 'ArrowDown':
      return tree.order[Math.min(index + 1, tree.order.length - 1)];
    case 'ArrowUp':
      return tree.order[Math.max(index - 1, 0)];
    case 'ArrowLeft':
      return item?.parentId ?? currentId;
    case 'ArrowRight':
      return item?.childIds[0] ?? currentId;
  }
}
