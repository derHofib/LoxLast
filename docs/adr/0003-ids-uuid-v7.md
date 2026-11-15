# 0003 – IDs als UUID v7

**Status:** Angenommen · 2026-11-15

## Entscheidung

Alle Domänen-IDs sind UUID v7 (RFC 9562), erzeugt mit dem Paket `uuid`. Das Schema (`IdSchema`) akzeptiert nur v7.

## Begründung

Zeitlich sortierbar (stabile Reihenfolge in Listen und Protokoll), offline ohne Koordination erzeugbar, kollisionssicher beim Zusammenführen von Projekten (CSV-Import, Duplizieren).

## Folgen

Fremd-IDs (z. B. UUIDs aus Loxone-Dateien) sind **keine** Domänen-IDs und werden getrennt geführt.
