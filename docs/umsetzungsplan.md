# Umsetzungsplan LastPlan

Stand: 2026-11-15 · Grundlage: Spezifikation (Entwicklungs-Prompt, Kap. 0–16) · Meilenstein 1 abgeschlossen (PR #1)

Dieser Plan zerlegt die Meilensteine 2–10 in Arbeitspakete (AP), nennt Abhängigkeiten, Abnahmekriterien und die Unterlagen, die der Auftraggeber jeweils liefern muss. Er wird bei jedem Meilenstein fortgeschrieben.

## Überblick

| MS  | Inhalt                                                                    | Hängt ab von          | Liefert der Auftraggeber vorher                               | Umfang   |
| --- | ------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------- | -------- |
| 1   | Grundgerüst                                                               | –                     | –                                                             | erledigt |
| 2   | Kernlogik: Berechnung, Prüfregeln, Simulation, Schieflast-Optimierung     | 1                     | –                                                             | M        |
| 3   | UI-Basis: Komponenten, App-Rahmen, Projektübersicht, IndexedDB, Undo/Redo | 1 (2 für Prüfanzeige) | –                                                             | L        |
| 4   | Struktur-Ansicht (Cluster-Editor)                                         | 2, 3                  | –                                                             | L        |
| 5   | Ladepunkte-Ansicht + Wallbox-Bibliothek                                   | 2, 3                  | **Modbus-Doku ABL eM4**, Liste häufigster Modelle             | L        |
| 6   | Export Modus A (Vorlagen)                                                 | 5                     | **aus Loxone Config exportierte Modbus-Vorlage**              | M        |
| 7   | `.Loxone`-Analyse, danach Export Modus B                                  | 6                     | **2–3 `.Loxone`-Dateien mit Lastmanagement + Config-Version** | L        |
| 8   | Gateway                                                                   | 1 (5 für Geräte-Test) | **Zugang zu einem Test-Miniserver**, erreichbare Test-Wallbox | L        |
| 9   | Live-Ansicht                                                              | 7, 8                  | Test-Miniserver mit eingespieltem Export aus MS 7             | M        |
| 10  | Feinschliff: Dark Mode, Performance, Barrierefreiheit, Doku               | alle                  | Abnahme-Feedback                                              | M        |

Umfang: S = klein, M = mittel, L = groß (relativ, keine Zeitzusage).

**Kritischer Pfad:** 2 → 3 → 5 → 6 → 7 → 9. Die Lieferungen des Auftraggebers liegen alle auf diesem Pfad. Am meisten Zeit spart es, sie **jetzt** zu sammeln, auch wenn sie erst ab MS 5 gebraucht werden.

**Parallelisierbar:** MS 4 und 5 (nach 3), MS 8 (ab MS 2 jederzeit; nur der Wallbox-Verbindungstest braucht MS 5).

---

## Meilenstein 2 – Kernlogik (ohne UI)

Ziel: vollständige, getestete Fachlogik in `packages/core`. Danach rechnet und prüft das System korrekt, auch wenn noch nichts zu sehen ist.

| AP   | Inhalt                                                                                                                                                                                                                                                                                  | Kap. |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| 2.1  | Einheiten-Helfer: `kwFromA`, `aFromKw`, deutsches Zahlenformat (Komma, 1 Nachkommastelle, Einheit immer sichtbar)                                                                                                                                                                       | 4.6  |
| 2.2  | Hierarchie-Hilfen: Cluster-Baum, Ladepunkte je Ebene (auch verschachtelte Cluster)                                                                                                                                                                                                      | 3    |
| 2.3  | Verfügbares Limit je Ebene (Standort → Cluster → Gruppe), Phasen-Limits je Cluster                                                                                                                                                                                                      | 4.1  |
| 2.4  | Phasenzuordnung über Phasenrotation, 1-phasige Anschlüsse                                                                                                                                                                                                                               | 4.2  |
| 2.5  | Worst-Case-Phasenlast (Szenario A/B) und Schieflast je Ebene                                                                                                                                                                                                                            | 4.3  |
| 2.6  | Mindeststrom-Prüfung je Ebene und Phase                                                                                                                                                                                                                                                 | 4.4  |
| 2.7  | Prüfregel-Rahmen (`Rule`, `Finding`, `fix` als Command-Beschreibung) und die 10 Regeln aus Kap. 5 (MIN_SUM, PHASE_OVERLOAD, UNBALANCE, DUP_IP, CP_NO_GROUP, CP_MIN_MAX, MODEL_INCOMPLETE, PHASE_SWITCH_UNSUPPORTED, EMPTY_GROUP, METER_MISSING), aufbauend auf den Invarianten aus MS 1 | 5    |
| 2.8  | Schieflast-Auto-Fix: Greedy-Verteilung der Phasenrotationen, Ergebnis als Vorschlag                                                                                                                                                                                                     | 5    |
| 2.9  | Simulation `simulateAllocation` (Mindeststrom, Pausieren nach Priorität, Restverteilung, begrenzende Ebene)                                                                                                                                                                             | 4.5  |
| 2.10 | `structureHash` (strukturrelevante Felder laut Kap. 9) – wird von Export und Live gebraucht                                                                                                                                                                                             | 9    |
| 2.11 | Tests: Beispiel-Tests mit nachgerechneten Anlagen, Property-based Tests (fast-check) für Berechnung, Simulation und Optimierung, Performance-Test: Prüfung < 50 ms bei 200 Ladepunkten                                                                                                  | 13   |

Offene Fachfragen (werden zu Beginn von MS 2 gestellt, sonst als ADR angenommen):

- 4.1 „Anteil, den die Elternebene maximal liefern kann“: einfaches `min(eigenes Limit, Eltern-Limit)` oder Abzug der Mindestströme der Geschwister-Cluster?
- 4.3: Wird die Gebäudereserve je Phase gleich verteilt angenommen?
- MODEL_INCOMPLETE braucht die Bibliothek (MS 5): bis dahin über eine Schnittstelle `ModelCatalog` abstrahiert und mit Testdaten geprüft.

**Abnahme:** alle Regeln mit Beispiel-Meldungen aus Kap. 5, Abdeckung ≥ 90 %, Performance-Test grün.

## Meilenstein 3 – UI-Basis

| AP  | Inhalt                                                                                                                                                                                                                  | Kap.      |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 3.1 | Komponenten in `packages/ui`: Button, Eingabe/Select/Zahlenfeld mit Einheit und „Geändert“-Zustand, Such-/Filterfeld, Karte, KPI-Kachel, Fortschrittsbalken, Status-Anzeige, Meldung, Banner, Tabs, Eigenschaftsbereich | 10.2      |
| 3.2 | Beispielseite je Komponente (eigene Route `/komponenten`, kein Storybook nötig)                                                                                                                                         | 10.2      |
| 3.3 | App-Rahmen: Kopfzeile mit Produktzeichen, Tabs Struktur · Ladepunkte · Export · Live, Routing                                                                                                                           | 11        |
| 3.4 | State: Zustand + Immer, Command-Pattern für Undo/Redo (inkl. Sammelbefehle für Massenbearbeitung), Tastaturkürzel-Rahmen                                                                                                | 2.3, 10.3 |
| 3.5 | Speicherung: IndexedDB über Dexie, Autosave, Laden über `loadProject` (Migrationen)                                                                                                                                     | 2.3       |
| 3.6 | Projektübersicht: Liste mit Suche, „Neues Projekt“, JSON-Import/-Export, leere Zustände                                                                                                                                 | 11        |
| 3.7 | Playwright einrichten, E2E: Projekt anlegen, Undo/Redo                                                                                                                                                                  | 13        |
| 3.8 | Barrierefreiheit von Anfang an: echte Buttons/Labels, Fokusring, 44-px-Klickflächen, axe-Prüfung in E2E                                                                                                                 | 10.3      |

**Abnahme:** Projekt anlegen, umbenennen, speichern, nach Neuladen wieder öffnen, exportieren/importieren; Undo/Redo per Tastatur.

## Meilenstein 4 – Struktur-Ansicht

| AP  | Inhalt                                                                                                                                    | Kap. |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| 4.1 | Hierarchie-Darstellung (Netzanschluss, Cluster, Gruppen, Ladepunkt-Chips) mit React Flow + elkjs-Auto-Layout, Zoom/Pan, „Alles einpassen“ | 11.1 |
| 4.2 | Anlegen/Bearbeiten/Löschen von Clustern, Gruppen, Ladepunkten; Eigenschafts-Panel rechts                                                  | 11.1 |
| 4.3 | Drag & Drop (Ladepunkt → Gruppe, Gruppe → Cluster), ungültige Ziele gesperrt, Tastatur-Alternative Ausschneiden/Einfügen                  | 10.3 |
| 4.4 | Seitenleiste: Phasenlast (Worst Case) mit Schieflast, Prüfmeldungen mit Sprung zum Element, Auto-Fix mit Vorschau                         | 11.1 |
| 4.5 | Simulation „N Fahrzeuge laden“ in der Seitenleiste                                                                                        | 4.5  |
| 4.6 | Performance mit 200 Ladepunkten (< 16 ms je Frame beim Ziehen)                                                                            | 13   |

**Abnahme:** E2E: Anlage aufbauen, Fehler erzeugen, per Meldung hinspringen und beheben.

## Meilenstein 5 – Ladepunkte-Ansicht + Wallbox-Bibliothek

**Vorher vom Auftraggeber:** Modbus-Dokumentation ABL eM4 (Herstellerdokument mit Version), Liste der häufigsten Modelle.

| AP  | Inhalt                                                                                                                              | Kap. |
| --- | ----------------------------------------------------------------------------------------------------------------------------------- | ---- |
| 5.1 | JSON-Schema für Modelldateien, Loader und Validator; CI bricht bei ungültigen Dateien ab                                            | 6    |
| 5.2 | ABL eM4 als erstes Modell – **nur** Werte aus der gelieferten Doku, jede mit Quelle; Fehlendes bleibt `TODO` und sperrt den Export  | 6    |
| 5.3 | Veröffentlichung der Bibliothek als Paket (CI, z. B. GitHub Pages) und Nachladen in der App mit Schema-Prüfung (ADR 0002)           | 6    |
| 5.4 | Ladepunkte-Ansicht: Liste, Formular (Häufig benötigt / Erweitert), Standardwerte aus Modell, Vorschlag nächste freie IP             | 11.2 |
| 5.5 | Mehrfachauswahl und Massenbearbeitung („verschieden“-Anzeige)                                                                       | 11.2 |
| 5.6 | CSV-Import: Vorlage, Spalten-Mapping, Vorschau mit Zeilenprüfung                                                                    | 11.2 |
| 5.7 | Infos-Spalte „Aus der Bibliothek“ (unvollständige Werte markiert); „Verbindung testen“ zunächst deaktiviert mit Hinweis auf Gateway | 11.2 |

**Abnahme:** E2E: CSV-Import; Modell ohne vollständige Register wird als „unvollständig“ angezeigt und blockiert den Export.

## Meilenstein 6 – Export Modus A (Vorlagen)

**Vorher vom Auftraggeber:** mindestens eine aus Loxone Config exportierte Modbus-Vorlage (am besten für die ABL eM4), dazu die Config-Version.

| AP  | Inhalt                                                                                                                                                | Kap.     |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 6.1 | Analyse der Beispielvorlage, Ergebnis in `docs/loxone-file-analysis/vorlagen.md`, ADR zur XML-Erzeugung                                               | 7.1      |
| 6.2 | Generator in `packages/loxone-export`, Golden-File-Test gegen die echte Vorlage                                                                       | 7.1, 7.3 |
| 6.3 | ZIP mit Ordnerstruktur und `LIESMICH.txt` (Importschritte)                                                                                            | 7.1      |
| 6.4 | Export-Ansicht: Exportziel, „Wird erzeugt“-Zusammenfassung, Sperre bei offenen Fehlern mit Blocker-Liste, Logik-Vorschau mit Funktionsbaustein-Karten | 11.3     |
| 6.5 | `ExportRecord` mit `structureHash` speichern                                                                                                          | 7.2      |

**Abnahme:** Auftraggeber importiert die erzeugte Vorlage in Loxone Config (Checkliste in `docs/`). E2E: Projekt → Fehler beheben → Export Modus A.

## Meilenstein 7 – `.Loxone`-Analyse und Export Modus B

**Vorher vom Auftraggeber:** 2–3 `.Loxone`-Dateien mit bestehendem Lastmanagement (2–3 Wallboxen), verwendete Config-Version. Ideal: dieselbe Anlage einmal ohne und einmal mit Lastmanagement.

| AP  | Inhalt                                                                                                                                                                                                            | Kap.      |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 7.1 | Dateianalyse (Format, Kompression, Encoding, Seiten, Bausteine, Verbindungen, Räume, Kategorien, UUIDs, Versionskennung) → `docs/loxone-file-analysis/`                                                           | 7.2       |
| 7.2 | ADR: XML-Verarbeitung (DOMParser vs. fast-xml-parser) mit Nachweis, dass Reihenfolge und Bytes erhalten bleiben                                                                                                   | 2.3       |
| 7.3 | Roundtrip-Test: einlesen und unverändert schreiben → byte-gleich                                                                                                                                                  | 7.3       |
| 7.4 | Versionserkennung; nicht unterstützte Version blockiert den Export                                                                                                                                                | 7.2       |
| 7.5 | Erzeugung der LastPlan-Seite (Lastmanager, Gruppen-Limits, Wallbox-Bausteine, Modbus-Geräte, virtuelle Eingänge für alle Stellgrößen), Kennung `lastplan:<projectId>:<structureHash>`, Ersetzen statt Duplizieren | 7.2       |
| 7.6 | Auto-Layout der Bausteine auf der Seite                                                                                                                                                                           | 7.2       |
| 7.7 | Diff-Ansicht neu/ersetzt/unverändert, Download `<name>_lastplan_<datum>.Loxone`                                                                                                                                   | 7.2, 11.3 |
| 7.8 | Golden-File-Tests je unterstützter Config-Version in `fixtures/loxone/<version>/`                                                                                                                                 | 7.3       |

**Abnahme:** Auftraggeber öffnet das Ergebnis in Loxone Config und bestätigt per Checkliste. Risiko: Ist das Format nicht zuverlässig beherrschbar, bleibt Modus B gesperrt und Modus A ist der Weg.

## Meilenstein 8 – Gateway

**Vorher vom Auftraggeber:** Zugang zu einem **Test-Miniserver** (nie eine Kundenanlage), eine im Netz erreichbare Test-Wallbox, Angabe zur Netzanbindung (lokal im Anlagennetz oder VPS + VPN).

| AP  | Inhalt                                                                                                                        | Kap.     |
| --- | ----------------------------------------------------------------------------------------------------------------------------- | -------- |
| 8.1 | Recherche und ADR: LxCommunicator vs. eigene Implementierung nach offizieller Loxone-Doku „Communicating with the Miniserver“ | 2.3      |
| 8.2 | Protokoll-Schemas in `packages/protocol` (REST + WebSocket)                                                                   | 8.2, 8.3 |
| 8.3 | Pairing (Einmalcode → kurzlebiges Token, erneuerbar), Rate-Limiting, CORS nur eigene Origin                                   | 12       |
| 8.4 | Credential-Store: SQLite, AES-256-GCM, Schlüssel aus `.env`; Änderungsprotokoll                                               | 8.1, 12  |
| 8.5 | Geräte-Verbindungstest (Modbus TCP/HTTP) mit Registern aus der Bibliothek; Polling, Timeouts, Backoff                         | 8.4      |
| 8.6 | Miniserver-Client: Verbindung, Status, Werte lesen, virtuelle Eingänge setzen mit Rücklesen                                   | 8.1, 8.4 |
| 8.7 | Docker-Image, `docker compose`, Profile `local` und `server`                                                                  | 8.5      |
| 8.8 | Tests: Modbus- und Miniserver-Simulatoren für automatisierte Tests, Integrationstest nur gegen den Test-Miniserver            | 13       |

**Abnahme:** „Verbindung testen“ in der Ladepunkte-Ansicht liefert echte Werte der Test-Wallbox; Gateway verbindet sich mit dem Test-Miniserver.

## Meilenstein 9 – Live-Ansicht

**Vorher:** Test-Miniserver mit dem eingespielten Export aus MS 7 (virtuelle Eingänge vorhanden).

| AP  | Inhalt                                                                                                                 | Kap. |
| --- | ---------------------------------------------------------------------------------------------------------------------- | ---- |
| 9.1 | Verbindungs-Pill, Offline-/Getrennt-Zustand mit Zeit der letzten Werte, leerer Zustand mit Gateway-Anleitung           | 11.4 |
| 9.2 | KPI-Reihe und Ladepunkt-Tabelle (sortier-/filterbar, Störungen markiert) über WebSocket                                | 11.4 |
| 9.3 | Parameter live ändern: Vorschau mit Prüfregeln, kritische Änderungen mit expliziter Bestätigung, Schreiben + Rücklesen | 9    |
| 9.4 | Änderungsprotokoll mit „Rückgängig“                                                                                    | 9    |
| 9.5 | Strukturänderungs-Banner (`structureHash`) mit „Export erzeugen“                                                       | 9    |

**Abnahme:** am Test-Miniserver ein Limit ändern, Bestätigung sehen, rückgängig machen; Strukturänderung wird erkannt.

## Meilenstein 10 – Feinschliff

| AP   | Inhalt                                                                                               |
| ---- | ---------------------------------------------------------------------------------------------------- |
| 10.1 | Dark Mode (zweites Token-Set ist vorbereitet)                                                        |
| 10.2 | Performance-Messung und Optimierung mit 200 Ladepunkten                                              |
| 10.3 | Barrierefreiheits-Audit WCAG 2.2 AA (Tastatur, Screenreader, Kontraste)                              |
| 10.4 | README und Anwender-Doku vervollständigen, Erweiterung der Wallbox-Bibliothek beschreiben            |
| 10.5 | Abhängigkeiten aktualisieren (u. a. TypeScript 7, sobald typescript-eslint es unterstützt; ADR 0001) |

---

## Was der Auftraggeber wann liefern muss (Kap. 15)

| Unterlage                                                     | Spätestens vor | Wofür                                               |
| ------------------------------------------------------------- | -------------- | --------------------------------------------------- |
| Modbus-Dokumentation ABL eM4 + Liste der häufigsten Modelle   | MS 5           | Register der Bibliothek (nichts aus dem Gedächtnis) |
| Aus Loxone Config exportierte Modbus-Vorlage + Config-Version | MS 6           | Struktur der Vorlagen                               |
| 2–3 `.Loxone`-Dateien mit Lastmanagement + Config-Version     | MS 7           | Dateianalyse, Golden Files                          |
| Zugang Test-Miniserver + Test-Wallbox im Netz                 | MS 8           | Gateway- und Live-Tests                             |

Dateien bitte in den Projekt-Chat hochladen oder im Repo unter `fixtures/` bzw. `docs/wallbox-sources/` ablegen. Kundendaten in `.Loxone`-Dateien (Namen, Adressen, Passwörter) vorher entfernen oder Bescheid geben, dann werden die Dateien nicht ins öffentliche Repo eingecheckt.

## Arbeitsweise je Meilenstein

1. Kurze Rückfragen (höchstens fünf), sonst Annahmen als ADR.
2. Umsetzung auf eigenem Branch, ein Pull Request je Meilenstein (bei MS 7 ggf. zwei: Analyse, dann Modus B).
3. Abschluss: CI grün, Zusammenfassung, offene Fragen. Weiter erst nach Freigabe.

## Risiken

- **Loxone-Projektdatei (MS 7):** Format ist nicht öffentlich dokumentiert. Gegenmaßnahme: nur auf Basis echter Dateien, Roundtrip-Test, Versionssperre, Modus A als Rückfallebene.
- **Unvollständige Herstellerdoku:** Modelle bleiben „unvollständig“ und für den Export gesperrt, statt geraten zu werden.
- **Öffentliches Repo:** Testdateien mit Kundendaten dürfen nicht eingecheckt werden (siehe oben).
- **Miniserver-Anbindung:** Nur offizielle Schnittstelle; falls LxCommunicator nicht passt, eigene Implementierung nach Loxone-Doku (ADR in MS 8).
