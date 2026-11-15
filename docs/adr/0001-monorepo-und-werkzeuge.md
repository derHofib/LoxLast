# 0001 – Monorepo und Werkzeuge

**Status:** Angenommen · 2026-11-15

## Kontext

Spezifikation Kap. 2.2/2.3 gibt pnpm-Workspaces, TypeScript strict, React 18 + Vite, Vitest, ESLint/Prettier, Husky und GitHub Actions vor. Konkrete Versionen sind offen.

## Entscheidung

- **pnpm-Workspaces**, `apps/*` und `packages/*`. Interne Pakete werden **als TypeScript-Quelltext** konsumiert (`exports` → `src/index.ts`), ohne eigenen Build-Schritt. Vite bündelt sie für die Web-App, `tsup` für das Gateway (`noExternal: @lastplan/*`).
- **Versionen** bewusst auf bewährte, zueinander passende Linien festgelegt statt jeweils „latest“:
  TypeScript 5.9 (typescript-eslint unterstützt TypeScript 7 noch nicht), Vite 6, Vitest 3, ESLint 9 (Flat Config), React 18.3 (laut Spezifikation), Zod 4, Fastify 5, Node 22 LTS.
  Upgrades erfolgen gezielt in einem eigenen Schritt.
- **TypeScript** zusätzlich zu `strict` mit `noUncheckedIndexedAccess` und `exactOptionalPropertyTypes` – verhindert gerade bei Strom- und Phasenberechnungen stille `undefined`-Fehler.
- **Lint-Regeln:** `no-explicit-any` als Fehler (Ausnahme nur per Kommentar mit Begründung); `packages/core` und `packages/loxone-export` dürfen keine Node- oder UI-Module importieren (läuft im Browser).
- **Tests:** ein Vitest-Aufruf im Root über alle Pakete (`test.projects`), Abdeckungsschwelle 90 % für `core` und `loxone-export` (Kap. 13).
- **CI:** GitHub Actions führt `format:check`, `lint`, `typecheck`, `test:coverage` und `build` aus.

## Folgen

- Kein Paket-Build nötig, schnelle Entwicklung; dafür müssen Konsumenten TypeScript verstehen (Vite, tsup, Vitest – alle gegeben).
- Playwright (E2E) wird mit Meilenstein 3 eingerichtet, sobald es eine Oberfläche zu testen gibt.
