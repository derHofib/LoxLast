# 0008 – Gateway: Kopplung, Zugangsdaten, Netzwerkschutz

**Status:** Angenommen · 2026-11-15 (abgeglichen mit Spezifikation Kap. 8, 9, 12)

## Entscheidung

- **Pairing (Kap. 8.2/12):** Beim Start erzeugt das Gateway einen Einmalcode (`XXXX-XXXX`, ohne 0/1/I/O, 10 min gültig) und gibt ihn nur auf der Konsole aus. `POST /api/auth/pair` tauscht ihn gegen ein Bearer-Token (60 min). Der Code ist nach einem Treffer oder Ablauf verbraucht; Vergleich zeitkonstant. `POST /api/auth/refresh` erneuert und widerruft das alte Token. Tokens liegen in SQLite nur als SHA-256-Hash.
- **WebSocket `/ws` (Kap. 8.3):** Das Token wird in der ersten Nachricht (`auth`) gesendet, nie in der URL. Ohne Anmeldung binnen 5 s wird geschlossen (4401), bei nicht freigegebener Origin mit 4403. Die Nachrichtentypen `live.update`, `miniserver.state`, `parameter.applied`, `parameter.failed`, `structure.mismatch` sind in `packages/protocol` spezifiziert, gesendet werden sie ab Meilenstein 9.
- **Rate-Limit:** global 120 Anfragen/min je IP, Pairing 5/min je IP. Antwort 429.
- **CORS/Origin:** nur exakt freigegebene Origins (`GATEWAY_ALLOWED_ORIGINS`, kein `*`), sonst 403. Profil `server` verlangt die Liste; `local` erlaubt standardmäßig die Vite-Dev-Origins.
- **Profile (Kap. 8.5):** `local` lauscht auf 127.0.0.1 (für LAN `GATEWAY_HOST=0.0.0.0` setzen), `server` auf 0.0.0.0 mit Pflicht zu Schlüssel und Origin. Das Server-Profil ist nur hinter einem TLS-Reverse-Proxy zu betreiben; der Proxy selbst ist nicht Teil dieses Meilensteins. Compose bindet standardmäßig nur an 127.0.0.1.
- **Credential-Store (Kap. 12):** SQLite (`better-sqlite3`), AES-256-GCM, je Eintrag eigener IV, ID als AAD. Schlüssel aus `GATEWAY_SECRET_KEY` (32 Byte, Hex/Base64). Nur `local`: fehlt er, wird einmalig `data/secret.key` (0600) angelegt. `POST /api/miniserver` nimmt `{host, user, password}` entgegen; Host, Benutzer und Passwort liegen gemeinsam verschlüsselt, die API liefert nie das Passwort zurück. Weder Log noch Änderungsprotokoll enthalten das Passwort.
- **Eingabevalidierung (Kap. 12):** IPv4, Port 1–65535, Unit-ID 0–247, Host ohne Schema/Port, Bibliotheks-ID-Format, 1–200 Parameteränderungen mit endlichen Werten (alle in `packages/protocol`).
- **Änderungsprotokoll (Kap. 8.1/9):** append-only (DB-Trigger), Felder wer/wann/Aktion/Projekt/Ziel/vorher/nachher. „Wer“ ist ein Sitzungs-Pseudonym (`sitzung-<Hash>`), weil es keine Nutzerverwaltung gibt. Abfrage über `GET /api/projects/:id/changelog`.
- **Mandantenfähigkeit (Kap. 12):** `tenant_id` (Standard `default`) in `credentials` und `changelog` vorgesehen, noch ungenutzt.
- **Robustheit (Kap. 8.4):** Standard-Polling 2 s (`DEFAULT_POLL_INTERVAL_MS`) und Backoff-Funktion `backoffDelayMs` sind vorhanden; Polling-Schleifen, Timeouts und Rücklesen gegen echte Geräte folgen mit Hardware.
- **Hardware-Clients:** `MiniserverClient` und `ModbusClient` sind nur Interfaces mit Mocks. Keine Register oder Miniserver-Adressen hinterlegt (ADR 0007).

## Stand gegenüber Kap. 8.2

| Endpunkt                                                                                                                                        | Stand                                                                                                |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `POST /api/auth/pair`, `GET /api/health`, `POST /api/miniserver`, `GET /api/miniserver/status`, `GET /api/projects/:id/changelog`               | umgesetzt                                                                                            |
| `POST /api/devices/test`, `GET /api/projects/:id/live`, `POST /api/projects/:id/parameters`, `POST /api/projects/:id/changelog/:entryId/revert` | Schemas vorhanden; Route antwortet 501 `not_implemented` (braucht Test-Wallbox bzw. Test-Miniserver) |
| `POST /api/auth/refresh`                                                                                                                        | Zusatz zur Spezifikation (Token erneuern, Kap. 12)                                                   |

## Annahmen (wo die Spezifikation nichts festlegt)

- Token-Laufzeit 60 min, Code-Laufzeit 10 min, Rate-Limits 120/min bzw. 5/min (Token- und Code-Laufzeit per `.env`, Rate-Limits im Code anpassbar).
- Pro Gateway ein Miniserver-Zugang (Credential-ID `miniserver`).
- `GET /api/miniserver/status` liefert `state`, `lastValuesAt` und `configured`; `lastValuesAt` bleibt bis zur echten Implementierung `null`.
- Das Änderungsprotokoll wird projektbezogen abgefragt; Pairing- und Miniserver-Einträge haben keine Projekt-ID.

## Offen

- Schlüsselrotation (Neuverschlüsselung) ist nicht umgesetzt.
- Mehrere parallele Browser-Sitzungen: jede koppelt mit eigenem Code; ein neuer Code ersetzt einen noch offenen.
- Der Docker-Image-Build ist ungeprüft (kein Docker-Daemon in der Entwicklungsumgebung).
