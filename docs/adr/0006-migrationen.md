# 0006 – Migrationen des Projektformats

**Status:** Angenommen · 2026-11-15

## Entscheidung

- Jedes gespeicherte Projekt trägt `schemaVersion` (aktuell **1**, `CURRENT_SCHEMA_VERSION`).
- Migrationen sind reine Funktionen `n → n+1` im Register `MIGRATIONS` (`packages/core/src/migrations/migrate.ts`). `migrateDocument` wendet sie lückenlos nacheinander an und verändert das Eingabedokument nicht.
- Klare deutsche Fehlermeldungen: keine/ungültige Version, Projekt aus neuerer LastPlan-Version („Bitte LastPlan aktualisieren“), fehlende Migration.
- `loadProject` = migrieren + Formprüfung; liefert `migratedFrom`, damit die UI auf eine Aktualisierung hinweisen kann.

## Vorgehen bei Formatänderung

1. `CURRENT_SCHEMA_VERSION` erhöhen.
2. Migration in `MIGRATIONS` eintragen.
3. Test mit einem echten Dokument der alten Version ergänzen.
