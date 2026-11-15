# LastPlan

Planungs- und Inbetriebnahme-Tool für Loxone-Lastmanagement von Ladeinfrastruktur: elektrische Struktur erfassen (Netzanschluss → Cluster → Gruppen → Ladepunkte), Planung prüfen, Loxone-Vorlagen erzeugen und Parameter live im Miniserver ändern.

> Unabhängiges Werkzeug, kein offizielles Loxone-Produkt.

**Stand:** Meilenstein 1 – Grundgerüst (Monorepo, CI, Design-Tokens, Domänenmodell, Migrationsrahmen).

## Voraussetzungen

- Node.js 22 LTS (`.nvmrc`)
- pnpm 10 (`corepack enable`)

## Installation und Entwicklung

```bash
pnpm install
pnpm dev            # Web-App auf http://localhost:5173
pnpm dev:gateway    # Gateway auf http://127.0.0.1:8787; gibt beim Start einen Kopplungscode aus
```

| Befehl                      | Zweck                                                      |
| --------------------------- | ---------------------------------------------------------- |
| `pnpm test`                 | alle Unit-Tests (Vitest, alle Pakete)                      |
| `pnpm test:coverage`        | Tests mit Abdeckung (Schwelle 90 % für core/loxone-export) |
| `pnpm lint` / `pnpm format` | ESLint / Prettier                                          |
| `pnpm typecheck`            | TypeScript in allen Paketen                                |
| `pnpm build`                | Web-App und Gateway bauen                                  |
| `pnpm check`                | alles wie in der CI                                        |

Ein Pre-Commit-Hook (Husky + lint-staged) formatiert und lintet geänderte Dateien.

## Architektur

```
apps/
  web/              React-SPA (Vite) – Planung, Prüfung, Export; läuft ohne Gateway
  gateway/          Node.js/Fastify – Modbus/HTTP, Miniserver, Live-Daten (ab Meilenstein 8)
packages/
  core/             Domänenmodell (Zod), Invarianten, Migrationen; später Berechnung, Prüfregeln, Simulation
  loxone-export/    Vorlagen und .Loxone-Ergänzung (ab Meilenstein 6/7, nur nach echten Beispieldateien)
  wallbox-library/  Modelldateien + Schema (ab Meilenstein 5, Register nur aus Herstellerdoku)
  protocol/         Zod-Schemas für Gateway-API und WebSocket
  ui/               Design-Tokens (Quelle: src/tokens.ts → tokens.css), später Komponenten
docs/adr/           Architekturentscheidungen
```

Details und Begründungen: [docs/adr](docs/adr/README.md). Gesamtplan: [docs/umsetzungsplan.md](docs/umsetzungsplan.md).

### Domänenmodell

Alle Typen werden aus Zod-Schemas abgeleitet (`packages/core/src/model`). Ströme in A, Leistung in kW. Zwei Prüfstufen (ADR 0004): `ProjectSchema` (Form/Wertebereiche) und `checkProjectInvariants` bzw. `StrictProjectSchema` (fachliche Zusammenhänge). Gespeicherte Projekte tragen `schemaVersion`; `loadProject` migriert und prüft (ADR 0006).

### Design-Tokens ändern

`packages/ui/src/tokens.ts` bearbeiten, dann `pnpm --filter @lastplan/ui gen:css`.

## Grundsätze

- Nichts erfinden: Modbus-Register, Loxone-XML und Miniserver-API nur aus gelieferten Unterlagen. Fehlendes wird als `TODO(verify)` markiert und blockiert den Export.
- Oberfläche, Fachkommentare und Doku auf Deutsch, Code-Bezeichner auf Englisch.

## Gateway starten (Docker)

```bash
cp .env.example .env                              # ggf. anpassen
docker compose --profile local up --build         # Laptop im Anlagennetz, nur localhost
docker compose --profile server up --build -d     # VPS: GATEWAY_SECRET_KEY und GATEWAY_ALLOWED_ORIGINS Pflicht
docker compose logs gateway-local | grep Kopplungscode
```

Sicherheitskonzept: [ADR 0008](docs/adr/0008-gateway-sicherheit.md), Miniserver-Anbindung: [ADR 0007](docs/adr/0007-miniserver-anbindung.md).
