# 0002 – Auslieferung der Web-App und Speicherung der Projekte

**Status:** Angenommen · 2026-11-15

## Kontext

Kap. 2.1 beschreibt eine Browser-App mit IndexedDB und ein optionales Gateway. Offen ist, ob die Web-App später zentral gehostet wird und Projekte serverseitig liegen.

## Entscheidung (Annahme)

- Die Web-App ist eine **statische SPA**. Sie läuft lokal (`pnpm dev` / statische Dateien) und kann später zusätzlich vom Gateway ausgeliefert werden.
- Projekte liegen **nur im Browser** (IndexedDB, Meilenstein 3) und werden als JSON exportiert/importiert.
- Planung und Export funktionieren **ohne Gateway**.
- Das Datenmodell enthält ein optionales `tenantId`, das derzeit nicht genutzt wird (Kap. 12).

## Rückmeldung Auftraggeber (2026-11-15)

- Zunächst statisch/lokal: bestätigt.
- „Später soll es sich die Informationen über GitHub ziehen können“ – präzisiert: Es geht um die **Wallbox-Bibliothek mit den Modbus-Registern**, die zentral auf GitHub gepflegt und von dort bezogen werden soll.

## Entscheidung Wallbox-Bibliothek

- **Quelle der Wahrheit** ist dieses Repo: `packages/wallbox-library/models/<hersteller>/<modell>@<version>.json`, jede Datei mit Quellenangabe je Register (Kap. 6). Änderungen laufen über Pull Requests; die CI prüft jede Datei gegen das JSON-Schema.
- **Beim Build** wird die Bibliothek in die App eingebettet. Die App funktioniert damit offline und vor Ort ohne Internet.
- **Aktualisierung zur Laufzeit** (später): Die CI veröffentlicht bei jedem Merge auf `main` ein Bibliotheks-Paket (`index.json` mit Versionsnummer und Prüfsumme + Modelldateien) als statische Dateien. Die App prüft auf Wunsch, ob eine neuere Version vorliegt, lädt sie, validiert jede Datei gegen das Schema und speichert sie in IndexedDB. Ungültige oder unvollständige Modelle werden nicht übernommen bzw. bleiben für den Export gesperrt.
- **Kein GitHub-Token im Browser.** Ein privates Repo könnte der Browser nur mit Token lesen; das wäre nicht sicher. Daher muss der Veröffentlichungsort öffentlich lesbar sein (z. B. GitHub Pages oder ein öffentliches Release), oder das Gateway lädt die Bibliothek stellvertretend.
- Das Repo `derHofib/LoxLast` ist öffentlich (Stand 2026-11-15), die Veröffentlichung braucht also kein Token. Geladen wird nur das von der CI erzeugte Paket aus `main` (z. B. über GitHub Pages), nicht direkt aus beliebigen Branches. Konkrete Umsetzung in Meilenstein 5.

## Folgen

- Keine Serverdatenbank für Projekte nötig; Datenhaltung bleibt beim Nutzer.
- Wechsel auf zentrales Hosting ist vorbereitet (`tenantId`, Migrationsrahmen), erfordert aber Synchronisation und Authentifizierung – eigener ADR, falls gewünscht.
