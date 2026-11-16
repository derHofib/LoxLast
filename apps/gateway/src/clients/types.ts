import type { MiniserverStatus } from '@lastplan/protocol';

/**
 * Schnittstellen zu Hardware. Modbus TCP ist nach der öffentlichen Spezifikation umgesetzt
 * (clients/modbus-tcp.ts), der Miniserver-Client nach der offiziellen Loxone-Doku
 * (clients/miniserver.ts, ADR 0008; am Test-Miniserver zu verifizieren).
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

export type MiniserverConnection = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface SetVirtualInputOptions {
  /**
   * UUID, unter der der Miniserver den Zustand meldet, falls sie von der Steuer-UUID abweicht
   * (Zuordnung über LoxAPP3.json). TODO(verify): bei virtuellen Eingängen am Test-Miniserver.
   */
  stateUuid?: string;
}

export interface MiniserverClient {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  /** Nach geänderten Zugangsdaten neu verbinden (optional; Mocks haben es nicht). */
  restart?(): Promise<void>;
  readonly state: MiniserverConnection;
  /** Zuletzt gemeldeten Wert lesen. `address` ist die Loxone-UUID (Zustand aus den Status-Events). */
  readValue(address: string): Promise<number | string>;
  /** Virtuellen Eingang setzen und zurücklesen; `confirmed` ist true, wenn Rücklesewert == Sollwert. */
  setVirtualInput(
    address: string,
    value: number,
    options?: SetVirtualInputOptions,
  ): Promise<{ readBack: number; confirmed: boolean }>;
}

/** Ein Wert-Event des Miniservers (UUID + Double). */
export interface LiveValue {
  uuid: string;
  value: number;
}

/**
 * Quelle für Live-Werte im Gateway (Plan 8.6 → 9.x). Die Live-Ansicht bekommt die Werte über
 * `packages/protocol/src/live.ts`; diese Schnittstelle bleibt im Gateway.
 */
export interface LiveValueSource {
  /** Verbindungsstatus inkl. Zeitpunkt der letzten Werte. */
  readonly status: MiniserverStatus;
  /** Letzter bekannter Wert je UUID (`undefined`: noch nie gemeldet). */
  latest(uuid: string): number | string | undefined;
  /** Wert-Events abonnieren; Rückgabe meldet ab. */
  onValues(listener: (values: readonly LiveValue[], at: Date) => void): () => void;
  /** Statuswechsel abonnieren; Rückgabe meldet ab. */
  onStatus(listener: (status: MiniserverStatus) => void): () => void;
}
