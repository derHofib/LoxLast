# 0015 – Übergabe soll ein lauffähiges Lastmanagement erzeugen

**Status:** Vorgeschlagen · 2026-11-16

## Kontext

Der erste vollständige Lauf der Übergabe (2026-11-16, Testprojekt) legt eine Seite mit
Lastmanagern (`LoadShed`), Wallbox Managern (`WBEM`), Wallboxen und Modbus-Geräten an und
verdrahtet sie (ADR 0014). Lauffähig ist das Ergebnis erst nach Handarbeit:

- Die Lasttabelle des Lastmanagers (analog/digital, Mindestleistung je Ausgang) lässt sich per
  MCP nicht schreiben. `get_block_data` meldet `dataContract: false` und zeigt nur
  `linkedControls` (Erkundung 2026-11-16, 12:06).
- Welche Wallboxen ein Wallbox Manager verwaltet, wird im Dialog festgelegt. Auch hier gilt
  `dataContract: false`.
- Der Eingang Ec (Ladefreigabe) der Wallbox ist offen.

Der Auftraggeber möchte, dass ein **fertiges, lauffähiges Lastmanagement** herauskommt und von
Hand höchstens noch Feinschliff nötig ist (2026-11-16, 14:00). Das ändert die Entscheidung
„Loxone-Standard + Abhak-Liste“ vom 2026-11-16, 13:08.

Belegt aus `get_doc` (Wallbox):

- **Ls** (Load shedding): Liegt ein Analogwert an, begrenzt er die Ladeleistung in kW. Unter der
  Mindestladeleistung pausiert das Laden.
- **Ec** (Enable charging): Ist der Eingang invertiert und nicht verbunden, ist das Laden erlaubt.
- **Tp**: Zielleistung in kW, geht über den Aktor als Ladestrom an die Wallbox.

## Optionen

**A. Loxone-Standard (LoadShed, WBEM) + Abhak-Liste** (Stand heute)
Das ist das gewohnte Bild für Loxone-Errichter, inklusive dynamischer Verteilung im Wallbox
Manager. Es ist aber nicht ohne Handarbeit lauffähig. Solange Loxone die Dialoge nicht im SDK
öffnet, ist das Ziel damit nicht erreichbar.

**B. Verteilung aus schreibbaren Standardbausteinen direkt an Ls jeder Wallbox**
LastPlan berechnet für jede Wallbox ein Limit in kW und speist es über Bausteine, deren Werte per
MCP setzbar sind, in Ls ein:

- B1 statisch: Das Limit ist der kleinste Anteil über alle Ebenen. Für jede Ebene gilt
  Ebenen-Limit ÷ Zahl der Ladepunkte darunter, begrenzt durch das Maximum der Wallbox. Die
  Summe überschreitet nie ein Limit, und es gibt keine Rückkopplung. Nachteil: Wenige ladende
  Fahrzeuge nutzen das Limit nicht aus.
- B2 dynamisch (später): Die nicht genutzte Leistung wird aus den Ist-Leistungen (Cp) neu
  verteilt. Das ist eine Regelschleife und muss zuerst am Test-Miniserver erprobt werden.

Voll automatisch und lauffähig ist schon B1. Mit B2 wird es sparsamer. Diese Logik liefert
LastPlan selbst und nicht Loxone, und sie muss im Prüfbericht nachvollziehbar sein.

**C. Export als .Loxone-Datei mit ausgefüllten Dialogen**
Das wäre wie der ursprüngliche XML-Generator. Das Dateiformat der Dialoge ist aber nicht
dokumentiert und müsste aus echten Projekten abgeleitet werden. Das widerspricht „nichts
erfinden“ und „nur offizielle Schnittstellen“, und ein Undo in Config gibt es dabei nicht.
**Verworfen.**

**Ec in allen Optionen:** Ec wird nicht offen gelassen. Lässt sich die Invertierung eines
Eingangs per SDK setzen, wird invertiert, sonst wird eine Konstante 1 angelegt (`Constant`,
einfügbar laut `get_insertable_types`). Beides ist `TODO(verify)` im nächsten Testlauf.

## Vorschlag

**B1 jetzt, B2 als nächster Schritt.** LoadShed und WBEM entfallen in der Übergabe, und die
Abhak-Liste schrumpft auf Feinschliff (Räume, Kategorien, Visualisierung). Für die Fehlersuche
bleiben die Limits je Ebene als virtuelle Eingänge in kW sichtbar und änderbar.

Vor der Umsetzung im Testprojekt prüfen:

1. Welcher Baustein rechnet „Minimum mehrerer Werte“ bzw. „Wert ÷ n“, und lassen sich seine
   Parameter per MCP setzen? Kandidaten aus `get_block_types`: Formel- und Minimum-Bausteine.
2. Ob sich die Invertierung von Ec setzen lässt.

## Folgen

- Die Übergabe wird ohne Dialoge lauffähig. Die Verantwortung für die Verteilung liegt bei
  LastPlan, deshalb wird die Rechnung (B1) im Prüfbericht ausgewiesen.
- Wer Option A möchte, bekommt sie später als Schalter zurück. Das ist hier nicht Teil.
