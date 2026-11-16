# 0012 – Geräte-Verbindungstest (Modbus TCP)

**Status:** Angenommen · 2026-11-16 (Arbeitspaket 8.5; ohne Test an echter Hardware)

## Kontext

Kap. 8.1/8.2 verlangen `POST /api/devices/test` (`{ endpoint, libraryModelId } → { reachable, latencyMs, values, firmware }`).
Registeradressen dürfen nur aus der Wallbox-Bibliothek kommen. Das einzige Bibliotheksmodell (ABL eM4 Twin) besteht
bisher nur aus `TODO`-Werten. Eine Test-Wallbox gibt es noch nicht.

## Entscheidung

- **Eigener Modbus-TCP-Client** (`apps/gateway/src/clients/modbus-tcp.ts`) nur mit `node:net`, nach den öffentlichen
  Spezifikationen „MODBUS Application Protocol Specification V1.1b3“ und „MODBUS Messaging on TCP/IP Implementation
  Guide V1.0b“: MBAP-Header, Funktionscodes 0x03, 0x04, 0x06, 0x10, Exception-Antworten mit deutscher Meldung,
  Timeout (Standard 2 s), Prüfung von Transaction-ID, Protokoll-ID, Unit-ID und Funktionscode, Wiederholung
  (Standard 2×) mit `backoffDelayMs` nur bei Verbindungsfehler/Timeout. Eine Verbindung je Host:Port, Anfragen
  darauf nacheinander; nach Timeout wird die Verbindung verworfen. Keine neue Abhängigkeit.
- **Nur lesen.** Der Test liest die Rollen `currentL1`–`currentL3`, `power`, `status` mit 0x03 oder 0x04, je nach
  `fn` in der Modelldatei. Steht dort ein anderer Funktionscode, gilt das Modell als widersprüchlich („nicht prüfbar“).
- **Nicht prüfbar statt raten.** Fehlt eine benötigte Angabe (Adresse, Funktionscode, Datentyp, Skalierung, Einheit
  der fünf Rollen, `byteOrder`, Unit-ID wenn am Ladepunkt keine steht), wird kein Register gelesen. Ergebnis
  `outcome: "not_testable"`, `missing` mit den Feldpfaden und ein deutscher Text („Nicht prüfbar: Register fehlen in
  der Bibliothek (Strom L1: Adresse, …)“). Das Gateway prüft dann nur, ob am Port eine TCP-Verbindung zustande kommt
  (kein Modbus-Rahmen), damit IP/Port trotzdem kontrolliert werden können.
- **Herkunft des Modells.** Das Gateway lädt die Modelldateien aus `GATEWAY_LIBRARY_DIR` (Standard
  `packages/wallbox-library/models`, im Docker-Image `/app/library`). Der Browser schickt zusätzlich die Modelldatei mit,
  die er gerade anzeigt (`model`, optional), weil seine Bibliothek neuer sein kann (nachgeladen, ADR 0002) oder später
  in der Software ergänzt wird. Das Gateway prüft sie mit Schema und Regeln der Bibliothek (`checkModel`), verlangt
  `id === libraryModelId` und nimmt sie dann vorrangig. `modelSource` in der Antwort nennt die Quelle.
- **Byte-Reihenfolge.** Modbus überträgt jedes Register Big-Endian (V1.1b3, Kap. 4.2); für 32-Bit-Werte legt die
  Spezifikation nichts fest. Bedeutung von `byteOrder` in der Bibliothek: `big-endian` = ABCD (höheres Register
  zuerst), `word-swapped` = CDAB, `little-endian` = DCBA (bei 16 Bit BA). Wert = Rohwert × `scale`.
- **Antwort** (`packages/protocol/src/devices.ts`): `outcome` (`ok`, `not_testable`, `device_error`, `unreachable`),
  `reachable`, `latencyMs` (Dauer der ersten beantworteten Modbus-Anfrage inkl. Verbindungsaufbau; bei „nicht prüfbar“
  die TCP-Aufbauzeit), `values` (Rolle → Wert bzw. Statustext), `readings` (Wert, Einheit, Rohregister, Fehler je
  Register), `missing`, `message`, `firmware` (immer `null`: die Bibliothek beschreibt kein Firmware-Register).
  Eine Exception bei einem Register bricht den Test nicht ab; Timeout oder Verbindungsabbruch schon.
- **Schutz:** Token-Pflicht wie bei allen Endpunkten, eigenes Rate-Limit 30 Tests/min je IP zusätzlich zum globalen.
  Keine Protokollierung von Anfragen oder Token.
- **Web-App:** Kopplung über Formular „Gateway koppeln“ in der Infos-Spalte (Adresse + Einmalcode). Adresse und Token
  liegen nur im `sessionStorage` (enden mit dem Tab, nicht im Projekt). Miniserver-Zugangsdaten gibt es im Browser
  nicht. Ergebnisse gelten nur für die Sitzung.

## Alternativen

- **npm-Paket für Modbus** (z. B. `modbus-serial`, `jsmodbus`): spart wenig, bringt Abhängigkeiten und
  Serial-Port-Ballast; die vier Funktionscodes sind überschaubar.
- **Nur `libraryModelId`, Modell immer aus dem Gateway:** einfacher, aber Browser und Gateway könnten verschiedene
  Bibliotheksstände zeigen; im Browser ergänzte Werte wären nicht testbar.
- **Bei fehlenden Registern gar nichts tun:** verschenkt die Prüfung von IP/Port, die ohne Registerannahmen möglich ist.

## Folgen und Grenzen

- Ungetestet gegen echte Wallboxen: Verifiziert ist nur gegen den eigenen Simulator
  (`clients/modbus-simulator.ts`). Abweichungen realer Geräte (z. B. andere Unit-ID in der Antwort, mehrere parallele
  Anfragen) zeigen sich erst mit Test-Hardware.
- Mit dem aktuellen ABL-Modell ist jeder Test „nicht prüfbar“, bis die Register mit Quelle eingetragen sind.
- HTTP-Geräte (Kap. 8.1) und Polling-Schleifen (Kap. 8.4) folgen mit Hardware bzw. Meilenstein 9.
