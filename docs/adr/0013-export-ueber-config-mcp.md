# 0013 – Export und `.Loxone`-Analyse über den Config-MCP

**Status:** Vorschlag · 2026-11-16 (wartet auf Freigabe durch den Auftraggeber)

## Kontext

Meilenstein 6 (Export Modus A) und Meilenstein 7 (`.Loxone`-Analyse, Export Modus B) sollten bisher Loxone-Dateien selbst erzeugen bzw. einlesen. Beides hängt an Unterlagen, die noch fehlen: eine aus Config exportierte Modbus-Vorlage, `.Loxone`-Beispieldateien und die Config-Version. Ohne sie darf nach unserer Regel „Nichts erfinden“ kein XML geschrieben werden. Selbst mit Beispieldateien bliebe das Format undokumentiert, deshalb war Modus B im Plan ausdrücklich als Risiko markiert.

Loxone Config bringt inzwischen einen eigenen MCP-Server mit, den „LOXONE Config“-MCP. Grundlage dieser Bewertung ist allein die Selbstbeschreibung des Servers, die der Auftraggeber am 2026-11-16 aus seiner laufenden Config abgerufen hat. Sie umfasst `skill_read` mit allen Referenzen, `sdk_describe` sowie `get_doc` für die Modbus-Typen. Dabei wurden nur lesende Aufrufe gemacht. Die Rohdatei liegt bewusst nicht im Repository, weil sie einen Projektnamen aus einer Kundenanlage enthält.

### Was der Server laut Selbstbeschreibung kann

- **Ort und Transport.** `LoxoneConfig.exe` startet den Server selbst, sobald „Config MCP“ in der Titelleiste aktiviert ist. Er spricht Streamable HTTP auf `127.0.0.1:57707`. Er arbeitet auf dem **in Config geöffneten Projekt**, nicht auf dem Miniserver.
- **Zwei Skript-Werkzeuge.** `code_query` führt JavaScript nur lesend aus, `code_run` lesend und ändernd, jeweils gegen eine synchrone `cfg.*`-API. Jeder `code_run` ist genau ein Undo-Schritt. Separate Werkzeuge sind `save_project`, `undo`, `redo`, `get_doc`, `get_doc_resource`, `get_block_resource`, `sdk_describe` und `skill_read`.
- **Lesen.**
  - Projekt, Seiten, Räume, Kategorien, Bausteine samt Anschlüssen und Verbindungen: `get_block_index`, `get_block`, `get_connections`.
  - Peripheriebaum: `get_tree`.
  - Eigenschaften: `get_block_properties`, `get_property_options`.
  - Prüfung: `validate_project`, mit stabilen Regel-IDs wie `UNCONFIGURED_CONTROL` und `UNFINISHED_PERIPHERY`.
- **Ändern.**
  - Bausteine: `add_block`, `connect_blocks`, `set_block_property`, `set_block_data`, `set_default`, `remove_block`.
  - Seiten und Räume: `add_page`, `add_room`.
  - Layout: `arrange_page`.
  - Peripherie und Referenzen: `insert_object`, `add_object_ref`.
- **Modbus.**
  - Über `insert_object` einfügbar sind `ModbusDev` (Modbus-Gerät, Eigenschaft Geräteadresse = Unit ID), `ModbusASensor`, `ModbusSensor`, `ModbusAActor` und `ModbusActor`, außerdem `Comm485` (Variante Modbus Extension), `ModbusTree` und `ModbusAir`.
  - Laut `get_doc` haben die Sensoren und Aktoren die Eigenschaften IO-Adresse (ab 0), Befehl (Funktionscode), Datentyp, 16-Bit-Register, Wortreihenfolge, Byte-Reihenfolge und Abfragezyklus.
- **Bausteintyp Wallbox.** Der Typ `Wallbox` ist in der Referenz „Loxone standard“ genannt (Anhang A).
- **Simulation.** `sim_step`, `sim_run`, `sim_set_value`, `sim_set_time` und `get_runtime` lassen die Logik in Config ohne Miniserver laufen.

### Was nicht geht oder nicht dokumentiert ist

- **Modbus-TCP-Server kann nicht eingefügt werden.** Netzwerkgeräte lassen sich laut Referenz `periphery.md` nicht über `insert_object` anlegen („Other technologies (network, EnOcean) … cannot be inserted here“). Pro Wallbox muss also jemand den Modbus-TCP-Server von Hand in Config anlegen. Ob sich Eigenschaften wie die IP-Adresse eines bestehenden Servers per `set_block_property` setzen lassen, ist TODO(verify).
- **Modbus-Vorlagen aus der Loxone Library** lassen sich nicht einfügen: Ein Werkzeug dafür ist nicht dokumentiert.
- **Lastmanager-Baustein.** In der Liste der einfügbaren Peripherietypen gibt es keinen Treffer für „Last“ oder „Load“. Die Bausteintypen (`get_block_types`) wurden noch nicht abgefragt. TODO(verify): Typ-Schlüssel und `get_doc` des Lastmanager-Bausteins.
- **Versionen.** Weder die Config-Version noch die Version der Miniserver-Firmware wird von einem Werkzeug geliefert. TODO(verify): ob `get_actions` oder `get_project` etwas dazu enthält.
- **Anmeldung am Endpunkt.** Ob der Endpunkt Clients außer Claude annimmt und ob er eine Anmeldung verlangt, ist TODO(verify).

## Entscheidung (Vorschlag)

**LastPlan erzeugt keine Loxone-Dateien mehr selbst. Stattdessen setzt LastPlan seinen geprüften Plan über den Config-MCP in der geöffneten Config um.**

1. **Weg C: das Gateway als MCP-Client.** Das LastPlan-Gateway läuft auf demselben Rechner wie Config und spricht `127.0.0.1:57707` direkt an. Der Ablauf ist deterministisch und ohne Sprachmodell:
   - LastPlan erzeugt aus dem Projekt ein `code_run`-Skript.
   - Alle Bezeichner im Skript stammen zur Laufzeit aus `get_block_types`, `get_insertable_types` und `get_property_options`, nicht aus unserem Code.
   - Register, Datentypen und Wortreihenfolge kommen ausschließlich aus der Wallbox-Bibliothek. Fehlt ein Wert (`TODO(verify)`), bleibt der Export gesperrt, wie bisher.
   - Projektdaten verlassen den Rechner nicht.
2. **Weg B: Rückfall per Claude-Session.** LastPlan exportiert den Plan als JSON zusammen mit dem fertigen Skript. Eine Claude-Session mit Config-MCP führt beides aus. Dabei gehen Projektinhalte an das Modell, deshalb ist dieser Weg nur für Test- und eigene Projekte gedacht. Die Oberfläche weist darauf hin.
3. **Ablauf für den Nutzer.**
   - Vorschau: Was wird angelegt?
   - Der Nutzer legt die Modbus-TCP-Server an, solange das nicht automatisierbar ist. LastPlan liefert dafür eine Liste mit IP, Port und Unit ID je Wallbox.
   - Dann ein `code_run`, danach Prüfung mit `validate_project` und Zurücklesen.
   - Ergebnis anzeigen; mit `undo` lässt sich alles in einem Schritt zurücknehmen.
   - Gespeichert wird nur auf ausdrücklichen Klick (`save_project`).
4. **Einlesen statt Dateiparser (MS7).** Ein bestehendes Projekt wird über `code_query` gelesen: Bausteine, Modbus-Geräte und Verbindungen. Der `.Loxone`-Parser, der byte-gleiche Roundtrip und die Golden-File-Tests je Config-Version entfallen.
5. **Wiedererkennung.** Was LastPlan anlegt, trägt eine eigene Seite. Deren Kennung `lastplan:<projectId>:<structureHash>` steckt im Seitennamen oder einem Notiz-Baustein. Dadurch kann ein erneuter Lauf ersetzen statt duplizieren. TODO(verify): wo eine Kennung dauerhaft gespeichert werden kann.

## Alternativen

- **A: Dateien selbst erzeugen (bisheriger Plan).** Wartet weiter auf Unterlagen. Das Format ist undokumentiert, und das Risiko bei Versionswechseln ist hoch. Bleibt nur als Notlösung bestehen, falls der MCP nicht nutzbar ist, zum Beispiel ohne Windows-Rechner.
- **Nur Weg B.** Wenig Eigenaufwand, aber nicht deterministisch, Kundendaten gehen an ein Modell, und es widerspricht dem Grundsatz „keine externen Dienste“.

## Folgen

- MS6 und MS7 werden zu einem Meilenstein „Übergabe an Config“ zusammengelegt. Die Export-Ansicht aus PR #11, der `ExportRecord` und `structureHash` bleiben erhalten. Aus der `ExportGenerator`-Registry wird ein Skript-Erzeuger.
- **Betrieb mit VM (Fall des Auftraggebers):** Das Gateway läuft **in der Windows-VM**, neben Config. Die Web-App auf dem Mac koppelt sich wie bisher per Pairing an das Gateway (ADR 0009). Den MCP-Port per Portweiterleitung aus der VM heraus zu öffnen, lehnen wir ab: Der Endpunkt hat keine dokumentierte Anmeldung, und jeder im Netz könnte damit das Projekt ändern.
- **Neue Voraussetzungen:**
  - Config mit aktiviertem „Config MCP“ läuft auf einem Rechner, auf dem auch das Gateway läuft (Windows).
  - Für die Entwicklung braucht es ein **Testprojekt** in Config, keine Kundenanlage.
- **Entfallende Lieferungen:** `.Loxone`-Beispieldateien und die exportierte Modbus-Vorlage werden für den Hauptweg nicht mehr gebraucht.
- **Weiter nötig:** die ABL-Registerdoku (5.D). Ohne sie lassen sich keine Sensoren und Aktoren konfigurieren.
- **Tests:**
  - Ein MCP-Fake im Gateway, der die dokumentierten Antworten nachbildet.
  - Ein manueller Abnahmelauf gegen das Testprojekt.
  - Die Logik prüfen wir zusätzlich in der Config-Simulation (`sim_*`), noch bevor ein Test-Miniserver da ist.
- **Risiko:** Die MCP-Schnittstelle ist neu. Mit jeder Config-Version kann sie sich ändern. Deshalb wird beim Start `sdk_describe` gelesen. Fehlt eine erwartete Methode, sperrt LastPlan die Übergabe mit einer klaren Meldung.

## Vor der Umsetzung zu klären (nur lesend, am Testprojekt)

1. Liefert `get_block_types()` einen Lastmanager-Baustein? Wenn ja, `get_doc` für ihn und für `Wallbox`.
2. Hat ein Testprojekt einen von Hand angelegten Modbus-TCP-Server mit einer Wallbox? Wenn ja:
   - `get_block_properties` und `get_property_options` des Servers, des Modbus-Geräts und eines Analogsensors (Eigenschafts-IDs, Optionen für Befehl und Datentyp).
   - `get_insertable_types({ parent_uuid: <Server> })`.
3. Was liefern `get_actions()` und `get_project()`? Darin könnten Versionsangaben stecken.
4. Erreichbarkeit: Der Endpunkt lauscht nur auf `127.0.0.1` im Windows-System. Beim Auftraggeber läuft Config in einer Windows-VM auf dem Mac (Auskunft 2026-11-16). TODO(verify): ob das Gateway unter Windows läuft (Node 22, Pfade, Dienststart).

## Quellen

- Selbstbeschreibung des „LOXONE Config“-MCP (`skill_read`, Referenzen `periphery.md`, `inserting-objects.md`, `wiring.md`, `simulation.md`, `errors-and-actions.md`, `loxone-standard.md`; `sdk_describe`; `get_doc` für `ModbusDev`, `ModbusASensor`, `ModbusAActor`, `ModbusSensor`, `ModbusActor`, `ModbusTree`, `ModbusAir`, `Comm485`), abgerufen vom Auftraggeber am 2026-11-16.
