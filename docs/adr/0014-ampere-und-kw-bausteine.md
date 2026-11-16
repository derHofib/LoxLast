# 0014 – Ampere in LastPlan, kW in den Config-Bausteinen

**Status:** Vorgeschlagen · 2026-11-16

## Kontext

LastPlan rechnet mit Strom je Phase in A (Spezifikation: Ströme in A, Leistung in kW, Spannung Standard 230 V). Die Erkundung (Plan 6.3) vom 2026-11-16 an der Config des Auftraggebers (LOXONE Config MCP 1.0.1) zeigt, dass die passenden Config-Bausteine durchweg in **kW** arbeiten. Die Angaben stammen aus `get_block_types` und `get_doc`:

| Bausteintyp (Schlüssel) | Anzeige         | Relevante Anschlüsse laut Doku                                                                                                                                    |
| ----------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Wallbox`               | Wallbox         | Eingang Ls: Leistungslimit vom Lastmanager in kW; Ausgang Tp: Zielleistung in kW; Max/Min Ladeleistung in kW                                                      |
| `LoadShed`              | Lastmanager     | Parameter MaxP, MaxTp in kW; Eingang Gpwr (Netzleistung) in kW; analoge Lasten L1–12 geben die erlaubte Leistung in kW aus; Ausgang Ap: verfügbare Leistung in kW |
| `WBEM`                  | Wallbox Manager | Eingänge Pmax, Peco, Off; Ausgänge Cp, Ap. Doku noch nicht abgerufen                                                                                              |

Die Spezifikation (7.2, Schritt 3) verlangt: einen Lastmanager für den Standort, je Cluster einen Lastmanager mit Limit aus dem Ausgang der Elternebene, je Ladepunkt einen Wallbox-Baustein mit Modbus-Gerät und alle Stellgrößen als virtuelle Eingänge.

## Entscheidung (Vorschlag)

1. **LastPlan bleibt intern bei A.** Umgerechnet wird nur bei der Übergabe an Config, mit den vorhandenen Funktionen `kwFromA` und `aFromKw` aus `@lastplan/core` sowie der Projektspannung und der Phasenzahl des jeweiligen Ladepunkts bzw. Clusters.
2. **Rundung zur sicheren Seite.** Obergrenzen (Limits, Max-Ladeleistung) werden auf 0,01 kW **abgerundet**, Mindestwerte **aufgerundet**. Damit liegt das Limit in Config nie über dem in LastPlan geprüften Wert.
3. **Virtuelle Eingänge in kW, Name mit Einheit.** Damit die Live-Steuerung (Kap. 8) dieselben Werte setzt, tragen die virtuellen Eingänge die kW-Werte. Ihr Name nennt die Einheit und den A-Wert, aus dem sie entstanden sind (z. B. „Limit Cluster Halle (kW) – 32 A“).
4. **Hierarchie:** Standort und jeder Cluster werden je ein Lastmanager (`LoadShed`) im Modus Überlastschutz. Ein Cluster belegt beim Eltern-Lastmanager eine analoge Last; deren Ausgang L*n* liefert das Limit des Kind-Clusters in kW. Jede Wallbox hängt mit ihrem Eingang Ls an einer analogen Last ihres Clusters.
5. **Sollwert zur Wallbox-Hardware:** Der Ausgang Tp (kW) muss für Wallboxen, die per Modbus einen Strom in A erwarten, umgerechnet werden. Wie das in Config geschieht, ist offen (siehe unten). Bis dahin erzeugt LastPlan diese Verbindung nicht, sondern blockiert die Übergabe mit `TODO(verify)`.

## Offen, vor der Umsetzung (6.4) zu klären

- `TODO(verify)`: Kann MaxP des Kind-Lastmanagers aus einem Ausgang gespeist werden, oder ist MaxP nur ein Parameter? Davon hängt Punkt 4 ab. Prüfung über einen platzierten `LoadShed` (Anschlüsse aus `get_block`).
- `TODO(verify)`: Ob der Wallbox Manager (`WBEM`) für Cluster aus reinen Wallboxen besser passt als `LoadShed`. Dazu fehlt seine Doku, die die verbesserte Erkundung jetzt zuerst abruft.
- `TODO(verify)`: Baustein für die Umrechnung kW → A zum Modbus-Aktor (Punkt 5). Erst nach Doku, keine Annahme.
- Die Lasttabelle des Lastmanagers (Typ analog/digital, Priorität, Mindestleistung) liegt hinter dem Baustein-Dialog. Die Erkundung liest sie jetzt mit `get_block_data`, damit 6.4 ihr Format kennt.

## Folgen

- Die Berechnung und Prüfung (ADR 0007) bleibt unverändert.
- Die Vorschau der Übergabe (6.5) zeigt A und kW nebeneinander, damit Abweichungen durch Rundung sichtbar sind.
- Ladepunkte rechnen mit ihrer eigenen Phasenzahl (1 oder 3). Cluster haben im Modell keine Phasenzahl; ihr Limit in A je Phase wird dreiphasig umgerechnet. `TODO(verify)` mit dem Auftraggeber, ob das für alle Anlagen gilt.
