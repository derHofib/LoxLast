# 0008 – Anbindung des Miniservers im Gateway

**Status:** Annahme · 2026-11-15 (Empfehlung, vom Auftraggeber noch nicht bestätigt)

## Kontext

Das LastPlan-Gateway (Node 22, TypeScript, ESM, Fastify) soll mit dem Loxone Miniserver sprechen: Verbindung per WebSocket, Events empfangen, virtuelle Eingänge setzen, Werte zurücklesen. Es gilt das Prinzip „nur offizielle Wege“. Zur Wahl stehen:

- **A:** die Loxone-Bibliothek LxCommunicator (npm `lxcommunicator`) einbinden.
- **B:** eine eigene, schlanke Implementierung nach der offiziellen Doku „Communicating with the Miniserver“.

Recherchestand (Quellen siehe unten, Abruf 2026-11-15):

**LxCommunicator**

- Lizenz: MIT.
- Das Repository ist seit **3. Dezember 2024 archiviert** (nur lesbar). Der README sagt ausdrücklich, das Projekt werde nicht mehr gepflegt, sei „not up to date with the latest additions to our API“, Loxone leiste keinen Support und verweise auf die offizielle API-Doku.
- Version: README nennt v1.0.1, `package.json` auf GitHub nennt 1.1.1. TODO(verify): tatsächlich neueste npm-Version und Veröffentlichungsdatum (npm-Seite lieferte nur 1.0.1 ohne Datum).
- Abhängigkeiten laut `package.json`: u. a. `axios ^0.18.1`, `crypto-js ^3.1.9-1`, `node-jsencrypt`, `websocket`, `q`, `when`, `moment`, `browserify`, `uglify-js`, `derequire`; `postinstall` führt `node ./browserify.js` aus. Veraltete Versionen, Build-Werkzeuge als Laufzeitabhängigkeit, Skript beim Installieren. TODO(verify): bekannte Schwachstellen (`npm audit`) der Abhängigkeiten.
- Modulformat: Beispiele nutzen CommonJS (`require`). Typdefinitionen und ESM sind im README nicht erwähnt. TODO(verify): Existenz von `.d.ts`, Kompatibilität mit Node 22.
- Token-Auth/JWT: im README nicht erwähnt. TODO(verify): ob der Code `getjwt`/`refreshjwt` unterstützt oder nur die in Config 9.3 entfernte Altauthentifizierung.
- TLS (`https`/`wss`) nur für Miniserver Generation 2 beschrieben; Cloud-DNS-URL-Schema (`*.dyndns.loxonecloud.com`) wird im README gezeigt.
- Tests: Ordner `test/`, `npm test` führt `./test/index.js` aus. Sie benötigen vermutlich einen echten Miniserver. TODO(verify).

**Offizielle Doku „Communicating with the Miniserver“** (Version 16.0, Stand 2025.06.03; es existiert auch eine Ausgabe vom April 2026, nicht ausgewertet. TODO(verify): Unterschiede):

- Authentifizierung per Token/JWT: `jdev/sys/getkey2/{user}` liefert Key, Salt und Hash-Algorithmus (HMAC-SHA1 oder HMAC-SHA256). Token über `jdev/sys/getjwt/{hash}/{user}/{permission}/{uuid}/{info}` (verschlüsselt anzufordern). Berechtigung Web (2, kurzlebig) oder App (4, mehrere Wochen). Anmeldung per `authwithtoken`. Erneuern: `refreshjwt`, prüfen: `checktoken`, widerrufen: `killtoken`. `validUntil` zählt Sekunden seit 1. Januar 2009.
- Verschlüsselung: Gen 2 und Compact über HTTPS/WSS, ab Config 11.2 ist zusätzliche Anwendungsverschlüsselung bei TLS optional. Gen 1 ohne volles TLS: RSA-Schlüsselaustausch plus AES-256-CBC (`jdev/sys/enc`, `fenc`, `keyexchange`, rotierender Salt).
- Cloud DNS: Auflösung über `dns.loxonecloud.com/?getip&snr={SNR}&json=true`, die WebSocket-Weiterleitung funktioniert nicht mit CloudDNS, die Adresse ist vorher aufzulösen. Zertifikate gelten für Hostnamen, nicht IPs. Remote Connect extern nur Gen 2.
- WebSocket: `ws(s)://{ip}:{port}/ws/rfc6455`, Subprotokoll `remotecontrol`, 8-Byte-Header (Typ 0 Text, 1 Datei, 2/3/4/7 Event-Tabellen, 5 außer Betrieb, 6 Keepalive), Wert-Event = 16 Byte UUID + Double. Keepalive nötig (Server trennt nach 5 Minuten Inaktivität). Grenzen: 31 Clients mit Live-Updates, HTTP-Verbindungen 48 (Gen 1) bzw. 256 (Gen 2).
- Steuern: `jdev/sps/io/{uuid}/{command}` (Steuerung per UUID). Zurücklesen/Events: `jdev/sps/enablebinstatusupdate`, Zuordnung UUID zu Bausteinen über `data/LoxAPP3.json`, Änderungsprüfung via `jdev/sps/LoxAPPversion3`.
- Offen in der Doku (TODO(verify)): konkretes Setzen virtueller Eingänge (Adressierung per Name vs. UUID, Rückgabecodes), Verhalten bei Ratenlimits (kein eigener Abschnitt vorhanden), Größe/Aufbau der Antwort bei Strukturdatei.

## Entscheidung

Das Gateway definiert ein Interface **`MiniserverClient`** (Verbinden/Trennen, Events abonnieren, virtuellen Eingang setzen, Wert lesen, Verbindungsstatus). Der Rest des Gateways hängt nur an diesem Interface.

- **Jetzt:** ein `MockMiniserverClient` (im Speicher, deterministisch, für Tests und Entwicklung). Es wird nichts gegen einen echten Miniserver implementiert.
- **Später (sobald ein Test-Miniserver verfügbar ist):** eine **eigene Implementierung** (Option B) nach der offiziellen Doku, mit JWT-Token-Auth, WSS auf Gen 2 und den dokumentierten Binär-Events. Gen 1 und Verschlüsselung per RSA/AES nur, falls ein Gen-1-Gerät tatsächlich gebraucht wird (TODO(verify): Bedarf). `lxcommunicator` wird **nicht** als Abhängigkeit aufgenommen; der Quelltext darf höchstens als Lesehilfe dienen (MIT-Lizenz erlaubt das), die Doku bleibt maßgeblich.
- Die Entscheidung wird erneut geprüft, falls Loxone eine gepflegte offizielle Bibliothek veröffentlicht.

## Alternativen

- **LxCommunicator einbinden.** Vorteile: Auth- und Verschlüsselungscode schon vorhanden, MIT. Nachteile: archiviert und laut Loxone nicht mehr aktuell, nicht gepflegt, ohne Support, veraltete Abhängigkeiten, `postinstall`-Skript, CommonJS ohne belegte Typen, JWT-Unterstützung nicht belegt. Passt formal zu „offiziell“ (Loxone-Repository), faktisch aber nicht zu einem langlebigen Gateway.
- **Fork/Vendoring von LxCommunicator.** Würde die Wartung des Altcodes zu uns verlagern, ohne dass wir die Protokolldetails kennen.
- **Inoffizielle Community-Bibliotheken.** Widersprechen dem Prinzip „nur offizielle Wege“ und werden nicht betrachtet.
- **Nur HTTP statt WebSocket** (`jdev/sps/io`, Polling). Einfacher, liefert aber keine Events. Als Rückfall denkbar, nicht als Ziel.

## Folgen

- Mehr Eigenaufwand: Token-Handling (getkey2, getjwt, Refresh, Ablauf), Binär-Parser für Event-Tabellen, Keepalive, Wiederverbindung, Cloud-DNS-Auflösung. Dafür volle Kontrolle, Typen, ESM, keine veralteten Abhängigkeiten, nur Node-Bordmittel (`crypto`, `WebSocket`/`ws` TODO(verify): Wahl der WS-Bibliothek).
- Zugangsdaten und Token werden nur im Gateway gehalten, nie im Client oder in Logs.
- Teststrategie: (1) Mock für Gateway-Logik. (2) Unit-Tests des Protokolls mit festen Byte-Fixtures (Header, Event-Tabellen) und Hash-Berechnungen gegen Vektoren aus der Doku, soweit dort vorhanden (TODO(verify)). (3) Ein lokaler Fake-WebSocket-Server, der Doku-Verhalten nachbildet. (4) Integrationstest gegen einen Test-Miniserver, nur manuell/opt-in, erst wenn verfügbar. Bis dahin gilt die echte Implementierung als unverifiziert.
- Risiko: Die Doku nennt keine Ratenlimits außer Anmelde-Sperren und Verbindungsgrenzen; Verhalten ist am Test-Miniserver zu messen.

## Quellen

- https://github.com/Loxone/lxcommunicator (README, Archivhinweis, Lizenz)
- https://github.com/Loxone/lxcommunicator/blob/master/package.json
- https://www.npmjs.com/package/lxcommunicator
- https://www.loxone.com/wp-content/uploads/datasheets/CommunicatingWithMiniserver.pdf (Version 16.0, 2025.06.03)
- https://www.loxone.com/enen/wp-content/uploads/sites/3/2026/04/1700_Communicating-with-the-Miniserver.pdf (nicht ausgewertet)

Hinweis: Beide loxone.com-Links leiten auf Loxones eigenen Objektspeicher (`loxone-website-prod.nbg1.your-objectstorage.com`) weiter. Die Doku-Angaben stammen aus einer automatischen Zusammenfassung dieses PDFs und sind vor der Implementierung im Original gegenzulesen.
