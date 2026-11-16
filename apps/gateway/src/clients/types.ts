/**
 * Schnittstellen zu Hardware. Modbus TCP ist nach der öffentlichen Spezifikation umgesetzt
 * (clients/modbus-tcp.ts); der Miniserver-Client folgt mit einem Test-Miniserver (ADR 0008),
 * bis dahin gibt es dafür nur den Mock.
 * Bewusst KEINE Register-/Adressannahmen: Adressen kommen aus der Wallbox-Bibliothek
 * bzw. aus dem Loxone-Export und werden vom Aufrufer übergeben.
 */

export interface ModbusEndpoint {
  host: string;
  port: number;
  unitId: number;
}

/**
 * Modbus-Zugriff. Adressen sind PDU-Adressen (0-basiert, 0–65535), wie sie im Protokoll
 * übertragen werden. Werte sind 16-Bit-Register (0–65535); Typumwandlung macht der Aufrufer.
 */
export interface ModbusClient {
  /** Funktionscode 0x03 (Read Holding Registers). */
  readHoldingRegisters(endpoint: ModbusEndpoint, address: number, count: number): Promise<number[]>;
  /** Funktionscode 0x04 (Read Input Registers). */
  readInputRegisters(endpoint: ModbusEndpoint, address: number, count: number): Promise<number[]>;
  /** Funktionscode 0x06 (Write Single Register). */
  writeSingleRegister(endpoint: ModbusEndpoint, address: number, value: number): Promise<void>;
  /** Funktionscode 0x10 (Write Multiple Registers). */
  writeMultipleRegisters(
    endpoint: ModbusEndpoint,
    address: number,
    values: number[],
  ): Promise<void>;
  /** Offene Verbindungen schließen (optional; Mocks haben keine). */
  close?(): Promise<void>;
}

export type MiniserverConnection = 'disconnected' | 'connecting' | 'connected';

export interface MiniserverClient {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  readonly state: MiniserverConnection;
  /** Wert eines Bausteins/Eingangs lesen. `address` ist Miniserver-seitig definiert (TODO(verify), ADR 0008). */
  readValue(address: string): Promise<number | string>;
  /** Virtuellen Eingang setzen und zurücklesen; `confirmed` ist true, wenn Rücklesewert == Sollwert. */
  setVirtualInput(
    address: string,
    value: number,
  ): Promise<{ readBack: number; confirmed: boolean }>;
}
