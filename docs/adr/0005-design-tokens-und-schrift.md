# 0005 – Design-Tokens und Schrift

**Status:** Angenommen · 2026-11-15

## Entscheidung

- **Einzige Quelle** der Tokens ist `packages/ui/src/tokens.ts` (Werte exakt aus Kap. 10.1). `tokens.css` wird daraus erzeugt (`pnpm --filter @lastplan/ui gen:css`); ein Test schlägt fehl, wenn die CSS-Datei veraltet ist. So sind CSS-Variablen und TS-Konstanten nie verschieden.
- **Dark Mode** ist strukturell vorbereitet (`:root[data-theme="dark"]`, `darkColorTokens`), übernimmt aber bis Meilenstein 10 die hellen Werte.
- **Schrift Source Sans 3** (SIL Open Font License) über `@fontsource/source-sans-3`: Die Schriftdateien werden mitgebündelt und vom eigenen Server ausgeliefert, kein Abruf bei Google (Kap. 12).
- Kein Loxone-Logo, kein Loxone-Name im Produktbranding, nicht die Schrift „LOXONE Sans“. Produktzeichen: grüner Kreis mit Blitz.

## Folgen

Komponenten (Meilenstein 3) verwenden ausschließlich `var(--…)`; Grün (`--color-accent`) nie als Textfarbe.
