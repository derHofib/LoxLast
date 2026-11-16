# LastPlan-Gateway

Node.js/Fastify-Dienst im Anlagennetz zwischen Web-App und Geräten (Spezifikation Kap. 8).
Sicherheitskonzept: [ADR 0009](../../docs/adr/0009-gateway-sicherheit.md), Miniserver:
[ADR 0008](../../docs/adr/0008-miniserver-anbindung.md), Verbindungstest:
[ADR 0012](../../docs/adr/0012-geraete-verbindungstest.md).

## Starten

```bash
pnpm dev:gateway        # http://127.0.0.1:8787, gibt den Kopplungscode auf der Konsole aus
```

Docker und Profile `local`/`server`: siehe Haupt-README. Konfiguration in `.env` (Vorlage `.env.example`).

## Koppeln

In der Web-App unter **Ladepunkte → Infos → Verbindungstest → Gateway koppeln** die Gateway-Adresse und den
Einmalcode aus der Konsole eingeben. Das Token (60 min) liegt nur im `sessionStorage` des Tabs. Ein neuer Code
erscheint bei jedem Start des Gateways.

## Geräte-Verbindungstest

`POST /api/devices/test` (Bearer-Token, höchstens 30 Tests pro Minute):

```json
{
  "endpoint": { "ip": "192.168.10.21", "port": 502, "unitId": 1 },
  "libraryModelId": "hersteller/modell@1"
}
```

- Liest per Modbus TCP **nur lesend** Strom L1–L3, Leistung und Status. Adresse, Funktionscode (0x03/0x04),
  Datentyp, Skalierung, Einheit und Byte-Reihenfolge stammen ausschließlich aus der Modelldatei der
  Wallbox-Bibliothek. Die Web-App schickt die Modelldatei, die sie anzeigt, als `model` mit; sonst gilt die
  Bibliothek des Gateways (`GATEWAY_LIBRARY_DIR`).
- Antwort: `outcome` (`ok` · `not_testable` · `device_error` · `unreachable`), `reachable`, `latencyMs`,
  `readings` (Wert mit Einheit, Rohregister, Fehler je Register), `missing`, `message` (deutsch).
- **Nicht prüfbar:** Steht in der Modelldatei bei einer benötigten Angabe `TODO`, liest das Gateway kein Register,
  sondern meldet „Nicht prüfbar: Register fehlen in der Bibliothek (…)“ mit den fehlenden Feldern und prüft nur,
  ob der Port per TCP erreichbar ist. Das gilt derzeit für das ABL-Modell, dessen Register noch fehlen.
- Typische Meldungen: „Verbindung … abgelehnt“ (Port/Modbus-Freigabe), „Keine Antwort … innerhalb von 2000 ms“
  (Unit-ID, Modbus am Gerät aktiv?), „Gerät meldet Modbus-Ausnahme 0x02 …“ (Registeradresse in der Bibliothek prüfen).

### Grenzen

- Nicht an echter Hardware getestet, nur gegen den Simulator. Erst mit Test-Wallbox verifizieren.
- Nur Modbus TCP; HTTP-Geräte, Polling und Live-Werte folgen (Kap. 8.4, Meilenstein 9).
- `firmware` bleibt `null`, weil die Bibliothek kein Firmware-Register beschreibt.
- Schreiben (0x06/0x10) kann der Client, der Verbindungstest nutzt es nie.

## Modbus-Simulator

`src/clients/modbus-simulator.ts` ist ein kleiner Modbus-TCP-Server für Tests (Registerabbild, Fehlerinjektion:
Timeout, Exception, Verbindung schließen, falsche Transaction-/Unit-/Protokoll-ID). Er stellt kein reales Gerät dar;
das Testmodell `src/test-model.ts` ist frei erfunden und gehört nicht in die Bibliothek.

## Miniserver

Der Miniserver-Client ist noch ein Mock (Arbeitspaket 8.6), bis ein Test-Miniserver bereitsteht.
