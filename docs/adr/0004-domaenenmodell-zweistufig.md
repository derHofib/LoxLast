# 0004 – Domänenmodell: Formprüfung und Invarianten getrennt

**Status:** Angenommen · 2026-11-15

## Kontext

Kap. 3 verlangt Invarianten „im Schema und in Prüfregeln“. Gleichzeitig erzeugt der Nutzer im Editor zwangsläufig Zwischenstände (z. B. Min-Strom höher als Max-Strom, während er tippt), und Kap. 5 will genau solche Zustände als Meldungen mit Lösungsvorschlag anzeigen statt sie zu verbieten.

## Entscheidung

1. **`ProjectSchema`** (Zod) prüft Form und Wertebereiche einzelner Felder: Typen, IPv4, Port 1–65535, Unit-ID 0–247, Ströme 0–6300 A, Priorität 1–5, Phasen 1/3, Namensvorlagen. Gilt beim Laden, Speichern und für jede Formulareingabe.
2. **`checkProjectInvariants()`** prüft fachliche Zusammenhänge und liefert deutsche Meldungen mit `targetIds` und Pfad:
   eindeutige IDs, eindeutige Ladepunkt-Bezeichnungen, eindeutige Clusternamen, eindeutige Gruppennamen je Cluster (Groß-/Kleinschreibung egal, weil daraus Loxone-Objektnamen werden), gültige Referenzen Gruppe→Cluster und Ladepunkt→Gruppe, keine Zyklen bei verschachtelten Clustern, `6 A ≤ minA ≤ maxA ≤ fuseA`.
   Die Prüfregeln aus Meilenstein 2 (z. B. `CP_NO_GROUP`, `CP_MIN_MAX`) bauen darauf auf.
3. **`StrictProjectSchema`** = Form + Invarianten. Verwendung als Vorbedingung für den Loxone-Export.
4. Laden/Import (`loadProject`) nutzt nur die Formprüfung, damit unfertige Projekte nicht verloren gehen.

## Abweichungen von Kap. 3

- **`Site.limitA` wird nicht gespeichert.** Es ist laut Spezifikation ein berechneter Wert (`gridConnectionFuseA − buildingReserveA`) und wird in `calc` (Meilenstein 2) abgeleitet. Ein gespeichertes Feld könnte vom berechneten Wert abweichen. Beim Laden wird ein vorhandenes `limitA` verworfen.
- **IP-Adressen nur IPv4.** In Anlagennetzen üblich; Hostnamen/IPv6 bei Bedarf später.
- **Plausibilitätsgrenze 6300 A** für alle Ströme fängt Tippfehler ab (größte übliche NH-Sicherung).

## Folgen

Die UI zeigt Invariantenverletzungen als Prüfmeldungen; der Export ist gesperrt, solange `StrictProjectSchema` fehlschlägt.
