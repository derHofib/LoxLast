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
4. **Hierarchie:** Jede LastPlan-**Gruppe** wird ein eigener Wallbox Manager (`WBEM`) mit genau den Wallboxen dieser Gruppe. Ein Wallbox Manager sieht nur seine eigenen Wallboxen (Auskunft des Auftraggebers, 2026-11-16) und ist deshalb eine Gruppe, kein Cluster. Seine Stränge im Dialog bleiben ungenutzt, solange sie nicht per MCP schreibbar sind (siehe unten). Das Limit der Gruppe kommt am Eingang `Pmax` in kW an.
   **Cluster und Standort** entstehen durch Logik vor den Wallbox Managern: je Ebene ein Lastmanager (`LoadShed`) im Modus Überlastschutz. Ein Kind-Cluster oder eine Gruppe belegt beim Eltern-Lastmanager eine analoge Last; deren Ausgang L*n* liefert das Limit in kW an den Kind-Lastmanager bzw. an `Pmax` des Wallbox Managers. Ob das so trägt, hängt an den offenen Punkten unten.
5. **Sollwert zur Wallbox-Hardware:** Der Ausgang Tp (`outLimit`, kW) geht an einen analogen Modbus-Aktor. Die Umrechnung kW → A übernimmt dessen Skalierung (Eingangswert/Zielwert 1 und 2, Eigenschaften 1030/1031/1318/1319): 0 kW → 0, die Leistung bei Maximalstrom → Maximalstrom als Rohwert laut Bibliothek. Sensoren für Leistung und Zählerstand skalieren ebenso auf kW bzw. kWh (Erkundung 2026-11-16, 13:16).

## Offen, vor der Umsetzung (6.4) zu klären

- Geklärt (erster Lauf am 2026-11-16 im Testprojekt): MaxP des Kind-Lastmanagers lässt sich aus einem Ausgang (L1, L2 …) des übergeordneten Lastmanagers speisen.
- Belegt (Erkundung 2026-11-16, 11:03): Der Wallbox Manager gruppiert seine Wallboxen im Dialog in „Stränge“ mit Leistungsgrenze, `get_block_data` meldet für diesen Dialog aber `dataContract: false`. Per MCP sind die Stränge also nicht schreibbar. Wallbox: Eigenschaften 3050 „Max. Ladeleistung [kW]“ und 3049 „Min. Ladeleistung [kW]“, Limit-Eingang mit Schlüssel `loadshed`, Ausgang `outLimit`.
- Belegt (Erkundung 2026-11-16, 12:06): Beim Lastmanager (`LoadShed`) sind per MCP schreibbar: Eigenschaft 416 „MaxP [kW]“, 3054 „Arbeitsmodus“ (0 = Überlastschutz) und der Parameter-Anschluss `maxP`. Die Lasttabelle (analog/digital, Mindestleistung) steht weder in den Eigenschaften noch in `get_block_data` und ist damit nicht schreibbar. Ausgänge `AQl1`–`AQl12`.
- **Entschieden vom Auftraggeber (2026-11-16):** Loxone-Standardbausteine. LastPlan legt Lastmanager, Wallbox Manager und Wallboxen an, benennt, verdrahtet und setzt alle schreibbaren Werte. Was nur im Dialog geht (Lasttabelle des Lastmanagers, Zuordnung der Wallboxen zum Wallbox Manager), gibt LastPlan als Abhak-Liste je Baustein aus. Eine eigene Ersatzlogik aus einfachen Bausteinen wird nicht gebaut.
- Geklärt (erster Lauf am 2026-11-16): `connect_blocks` nimmt den Parameter-Anschluss `maxP` als Ziel an, ebenso `Pmax` am Wallbox Manager.
- Die Lasttabelle des Lastmanagers (Typ analog/digital, Priorität, Mindestleistung) liegt hinter dem Baustein-Dialog. Die Erkundung liest sie jetzt mit `get_block_data`, damit 6.4 ihr Format kennt.

## Folgen

- Die Berechnung und Prüfung (ADR 0007) bleibt unverändert.
- Die Vorschau der Übergabe (6.5) zeigt A und kW nebeneinander, damit Abweichungen durch Rundung sichtbar sind.
- Ladepunkte rechnen mit ihrer eigenen Phasenzahl (1 oder 3). Cluster haben im Modell keine Phasenzahl; ihr Limit in A je Phase wird dreiphasig umgerechnet. `TODO(verify)` mit dem Auftraggeber, ob das für alle Anlagen gilt.
