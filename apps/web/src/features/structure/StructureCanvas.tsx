import { Button } from '@lastplan/ui';
import {
  Handle,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useEffect, useMemo, useRef, type KeyboardEvent } from 'react';
import { isEditableTarget } from '../../state/useShortcuts';
import { useEditorStore } from '../../state/editorStore';
import type { LayoutResult } from './layout';
import { ChipView, ClusterView, GroupView, SiteView } from './nodes';
import { navigate, type ElementKind, type NavKey, type Tree } from './tree';

/**
 * Arbeitsfläche mit React Flow: Zoom, Pan, „Alles einpassen“. React Flow übernimmt nur die
 * Darstellung (Transformation, Verbindungslinien). Auswahl, Fokus und Tastatur laufen über
 * eigene Buttons in den Knoten, die Tastaturbedienung von React Flow ist abgeschaltet (ADR 0011).
 */

const Hidden = () => (
  <Handle
    type="target"
    position={Position.Top}
    isConnectable={false}
    className="structure-handle"
    aria-hidden="true"
  />
);

const HiddenSource = () => (
  <Handle
    type="source"
    position={Position.Bottom}
    isConnectable={false}
    className="structure-handle"
    aria-hidden="true"
  />
);

const nodeTypes = {
  'lp-site': ({ id }: NodeProps) => (
    <>
      <SiteView id={id} />
      <HiddenSource />
    </>
  ),
  'lp-cluster': ({ id }: NodeProps) => (
    <>
      <Hidden />
      <ClusterView id={id} />
    </>
  ),
  'lp-group': ({ id }: NodeProps) => <GroupView id={id} />,
  'lp-chip': ({ id }: NodeProps) => <ChipView id={id} />,
};

// Eigene Typnamen: „group“ und „default“ sind in React Flow mit eigenem Aussehen belegt.
const KINDS: Record<ElementKind, keyof typeof nodeTypes> = {
  site: 'lp-site',
  cluster: 'lp-cluster',
  group: 'lp-group',
  chargePoint: 'lp-chip',
};

export function focusElement(id: string): void {
  for (const el of document.querySelectorAll<HTMLElement>('[data-structure-id]')) {
    if (el.dataset['structureId'] === id) {
      el.focus();
      return;
    }
  }
}

const FIT = { padding: 0.12, maxZoom: 1, duration: 0 } as const;

function Inner({ layout, tree }: { layout: LayoutResult; tree: Tree }) {
  const { fitView, zoomIn, zoomOut } = useReactFlow();
  const reveal = useEditorStore((s) => s.reveal);

  const nodes = useMemo<Node[]>(
    () =>
      layout.nodes
        .filter((n) => tree.items.has(n.id))
        .map((n) => ({
          id: n.id,
          type: KINDS[n.kind],
          position: { x: n.x, y: n.y },
          ...(n.parentId !== undefined && tree.items.has(n.parentId)
            ? { parentId: n.parentId }
            : {}),
          width: n.width,
          height: n.height,
          data: {},
          draggable: false,
          selectable: false,
          focusable: false,
          connectable: false,
          deletable: false,
          // React Flow setzt sonst pointer-events: none (Knoten ohne Auswahl/Ziehen/Klick-Handler)
          style: { pointerEvents: 'all' as const },
        })),
    [layout, tree],
  );
  const edges = useMemo<Edge[]>(
    () =>
      layout.edges
        .filter((e) => tree.items.has(e.target))
        .map((e) => ({
          ...e,
          type: 'smoothstep',
          focusable: false,
          selectable: false,
          deletable: false,
        })),
    [layout, tree],
  );

  // Sprung aus einer Prüfmeldung: auf den Knoten zoomen und Fokus setzen.
  const lastReveal = useRef(reveal?.nonce);
  useEffect(() => {
    if (!reveal || reveal.nonce === lastReveal.current) return;
    lastReveal.current = reveal.nonce;
    const id = reveal.ids.find((i) => tree.items.has(i));
    if (id === undefined) return;
    void fitView({ nodes: [{ id }], padding: 0.6, maxZoom: 1, duration: 0 });
    focusElement(id);
  }, [reveal, tree, fitView]);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (isEditableTarget(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    const current = (e.target as HTMLElement).closest<HTMLElement>('[data-structure-id]')?.dataset[
      'structureId'
    ];
    if (current === undefined) return;
    e.preventDefault();
    const next = navigate(tree, current, e.key as NavKey);
    if (next === undefined) return;
    useEditorStore.getState().select([next]);
    focusElement(next);
    void fitView({ nodes: [{ id: next }], padding: 1.5, maxZoom: 1, minZoom: 0, duration: 0 });
  }

  return (
    // Pfeiltasten werden hier gesammelt, die Knoten selbst sind echte Buttons.
    <div className="structure-canvas" onKeyDown={onKeyDown}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={FIT}
        minZoom={0.1}
        maxZoom={1.5}
        nodesDraggable={false}
        nodesConnectable={false}
        nodesFocusable={false}
        edgesFocusable={false}
        elementsSelectable={false}
        disableKeyboardA11y
        deleteKeyCode={null}
        selectionKeyCode={null}
        multiSelectionKeyCode={null}
        zoomActivationKeyCode="Control"
        panOnScroll
        panOnDrag={[0, 1, 2]}
        onPaneClick={() => useEditorStore.getState().clearSelection()}
        ariaLabelConfig={{
          'node.a11yDescription.default': 'Element der Anlagenstruktur',
          'node.a11yDescription.keyboardDisabled': 'Element der Anlagenstruktur',
          'edge.a11yDescription.default': 'Verbindung',
          'controls.ariaLabel': 'Ansicht steuern',
        }}
      >
        <Panel position="top-left" className="structure-zoom">
          <Button size="sm" onClick={() => void zoomIn({ duration: 0 })} aria-label="Vergrößern">
            +
          </Button>
          <Button size="sm" onClick={() => void zoomOut({ duration: 0 })} aria-label="Verkleinern">
            −
          </Button>
          <Button size="sm" onClick={() => void fitView(FIT)}>
            Alles einpassen
          </Button>
        </Panel>
      </ReactFlow>
    </div>
  );
}

export function StructureCanvas(props: { layout: LayoutResult; tree: Tree }) {
  return (
    <ReactFlowProvider>
      <Inner {...props} />
    </ReactFlowProvider>
  );
}
