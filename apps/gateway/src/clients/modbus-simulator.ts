import { createServer, type AddressInfo, type Server, type Socket } from 'node:net';
import {
  EXCEPTION_FLAG,
  FunctionCode,
  MAX_READ_REGISTERS,
  MAX_WRITE_REGISTERS,
  encodeFrame,
  registersFrom,
  scanFrame,
  type MbapFrame,
} from './modbus-frame';

/**
 * Modbus-TCP-Simulator für Tests und lokale Entwicklung (kein reales Gerät).
 * Unterstützt 0x03, 0x04, 0x06, 0x10 nach Modbus Application Protocol V1.1b3. Unbelegte Adressen
 * ergeben Exception 0x02, unbekannte Funktionscodes 0x01.
 *
 * Fehlerinjektion (`fault`), jeweils für die nächsten `times` Anfragen (Standard: alle):
 * - `timeout`: Anfrage wird nicht beantwortet.
 * - `exception`: Exception-Antwort mit `code`.
 * - `close`: Verbindung wird ohne Antwort geschlossen.
 * - `wrongTransactionId`: Antwort mit falscher Transaction-ID.
 * - `wrongUnitId`, `wrongProtocolId`: Antwort mit verfälschtem Header.
 */
export type SimulatorFault =
  | { kind: 'timeout' }
  | { kind: 'exception'; code: number }
  | { kind: 'close' }
  | { kind: 'wrongTransactionId' }
  | { kind: 'wrongUnitId' }
  | { kind: 'wrongProtocolId' };

export interface SimulatorRequest {
  unitId: number;
  functionCode: number;
  address: number;
  count: number;
}

export interface ModbusSimulatorOptions {
  holding?: Record<number, number>;
  input?: Record<number, number>;
  /** Nur diese Unit-ID beantworten (andere: keine Antwort). Ohne Angabe: alle. */
  unitId?: number;
  /** Antwortverzögerung in ms. */
  delayMs?: number;
}

export class ModbusSimulator {
  readonly holding = new Map<number, number>();
  readonly input = new Map<number, number>();
  /** Protokoll aller Anfragen (für Tests: „nie geschrieben“). */
  readonly requests: SimulatorRequest[] = [];
  /** Anzahl angenommener TCP-Verbindungen. */
  connections = 0;
  unitId: number | undefined;
  delayMs: number;
  private fault: { fault: SimulatorFault; remaining: number } | undefined;
  private readonly server: Server;
  private readonly sockets = new Set<Socket>();

  constructor(options: ModbusSimulatorOptions = {}) {
    for (const [a, v] of Object.entries(options.holding ?? {})) this.holding.set(Number(a), v);
    for (const [a, v] of Object.entries(options.input ?? {})) this.input.set(Number(a), v);
    this.unitId = options.unitId;
    this.delayMs = options.delayMs ?? 0;
    this.server = createServer((socket) => this.accept(socket));
  }

  /** Startet auf 127.0.0.1; Port 0 = freier Port. Liefert den Port. */
  async start(port = 0): Promise<number> {
    await new Promise<void>((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(port, '127.0.0.1', () => resolve());
    });
    return (this.server.address() as AddressInfo).port;
  }

  async stop(): Promise<void> {
    for (const s of this.sockets) s.destroy();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  /** Fehler für die nächsten `times` Anfragen einspielen (ohne Angabe: dauerhaft). */
  inject(fault: SimulatorFault, times = Number.POSITIVE_INFINITY): void {
    this.fault = { fault, remaining: times };
  }

  clearFault(): void {
    this.fault = undefined;
  }

  get writes(): SimulatorRequest[] {
    return this.requests.filter(
      (r) =>
        r.functionCode === FunctionCode.WriteSingleRegister ||
        r.functionCode === FunctionCode.WriteMultipleRegisters,
    );
  }

  private accept(socket: Socket): void {
    this.connections++;
    this.sockets.add(socket);
    socket.on('close', () => this.sockets.delete(socket));
    socket.on('error', () => socket.destroy());
    let buffer: Buffer = Buffer.alloc(0);
    socket.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      for (;;) {
        const scan = scanFrame(buffer);
        if (scan.kind === 'incomplete') return;
        if (scan.kind === 'invalid') {
          socket.destroy();
          return;
        }
        buffer = scan.rest;
        this.handle(socket, scan.frame);
      }
    });
  }

  private takeFault(): SimulatorFault | undefined {
    if (!this.fault) return undefined;
    const { fault } = this.fault;
    this.fault.remaining--;
    if (this.fault.remaining <= 0) this.fault = undefined;
    return fault;
  }

  private handle(socket: Socket, frame: MbapFrame): void {
    const fn = frame.pdu.readUInt8(0);
    const address = frame.pdu.length >= 3 ? frame.pdu.readUInt16BE(1) : 0;
    const count =
      fn === FunctionCode.WriteSingleRegister
        ? 1
        : frame.pdu.length >= 5
          ? frame.pdu.readUInt16BE(3)
          : 0;
    this.requests.push({ unitId: frame.unitId, functionCode: fn, address, count });
    if (this.unitId !== undefined && frame.unitId !== this.unitId) return;

    const fault = this.takeFault();
    if (fault?.kind === 'timeout') return;
    if (fault?.kind === 'close') {
      socket.destroy();
      return;
    }
    const pdu =
      fault?.kind === 'exception' ? exception(fn, fault.code) : this.respond(fn, frame.pdu);
    let tid = frame.transactionId;
    let unit = frame.unitId;
    if (fault?.kind === 'wrongTransactionId') tid = (tid + 1000) & 0xffff;
    if (fault?.kind === 'wrongUnitId') unit = (unit + 1) & 0xff;
    let out = encodeFrame(tid, unit, pdu);
    if (fault?.kind === 'wrongProtocolId') {
      out = Buffer.from(out);
      out.writeUInt16BE(1, 2);
    }
    const send = () => {
      if (!socket.destroyed) socket.write(out);
    };
    if (this.delayMs > 0) setTimeout(send, this.delayMs);
    else send();
  }

  private respond(fn: number, pdu: Buffer): Buffer {
    switch (fn) {
      case FunctionCode.ReadHoldingRegisters:
      case FunctionCode.ReadInputRegisters: {
        if (pdu.length !== 5) return exception(fn, 0x03);
        const address = pdu.readUInt16BE(1);
        const count = pdu.readUInt16BE(3);
        if (count < 1 || count > MAX_READ_REGISTERS) return exception(fn, 0x03);
        const table = fn === FunctionCode.ReadHoldingRegisters ? this.holding : this.input;
        const values: number[] = [];
        for (let i = 0; i < count; i++) {
          const v = table.get(address + i);
          if (v === undefined) return exception(fn, 0x02);
          values.push(v);
        }
        const out = Buffer.alloc(2 + count * 2);
        out.writeUInt8(fn, 0);
        out.writeUInt8(count * 2, 1);
        values.forEach((v, i) => out.writeUInt16BE(v, 2 + i * 2));
        return out;
      }
      case FunctionCode.WriteSingleRegister: {
        if (pdu.length !== 5) return exception(fn, 0x03);
        const address = pdu.readUInt16BE(1);
        if (!this.holding.has(address)) return exception(fn, 0x02);
        this.holding.set(address, pdu.readUInt16BE(3));
        return Buffer.from(pdu);
      }
      case FunctionCode.WriteMultipleRegisters: {
        if (pdu.length < 6) return exception(fn, 0x03);
        const address = pdu.readUInt16BE(1);
        const count = pdu.readUInt16BE(3);
        const byteCount = pdu.readUInt8(5);
        if (count < 1 || count > MAX_WRITE_REGISTERS || byteCount !== count * 2)
          return exception(fn, 0x03);
        if (pdu.length !== 6 + byteCount) return exception(fn, 0x03);
        for (let i = 0; i < count; i++)
          if (!this.holding.has(address + i)) return exception(fn, 0x02);
        registersFrom(pdu.subarray(6)).forEach((v, i) => this.holding.set(address + i, v));
        return Buffer.from(pdu.subarray(0, 5));
      }
      default:
        return exception(fn, 0x01);
    }
  }
}

function exception(fn: number, code: number): Buffer {
  return Buffer.from([(fn | EXCEPTION_FLAG) & 0xff, code]);
}
