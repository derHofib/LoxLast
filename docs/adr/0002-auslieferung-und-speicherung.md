# 0002 – Auslieferung der Web-App und Speicherung der Projekte

**Status:** Angenommen, Punkt „GitHub als Quelle“ noch zu präzisieren · 2026-11-15

## Kontext

Kap. 2.1 beschreibt eine Browser-App mit IndexedDB und ein optionales Gateway. Offen ist, ob die Web-App später zentral gehostet wird und Projekte serverseitig liegen.

## Entscheidung (Annahme)

- Die Web-App ist eine **statische SPA**. Sie läuft lokal (`pnpm dev` / statische Dateien) und kann später zusätzlich vom Gateway ausgeliefert werden.
- Projekte liegen **nur im Browser** (IndexedDB, Meilenstein 3) und werden als JSON exportiert/importiert.
- Planung und Export funktionieren **ohne Gateway**.
- Das Datenmodell enthält ein optionales `tenantId`, das derzeit nicht genutzt wird (Kap. 12).

## Rückmeldung Auftraggeber (2026-11-15)

- Zunächst statisch/lokal: bestätigt.
- „Später soll es sich die Informationen über GitHub ziehen können.“ Daraus folgt für die Architektur:
  - Die Web-App bleibt eine rein statische SPA ohne Serverabhängigkeit und lässt sich daher direkt aus dem GitHub-Repo bauen und ausliefern (z. B. GitHub Pages oder ein Release-Artefakt).
  - Die Wallbox-Bibliothek bleibt eine Sammlung versionierter JSON-Dateien mit JSON-Schema (Kap. 6). Damit kann die App später eine aktuellere Bibliothek aus dem Repo nachladen, ohne neu ausgeliefert zu werden. Nachgeladene Dateien werden vor der Verwendung gegen das Schema geprüft; unvollständige Modelle bleiben für den Export gesperrt.
  - TODO(verify): Welche Informationen genau aus GitHub kommen sollen (App-Updates, Wallbox-Bibliothek, Projektvorlagen) und ob das Repo dafür öffentlich ist oder ein Token braucht. Entscheidung als eigener ADR, spätestens in Meilenstein 5.

## Folgen

- Keine Serverdatenbank für Projekte nötig; Datenhaltung bleibt beim Nutzer.
- Wechsel auf zentrales Hosting ist vorbereitet (`tenantId`, Migrationsrahmen), erfordert aber Synchronisation und Authentifizierung – eigener ADR, falls gewünscht.
