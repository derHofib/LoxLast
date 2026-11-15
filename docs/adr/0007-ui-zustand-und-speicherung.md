# 0007 – Zustand, Undo/Redo und lokale Speicherung

**Status:** Angenommen · 2026-11-15

## Entscheidung

- **Undo/Redo über Immer-Patches.** Ein `Command` besteht aus Beschriftung und Immer-Rezept; `produceWithPatches` liefert Änderung und Umkehrung. Einzelne Befehle brauchen keine eigene Umkehrlogik. `batch()` fasst mehrere Befehle zu einem Undo-Schritt zusammen (Massenbearbeitung). Befehle ohne Änderung erzeugen keinen Eintrag. Historie max. 200 Schritte, nur im Speicher (nicht persistiert).
- **Zustand-Store** hält das geöffnete Projekt, Historie und `dirty`.
- **Dexie/IndexedDB**: Tabelle `projects` (`id, name, updatedAt`), Zeile = Rohdokument. Gelesen wird immer über `loadProject` (Migration + Formprüfung); beschädigte Projekte erzeugen eine lesbare Fehlermeldung statt eines Absturzes.
- **Autosave** entprellt (600 ms), meldet Status in die Kopfzeile, speichert beim Verlassen nach.
- **HashRouter**, damit die statische Auslieferung ohne Serverregeln funktioniert (ADR 0002).
- **JSON-Import** vergibt eine neue Projekt-ID, damit nichts Vorhandenes überschrieben wird.
- Komponenten in `packages/ui` sind reine Präsentationskomponenten (React als Peer-Dependency), keine Kenntnis von core.

## Folgen

Texteingaben committen beim Verlassen des Feldes (ein Undo-Schritt pro Änderung, nicht pro Tastendruck). Playwright/E2E (AP 3.7) und axe-Prüfung (AP 3.8) sind noch offen.
