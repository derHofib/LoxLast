import type { MiniserverClient, MiniserverConnection, ModbusClient, ModbusEndpoint } from './types';

const key = (e: ModbusEndpoint, address: number): string =>
  `${e.host}:${e.port}/${e.unitId}@${address}`;

/** In-Memory-Modbus für Tests. */
export class MockModbusClient implements ModbusClient {
  readonly registers = new Map<string, number>();

  seed(endpoint: ModbusEndpoint, address: number, values: number[]): void {
    values.forEach((v, i) => this.registers.set(key(endpoint, address + i), v));
  }

  async readHoldingRegisters(
    endpoint: ModbusEndpoint,
    address: number,
    count: number,
  ): Promise<number[]> {
    return Array.from({ length: count }, (_, i) => {
      const v = this.registers.get(key(endpoint, address + i));
      if (v === undefined) throw new Error(`Mock: Register ${address + i} nicht belegt`);
      return v;
    });
  }

  async writeSingleRegister(
    endpoint: ModbusEndpoint,
    address: number,
    value: number,
  ): Promise<void> {
    this.registers.set(key(endpoint, address), value);
  }
}

/** In-Memory-Miniserver für Tests. `dropWrites` simuliert einen Wert, der nicht übernommen wird. */
export class MockMiniserverClient implements MiniserverClient {
  state: MiniserverConnection = 'disconnected';
  readonly values = new Map<string, number | string>();
  dropWrites = false;

  async connect(): Promise<void> {
    this.state = 'connected';
  }
  async disconnect(): Promise<void> {
    this.state = 'disconnected';
  }
  async readValue(address: string): Promise<number | string> {
    this.assertConnected();
    const v = this.values.get(address);
    if (v === undefined) throw new Error(`Mock: Adresse „${address}“ unbekannt`);
    return v;
  }
  async setVirtualInput(
    address: string,
    value: number,
  ): Promise<{ readBack: number; confirmed: boolean }> {
    this.assertConnected();
    if (!this.dropWrites) this.values.set(address, value);
    const readBack = Number(this.values.get(address) ?? Number.NaN);
    return { readBack, confirmed: readBack === value };
  }
  private assertConnected(): void {
    if (this.state !== 'connected') throw new Error('Mock: Miniserver nicht verbunden');
  }
}
