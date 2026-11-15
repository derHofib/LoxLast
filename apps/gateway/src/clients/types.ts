/**
 * Schnittstellen zu Hardware. Echte Implementierungen folgen, sobald Test-Miniserver und
 * Test-Wallbox verfügbar sind (ADR 0007). Bis dahin gibt es nur Mocks für Tests.
 * Bewusst KEINE Register-/Adressannahmen: Adressen kommen aus der Wallbox-Bibliothek
 * bzw. aus dem Loxone-Export und werden vom Aufrufer übergeben.
 */

export interface ModbusEndpoint {
  host: string;
  port: number;
  unitId: number;
}

export interface ModbusClient {
  readHoldingRegisters(endpoint: ModbusEndpoint, address: number, count: number): Promise<number[]>;
  writeSingleRegister(endpoint: ModbusEndpoint, address: number, value: number): Promise<void>;
}

export type MiniserverConnection = 'disconnected' | 'connecting' | 'connected';

export interface MiniserverClient {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  readonly state: MiniserverConnection;
  /** Wert eines Bausteins/Eingangs lesen. `address` ist Miniserver-seitig definiert (TODO(verify), ADR 0007). */
  readValue(address: string): Promise<number | string>;
  /** Virtuellen Eingang setzen und zurücklesen; `confirmed` ist true, wenn Rücklesewert == Sollwert. */
  setVirtualInput(
    address: string,
    value: number,
  ): Promise<{ readBack: number; confirmed: boolean }>;
}
