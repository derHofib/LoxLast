# End-to-End-Tests (Playwright)

- `tests/projekt.spec.ts`: Projekt anlegen/umbenennen/neu laden, Undo/Redo per Tastatur, Tabs, JSON-Export/-Import, Importfehler.
- `tests/a11y.spec.ts`: axe-Prüfung (WCAG 2.2 AA) für Projektübersicht, Komponentenseite und Projektansicht; Mindestgröße der Klickflächen.

```sh
pnpm --filter @lastplan/e2e exec playwright install chromium   # einmalig
pnpm --filter @lastplan/e2e test
```

Der Dev-Server der Web-App startet automatisch. Mit vorinstalliertem Browser: `PLAYWRIGHT_CHROMIUM_PATH=/pfad/zu/chromium`.
