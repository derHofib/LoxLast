# 0008 – Gateway: Kopplung, Zugangsdaten, Netzwerkschutz

**Status:** Angenommen · 2026-11-15

## Entscheidung

- **Pairing:** Beim Start erzeugt das Gateway einen Einmalcode (`XXXX-XXXX`, ohne 0/1/I/O, 10 min gültig) und gibt ihn nur auf der Konsole aus. `POST /api/pair` tauscht ihn gegen ein Bearer-Token (Standard 60 min). Der Code ist nach einem Treffer oder Ablauf verbraucht; Vergleich zeitkonstant. Erneuerung über `POST /api/token/refresh` widerruft das alte Token. Tokens liegen in SQLite nur als SHA-256-Hash.
- **WebSocket:** Das Token wird in der ersten Nachricht (`auth`) gesendet, nie in der URL (Logs, Proxys). Ohne Anmeldung binnen 5 s wird die Verbindung geschlossen (Code 4401).
- **Rate-Limit:** global 120 Anfragen/min je IP, Pairing 5/min je IP. Antwort 429 mit deutschem Hinweis.
- **CORS/Origin:** Nur exakt freigegebene Origins (`GATEWAY_ALLOWED_ORIGINS`, kein `*`). Fremde Origins erhalten 403. Profil `server` verlangt die Liste; `local` erlaubt standardmäßig die Vite-Dev-Origins.
- **Profile:** `local` lauscht auf 127.0.0.1 (im Container per Port-Mapping auf Loopback begrenzt), `server` auf 0.0.0.0 mit Pflicht zu Schlüssel und Origin; TLS übernimmt ein vorgeschalteter Reverse-Proxy (nicht Teil dieses Meilensteins).
- **Credential-Store:** SQLite (`better-sqlite3`), AES-256-GCM, je Eintrag eigener IV, die ID als AAD (vertauschte Zeilen schlagen fehl). Schlüssel aus `GATEWAY_SECRET_KEY` (32 Byte, Hex oder Base64). Nur `local`: fehlt der Schlüssel, wird einmalig `data/secret.key` (0600) angelegt. Die API liefert nie Geheimnisse, nur Metadaten; Klartext gibt es nur intern (`getSecret`).
- **Änderungsprotokoll:** SQLite-Tabelle, per Trigger append-only; enthält nie Geheimnisse.
- **Hardware-Clients:** `MiniserverClient` und `ModbusClient` sind nur Interfaces mit Mocks. Keine Register oder Miniserver-Adressen sind hinterlegt (siehe ADR 0007).

## Offen

- Schlüsselrotation (Neuverschlüsselung) ist nicht umgesetzt.
- Mehrere parallele Browser-Sitzungen: jede koppelt mit eigenem Code; ein neuer Code ersetzt einen noch offenen.
- Genaue Vorgaben aus Spezifikation Kap. 8 und 12 lagen dem Bearbeiter nur auszugsweise vor; Abweichungen bitte im Review melden.
