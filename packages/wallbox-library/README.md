# Wallbox-Bibliothek

## Zweck

Dieses Paket enthält Wallbox-Modelldateien mit Modbus-Registern. Sie werden
zentral im Repository gepflegt (siehe ADR 0002) und dienen als einzige
Quelle für Registerdefinitionen.

## Dateiformat

Pro Modell und Version gibt es genau eine Datei:

```
models/<hersteller>/<modell>@<version>.json
```

Beispiel: `models/abl/em4-twin@1.json`

- Die Kennung `id` muss dem Pfad ohne `.json` entsprechen, hier also
  `abl/em4-twin@1`.
- Das Schema liegt unter `schema/wallbox-model.schema.json`.

## Regel: Quelle oder TODO

Jeder Registerwert braucht eine Quelle (`source`) mit Dokumentname, Version
und Seite.

- Fehlt die Quelle, bleibt der Wert `"TODO"`.
- Ein Wert ohne Quelle ist ein Fehler.
- Platzhalter sind Texte, die mit `TODO` beginnen, zum Beispiel `"TODO"`
  oder `"TODO(verify: ...)"`.

## Status

| Status       | Bedeutung                                                               |
| ------------ | ----------------------------------------------------------------------- |
| `complete`   | Keine TODO-Marker vorhanden.                                            |
| `incomplete` | Mindestens ein TODO-Marker. Export gesperrt, die Datei ist aber gültig. |
| `invalid`    | Schema- oder Regelfehler. Die CI bricht ab.                             |

## Prüfen

```bash
pnpm --filter @lastplan/wallbox-library test
```

Die CI führt denselben Befehl aus.

## Neues Modell anlegen

1. Eine bestehende Modelldatei kopieren.
2. `id` und Dateipfad angleichen.
3. Werte nur aus der gelieferten Herstellerdokumentation eintragen.
4. Zu jedem Wert die Quelle angeben (Dokument, Version, Seite).
5. Die Tests lokal laufen lassen.
6. Einen Pull Request öffnen.

## Hinweis

Nichts aus dem Gedächtnis übernehmen. Die Herstellerdokumente liegen unter
[`docs/wallbox-sources/`](../../docs/wallbox-sources/). Wer keine Quelle
hat, trägt `"TODO"` ein.
