import { SITE_LEVEL_ID, type Project } from '@lastplan/core';
import ELK, { type ElkNode } from 'elkjs/lib/elk.bundled.js';
import { buildTree, type ElementKind } from './tree';

/**
 * Automatisches Layout der Hierarchie mit elkjs (ADR 0011). Die Knotengrößen sind fest, damit
 * die Karten ohne Messen im DOM gezeichnet werden können; ELK ordnet verschachtelte Boxen
 * (Netzanschluss → Cluster → Gruppen → Ladepunkte) und liefert Positionen relativ zum Elternknoten,
 * so wie React Flow sie für Unterknoten erwartet.
 */

export const SIZES = {
  site: { width: 272, height: 92 },
  siteFlag: 40,
  chip: { width: 208, height: 44 },
  groupHeader: 68,
  groupFlag: 22,
  groupMin: { width: 232, height: 72 },
  clusterHeader: 116,
  clusterFlag: 48,
  clusterMin: { width: 296, height: 140 },
  gapChips: 8,
  gapBoxes: 16,
  gapRoot: 48,
} as const;

export interface LayoutFlags {
  /** Cluster/Gruppen, die eine Meldungszeile zeigen und daher einen höheren Kopf brauchen. */
  flagged: ReadonlySet<string>;
}

export interface LayoutNode {
  id: string;
  kind: ElementKind;
  parentId?: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutEdge {
  id: string;
  source: string;
  target: string;
}

export interface LayoutResult {
  key: string;
  nodes: LayoutNode[];
  edges: LayoutEdge[];
}

/** Schlüssel der Struktur: ändert sich nur, wenn ein neues Layout nötig ist (nicht bei Zahlenänderungen). */
export function layoutKey(project: Project, flags: LayoutFlags): string {
  const tree = buildTree(project);
  return tree.order
    .map((id) => {
      const item = tree.items.get(id);
      return `${id}>${item?.parentId ?? ''}${flags.flagged.has(id) ? '!' : ''}`;
    })
    .join('|');
}

const pad = (top: number, side: number) => `[top=${top},left=${side},bottom=${side},right=${side}]`;

const elk = new ELK();

export async function computeLayout(project: Project, flags: LayoutFlags): Promise<LayoutResult> {
  const tree = buildTree(project);

  const build = (id: string): ElkNode => {
    const item = tree.items.get(id);
    const flag = flags.flagged.has(id);
    if (!item || item.kind === 'chargePoint') return { id, ...SIZES.chip };
    if (item.kind === 'site')
      return {
        id,
        width: SIZES.site.width,
        height: SIZES.site.height + (flag ? SIZES.siteFlag : 0),
      };
    const isCluster = item.kind === 'cluster';
    const header = isCluster
      ? SIZES.clusterHeader + (flag ? SIZES.clusterFlag : 0)
      : SIZES.groupHeader + (flag ? SIZES.groupFlag : 0);
    const min = isCluster ? SIZES.clusterMin : SIZES.groupMin;
    return {
      id,
      children: item.childIds.map(build),
      layoutOptions: {
        'elk.algorithm': 'rectpacking',
        // Gruppen: Ladepunkte untereinander; Cluster: Gruppen nebeneinander, bei Bedarf in Zeilen
        'elk.aspectRatio': isCluster ? '1.8' : '0.05',
        'elk.padding': pad(header, isCluster ? SIZES.gapBoxes : 12),
        'elk.spacing.nodeNode': String(isCluster ? SIZES.gapBoxes : SIZES.gapChips),
        'elk.nodeSize.constraints': 'MINIMUM_SIZE',
        'elk.nodeSize.minimum': `(${min.width},${header + (isCluster ? 24 : 16)})`,
      },
    };
  };

  const site = tree.items.get(SITE_LEVEL_ID);
  const graph: ElkNode = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'DOWN',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      'elk.spacing.nodeNode': String(SIZES.gapBoxes * 2),
      'elk.layered.spacing.nodeNodeBetweenLayers': String(SIZES.gapRoot),
      'elk.padding': pad(16, 16),
    },
    children: [build(SITE_LEVEL_ID), ...(site?.childIds ?? []).map(build)],
    edges: (site?.childIds ?? []).map((target) => ({
      id: `site->${target}`,
      sources: [SITE_LEVEL_ID],
      targets: [target],
    })),
  };

  const laidOut = await elk.layout(graph);

  const nodes: LayoutNode[] = [];
  const walk = (node: ElkNode, parentId?: string) => {
    const item = tree.items.get(node.id);
    if (item) {
      nodes.push({
        id: node.id,
        kind: item.kind,
        ...(parentId !== undefined && parentId !== 'root' ? { parentId } : {}),
        x: node.x ?? 0,
        y: node.y ?? 0,
        width: node.width ?? SIZES.chip.width,
        height: node.height ?? SIZES.chip.height,
      });
    }
    for (const child of node.children ?? []) walk(child, node.id);
  };
  walk(laidOut);

  return {
    key: layoutKey(project, flags),
    nodes,
    edges: (site?.childIds ?? []).map((target) => ({
      id: `site->${target}`,
      source: SITE_LEVEL_ID,
      target,
    })),
  };
}
