# 0007 – Berechnung und Prüfung (Meilenstein 2)

**Status:** Angenommen · 2026-11-15

## Kontext

Kap. 4 und 5 lassen einige fachliche Details offen. Die folgenden Festlegungen bestimmen, was die Prüfung meldet und was den Export sperrt.

## Entscheidungen

### Limits je Ebene (Kap. 4.1)

- **Standort:** `Netzanschluss − Gebäudereserve`, je Phase gleich (Reserve gilt symmetrisch). Negativ → 0 A.
- **Cluster:** je Phase `min(eigenes Limit, verfügbares Limit der Elternebene)`. Abweichende Phasen-Limits (`phaseLimitA`) ersetzen `limitA`. Geschwister-Cluster werden **nicht** gegeneinander verrechnet; dass sie gemeinsam ins Elternlimit passen, prüft die Mindeststrom-Summe der Elternebene.
- **Gruppe:** `min(maxA ?? ∞, verfügbares Limit des Clusters)`. Gruppen ohne eigenes Limit werden nicht separat geprüft (sonst doppelte Meldungen zum Cluster).
- **Wirksamer Mindeststrom:** `group.minPerChargePointA`, falls gesetzt, sonst `cp.minA`.

### Worst Case (Kap. 4.3/4.4)

- Szenario A (alle 3-phasig), Szenario B (alle 1-phasig über Fahrzeugphase 1), Worst Case = Maximum je Phase, Schieflast = Spannweite in Szenario B.
- Mindeststrom-Summe je Phase nach Szenario A (ungünstigster Fall).

### Schweregrade (Rückmeldung Auftraggeber 2026-11-15)

- **PHASE_OVERLOAD ist ein Hinweis**, kein Fehler: Eine Summe der Max-Ströme über dem Limit ist der Normalfall, für den das Lastmanagement da ist.
- **Fehler (sperren den Export):** MIN_SUM, DUP_IP, CP_NO_GROUP, CP_MIN_MAX, MODEL_INCOMPLETE, PHASE_SWITCH_UNSUPPORTED sowie STRUCTURE (übrige Invarianten aus ADR 0004: doppelte Namen/IDs, fehlende Referenzen, Cluster-Zyklen).
- **Hinweise:** PHASE_OVERLOAD, UNBALANCE, EMPTY_GROUP, METER_MISSING.
- UNBALANCE wird am **Standort** geprüft (Netzanschlusspunkt).
- DUP_IP prüft Ladepunkte und Zähler; eine fehlende Unit-ID zählt als eigener Wert.
- CP_MIN_MAX prüft zusätzlich die Grenzen des Bibliotheksmodells.

### Schieflast-Optimierung

- Greedy (größter Strom zuerst auf die schwächste Phase) plus lokale Suche, ab Ist-Zustand und ab Greedy; Ziel lexikografisch: Standort-Schieflast, Summe der Cluster-Schieflasten, Anzahl Änderungen.
- 1-phasig angeschlossene Ladepunkte verschieben beim Drehen auch ihren Mindeststrom. Entsteht dadurch eine neue MIN_SUM-Überschreitung, wird ohne sie neu optimiert. Der Vorschlag verschlechtert also keine andere Prüfung.
- Ergebnis ist ein Vorschlag (`FixProposal` mit `ProjectChange[]`); angewendet erst nach Bestätigung, in der UI als ein Undo-Schritt.

### Simulation (Kap. 4.5)

- „N Fahrzeuge“ = die ersten N Ladepunkte in Projektreihenfolge, alternativ eine explizite Auswahl.
- Pausiert wird bei Überlast der Mindestströme der Ladepunkt mit niedrigster Priorität, bei Gleichstand der zuletzt angelegte, und nur innerhalb des überlasteten Bereichs.
- „Gleichmäßig innerhalb gleicher Priorität“ = gleiche Zuwächse ab dem Mindeststrom (Max-Min-Fairness der Zuwächse).
- Ladepunkte ohne gültige Gruppe gelten als Priorität 5.

### Struktur-Hash

- FNV-1a 64 Bit über kanonisches JSON der strukturrelevanten Daten, Präfix `v1:`. Synchron, ohne Browser-/Node-API.
- Strukturrelevant: IDs, Namen, Zuordnungen, Netzwerk, Protokoll, Modell, Anschlussphasen, Phasenumschaltung, Raum, Kategorie, Zähler, Benennungsschema. Nicht: Limits, Min/Max, Prioritäten, Reserve, Rotation, Notizen.
- TODO(verify): Einordnung von Rotation/Phasen/Phasenumschaltung nach der `.Loxone`-Analyse (Meilenstein 7) überprüfen.

### Bibliothek

- core definiert nur die Schnittstelle `ModelCatalog` / `CatalogModel` (Anzeigename, vollständig ja/nein, fehlende Felder, elektrische Grenzen). Die Wallbox-Bibliothek liefert die Implementierung.

## Folgen

Performance: Prüfung inkl. Optimierung bei 200 Ladepunkten ca. 4 ms (Ziel < 50 ms, als Test abgesichert).
