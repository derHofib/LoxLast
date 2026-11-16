# 0011 – Struktur-Ansicht: React Flow und elkjs, Knoten bleiben Buttons

**Status:** Angenommen · 2026-11-16

## Entscheidung

- **Darstellung mit React Flow (`@xyflow/react`), Layout mit elkjs.** React Flow liefert Zoom, Pan, „Alles einpassen“ und die Verbindungslinien. elkjs (`elk.bundled.js`, läuft ohne Web Worker, nichts wird nachgeladen) berechnet verschachtelte Boxen: Netzanschluss → Cluster (auch verschachtelt) → Gruppen → Ladepunkte. Positionen kommen relativ zum Elternknoten zurück, so wie React Flow sie für Unterknoten (`parentId`) erwartet. Die Knotengrößen sind fest (Kartenkopf plus Meldungszeile), damit nichts im DOM gemessen werden muss; ein neues Layout wird nur bei Strukturänderungen berechnet, nicht bei Zahlenänderungen.
- **Die Tastaturbedienung von React Flow ist abgeschaltet** (`disableKeyboardA11y`, `nodesFocusable={false}`, keine Löschtaste, keine Mehrfachauswahl-Taste, Knoten nicht ziehbar). Stattdessen ist jeder Knoten ein echter `<button>` aus `@lastplan/ui` (Cluster und Gruppe: Button über die ganze Karte, Ladepunkt: der Chip):
  - Auswahl über Klick, Enter und Leertaste mit dem Standardverhalten des Buttons; `aria-pressed` zeigt den Zustand.
  - Pfeiltasten bewegen die Auswahl im Baum (Auf/Ab: Reihenfolge, Links: Eltern, Rechts: erstes Kind, Pos1/Ende); nur das ausgewählte Element ist per Tab erreichbar (Roving Tabindex), sonst wären es bei 200 Ladepunkten 200 Tab-Stopps.
  - React Flows eigene Pfeiltasten würden Knoten verschieben und kennen weder unsere Hierarchie noch Undo/Redo.
- **Drag & Drop mit nativem HTML5-DnD**, nicht mit dem Knotenziehen von React Flow. Knoten tragen `nopan nodrag`, damit React Flow die Mausereignisse nicht für Pan oder Ziehen verbraucht. Das Verschieben in der Hierarchie ist keine freie Positionierung, sondern eine Änderung am Modell (`moveChargePoints`/`moveGroups`/`moveCluster`) mit Undo. Gültigkeit prüft die reine Funktion `canDrop` (Cluster nicht in sich selbst oder Nachfahren, Ladepunkt nur in Gruppen usw.). Tastatur-Alternative: Strg+X und Strg+V (Zwischenablage im `editorStore`).
- **Verschieben der Ansicht** per Mausrad/Trackpad (`panOnScroll`), Strg+Mausrad zoomt, Knöpfe „+“, „−“ und „Alles einpassen“ in der Arbeitsfläche; Ziehen mit der Maus auf Hintergrund verschiebt ebenfalls. Auf den Karten selbst gilt Ziehen dem Drag & Drop.
- React Flows Namensfeld „Attribution“ (Link „React Flow“ unten rechts) bleibt sichtbar; die Bibliothek ist MIT-lizenziert, die Kennzeichnung ist erwünscht, nicht verlangt.

## Folgen

- React Flow rendert Knoten im jsdom-Test nur mit Browser-Attrappen (`ResizeObserver`, `DOMMatrixReadOnly`); sie liegen in `apps/web/src/features/structure/testing.tsx`.
- Eigene Knoten-Typnamen (`lp-*`), weil `group` und `default` in React Flow mit eigenem Aussehen belegt sind.
- Knoten setzen `pointer-events: all` selbst, weil React Flow sie sonst für Knoten ohne eigene Klick-Handler abschaltet.
- Bei 200 Ladepunkten dauert Layout plus Aufbau in jsdom rund 0,5 s, ein Auswahlwechsel rund 10 ms (Test `perf.test.tsx`).
