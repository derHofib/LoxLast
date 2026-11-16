/**
 * Fehlerarten des Modbus-TCP-Clients. Alle Meldungen sind deutsch und nennen, wo möglich,
 * einen Lösungsweg. Sie enthalten nur Host, Port und Unit-ID, keine Zugangsdaten.
 */

export type ModbusErrorKind = 'connection' | 'timeout' | 'exception' | 'protocol';

export abstract class ModbusError extends Error {
  abstract readonly kind: ModbusErrorKind;
  /** true, wenn die TCP-Verbindung zum Gerät bestand (Gerät also grundsätzlich erreichbar war). */
  abstract readonly connected: boolean;
}

/** TCP-Verbindung kam nicht zustande oder wurde vom Gerät getrennt. */
export class ModbusConnectionError extends ModbusError {
  readonly kind = 'connection';
  constructor(
    message: string,
    readonly connected: boolean,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ModbusConnectionError';
  }
}

/** Keine Verbindung bzw. keine passende Antwort innerhalb der Zeit. */
export class ModbusTimeoutError extends ModbusError {
  readonly kind = 'timeout';
  constructor(
    message: string,
    readonly connected: boolean,
  ) {
    super(message);
    this.name = 'ModbusTimeoutError';
  }
}

/**
 * Exception-Codes nach Modbus Application Protocol Specification V1.1b3, Kap. 7
 * („MODBUS Exception Responses“), mit deutscher Erklärung.
 */
export const MODBUS_EXCEPTION_TEXT: Readonly<Record<number, string>> = {
  0x01: 'Funktionscode wird vom Gerät nicht unterstützt (ILLEGAL FUNCTION)',
  0x02: 'Registeradresse ist im Gerät nicht vorhanden (ILLEGAL DATA ADDRESS)',
  0x03: 'Wert oder Anzahl wird vom Gerät nicht akzeptiert (ILLEGAL DATA VALUE)',
  0x04: 'Interner Fehler im Gerät (SERVER DEVICE FAILURE)',
  0x05: 'Gerät hat angenommen, Bearbeitung dauert noch (ACKNOWLEDGE)',
  0x06: 'Gerät ist beschäftigt, später erneut versuchen (SERVER DEVICE BUSY)',
  0x08: 'Speicher-Paritätsfehler im Gerät (MEMORY PARITY ERROR)',
  0x0a: 'Modbus-Gateway hat keinen Pfad zum Zielgerät (GATEWAY PATH UNAVAILABLE)',
  0x0b: 'Zielgerät hinter dem Modbus-Gateway antwortet nicht (GATEWAY TARGET DEVICE FAILED TO RESPOND)',
};

const hex = (n: number): string => `0x${n.toString(16).padStart(2, '0').toUpperCase()}`;

/** Das Gerät hat mit einer Exception-Antwort (Funktionscode | 0x80) geantwortet. */
export class ModbusExceptionError extends ModbusError {
  readonly kind = 'exception';
  readonly connected = true;
  constructor(
    readonly functionCode: number,
    readonly exceptionCode: number,
  ) {
    const text = MODBUS_EXCEPTION_TEXT[exceptionCode] ?? 'unbekannter Ausnahmecode';
    super(
      `Gerät meldet Modbus-Ausnahme ${hex(exceptionCode)} auf Funktion ${hex(functionCode)}: ${text}.`,
    );
    this.name = 'ModbusExceptionError';
  }
}

/** Antwort verletzt das Protokoll (falsche Länge, Protokoll-ID, Unit-ID, Funktionscode …). */
export class ModbusProtocolError extends ModbusError {
  readonly kind = 'protocol';
  readonly connected = true;
  constructor(message: string) {
    super(message);
    this.name = 'ModbusProtocolError';
  }
}
