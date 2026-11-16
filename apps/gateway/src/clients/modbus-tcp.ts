import { Socket } from 'node:net';
import { backoffDelayMs } from '../backoff';
import {
  EXCEPTION_FLAG,
  FunctionCode,
  MAX_READ_REGISTERS,
  MAX_WRITE_REGISTERS,
  MODBUS_PROTOCOL_ID,
  encodeFrame,
  readRequestPdu,
  registersFrom,
  scanFrame,
  writeMultipleRequestPdu,
  writeSingleRequestPdu,
  type MbapFrame,
} from './modbus-frame';
import type {
  ModbusError} from './modbus-errors';
import {
  ModbusConnectionError,
  ModbusExceptionError,
  ModbusProtocolError,
  ModbusTimeoutError,
} from './modbus-errors';
import type { ModbusClient, ModbusEndpoint } from './types';

/**
 * Modbus-TCP-Client nach den öffentlichen Spezifikationen von modbus.org:
 * „MODBUS Application Protocol Specification V1.1b3“ und
 * „MODBUS Messaging on TCP/IP Implementation Guide V1.0b“ (Details in modbus-frame.ts).
 *
 * - Eine TCP-Verbindung je Host:Port; Anfragen darauf laufen nacheinander (viele Wallboxen
 *   bearbeiten nur eine Anfrage gleichzeitig). Die Verbindung wird nach `idleMs` ohne Anfrage
 *   geschlossen.
 * - Jede Anfrage hat ein Timeout. Nach einem Timeout wird die Verbindung verworfen, damit eine
 *   verspätete Antwort keiner späteren Anfrage zugeordnet wird.
 * - Antworten werden über die Transaction-ID zugeordnet; fremde IDs werden verworfen.
 * - Verbindungsfehler und Timeouts werden mit exponentiellem Backoff wiederholt (Kap. 8.4),
 *   Exception-Antworten und Protokollfehler nicht (das Gerät hat geantwortet).
 */
export interface ModbusTcpOptions {
  /** Zeit für Verbindungsaufbau und je Antwort. Standard 2000 ms. */
  timeoutMs?: number;
  /** Wiederholungen nach Verbindungsfehler/Timeout. Standard 2. */
  retries?: number;
  /** Basis für das Backoff zwischen Wiederholungen. Standard 200 ms. */
  retryBaseMs?: number;
  /** Obergrenze für das Backoff. Standard 2000 ms. */
  retryMaxMs?: number;
  /** Leerlaufzeit, nach der eine Verbindung geschlossen wird. Standard 5000 ms. */
  idleMs?: number;
}

interface Pending {
  transactionId: number;
  unitId: number;
  functionCode: number;
  resolve: (pdu: Buffer) => void;
  reject: (error: ModbusError) => void;
}

const where = (e: ModbusEndpoint): string => `${e.host}:${e.port} (Unit-ID ${e.unitId})`;

function connectErrorMessage(e: ModbusEndpoint, code: string | undefined): string {
  switch (code) {
    case 'ECONNREFUSED':
      return `Verbindung zu ${e.host}:${e.port} abgelehnt. Läuft Modbus TCP am Gerät und stimmt der Port?`;
    case 'EHOSTUNREACH':
    case 'ENETUNREACH':
      return `${e.host} ist im Netz nicht erreichbar. IP-Adresse und Netzwerk (VLAN, Routing) prüfen.`;
    case 'ECONNRESET':
      return `Verbindung zu ${e.host}:${e.port} wurde vom Gerät zurückgesetzt.`;
    default:
      return `Verbindung zu ${e.host}:${e.port} fehlgeschlagen${code ? ` (${code})` : ''}.`;
  }
}

/** Eine TCP-Verbindung mit Rahmenpuffer und höchstens einer offenen Anfrage. */
class Connection {
  private socket: Socket | undefined;
  private connecting: Promise<void> | undefined;
  private buffer: Buffer = Buffer.alloc(0);
  private pending: Pending | undefined;
  private idleTimer: NodeJS.Timeout | undefined;
  private queue: Promise<unknown> = Promise.resolve();
  closed = false;
  /** Zuletzt verworfene Transaction-ID (für die Fehlermeldung bei Timeout). */
  private discardedId: number | undefined;

  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly opts: Required<ModbusTcpOptions>,
    private readonly onClosed: (c: Connection) => void,
  ) {}

  /** Anfragen nacheinander ausführen. */
  enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private open(endpoint: ModbusEndpoint): Promise<void> {
    if (this.socket && !this.connecting) return Promise.resolve();
    if (this.connecting) return this.connecting;
    const socket = new Socket();
    this.socket = socket;
    socket.setNoDelay(true);
    this.connecting = new Promise<void>((resolve, reject) => {
      let connected = false;
      const timer = setTimeout(() => {
        reject(
          new ModbusTimeoutError(
            `Keine Verbindung zu ${endpoint.host}:${endpoint.port} innerhalb von ${this.opts.timeoutMs} ms. IP-Adresse und Port prüfen.`,
            false,
          ),
        );
        this.destroy();
      }, this.opts.timeoutMs);
      socket.once('connect', () => {
        connected = true;
        clearTimeout(timer);
        resolve();
      });
      socket.on('data', (chunk: Buffer) => this.onData(chunk));
      socket.on('error', (error: NodeJS.ErrnoException) => {
        clearTimeout(timer);
        const failure = new ModbusConnectionError(
          connectErrorMessage(endpoint, error.code),
          connected,
          error.code,
        );
        if (!connected) reject(failure);
        this.fail(failure);
      });
      socket.on('close', () => {
        clearTimeout(timer);
        const failure = new ModbusConnectionError(
          `Gerät ${endpoint.host}:${endpoint.port} hat die Verbindung geschlossen.`,
          connected,
        );
        if (!connected) reject(failure);
        this.fail(failure);
      });
      socket.connect({ host: this.host, port: this.port });
    }).finally(() => {
      this.connecting = undefined;
    });
    return this.connecting;
  }

  async request(endpoint: ModbusEndpoint, transactionId: number, pdu: Buffer): Promise<Buffer> {
    if (this.closed) throw new ModbusConnectionError('Verbindung ist geschlossen.', false);
    clearTimeout(this.idleTimer);
    await this.open(endpoint);
    const socket = this.socket;
    if (!socket || this.closed) {
      throw new ModbusConnectionError(
        `Verbindung zu ${endpoint.host}:${endpoint.port} ist nicht offen.`,
        false,
      );
    }
    this.discardedId = undefined;
    const response = new Promise<Buffer>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = undefined;
        const mismatch =
          this.discardedId === undefined
            ? ''
            : ` Eine Antwort mit fremder Transaction-ID ${this.discardedId} wurde verworfen.`;
        reject(
          new ModbusTimeoutError(
            `Keine Antwort von ${where(endpoint)} innerhalb von ${this.opts.timeoutMs} ms. Unit-ID und Modbus-Freigabe am Gerät prüfen.${mismatch}`,
            true,
          ),
        );
        // Verspätete Antworten dürfen keiner späteren Anfrage zugeordnet werden.
        this.destroy();
      }, this.opts.timeoutMs);
      this.pending = {
        transactionId,
        unitId: endpoint.unitId,
        functionCode: pdu.readUInt8(0),
        resolve: (p) => {
          clearTimeout(timer);
          resolve(p);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      };
    });
    socket.write(encodeFrame(transactionId, endpoint.unitId, pdu));
    try {
      return await response;
    } finally {
      this.armIdle();
    }
  }

  private armIdle(): void {
    if (this.closed) return;
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.destroy(), this.opts.idleMs);
    this.idleTimer.unref();
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const scan = scanFrame(this.buffer);
      if (scan.kind === 'incomplete') return;
      if (scan.kind === 'invalid') {
        this.fail(new ModbusProtocolError(`Ungültige Antwort vom Gerät: ${scan.reason}.`));
        this.destroy();
        return;
      }
      this.buffer = scan.rest;
      this.onFrame(scan.frame);
    }
  }

  private onFrame(frame: MbapFrame): void {
    const pending = this.pending;
    // Transaction-ID-Prüfung (Implementation Guide 3.1.3): nur die eigene Antwort annehmen.
    if (!pending || frame.transactionId !== pending.transactionId) {
      this.discardedId = frame.transactionId;
      return;
    }
    this.pending = undefined;
    if (frame.protocolId !== MODBUS_PROTOCOL_ID) {
      pending.reject(
        new ModbusProtocolError(
          `Antwort mit Protokoll-ID ${frame.protocolId} statt 0 – das Gerät spricht kein Modbus TCP.`,
        ),
      );
      return;
    }
    if (frame.unitId !== pending.unitId) {
      pending.reject(
        new ModbusProtocolError(
          `Antwort von Unit-ID ${frame.unitId}, angefragt war ${pending.unitId}.`,
        ),
      );
      return;
    }
    const fn = frame.pdu.readUInt8(0);
    if (fn === (pending.functionCode | EXCEPTION_FLAG)) {
      if (frame.pdu.length !== 2) {
        pending.reject(new ModbusProtocolError('Exception-Antwort hat eine ungültige Länge.'));
        return;
      }
      pending.reject(new ModbusExceptionError(pending.functionCode, frame.pdu.readUInt8(1)));
      return;
    }
    if (fn !== pending.functionCode) {
      pending.reject(
        new ModbusProtocolError(
          `Antwort mit Funktionscode ${fn}, angefragt war ${pending.functionCode}.`,
        ),
      );
      return;
    }
    pending.resolve(frame.pdu);
  }

  private fail(error: ModbusError): void {
    const pending = this.pending;
    this.pending = undefined;
    pending?.reject(error);
    this.destroy();
  }

  destroy(): void {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.idleTimer);
    this.socket?.destroy();
    this.onClosed(this);
  }
}

function assertInt(name: string, value: number, min: number, max: number): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} muss eine ganze Zahl von ${min} bis ${max} sein (ist ${value}).`);
  }
}

function assertRange(endpoint: ModbusEndpoint, address: number, count: number, max: number): void {
  assertInt('Port', endpoint.port, 1, 65535);
  assertInt('Unit-ID', endpoint.unitId, 0, 255);
  assertInt('Registeradresse', address, 0, 65535);
  assertInt('Registeranzahl', count, 1, max);
  if (address + count > 65536) {
    throw new RangeError('Registerbereich überschreitet Adresse 65535.');
  }
}

const isRetryable = (e: unknown): boolean =>
  e instanceof ModbusConnectionError || e instanceof ModbusTimeoutError;

export class ModbusTcpClient implements ModbusClient {
  private readonly opts: Required<ModbusTcpOptions>;
  private readonly connections = new Map<string, Connection>();
  private transactionId = 0;

  constructor(options: ModbusTcpOptions = {}) {
    this.opts = {
      timeoutMs: options.timeoutMs ?? 2000,
      retries: options.retries ?? 2,
      retryBaseMs: options.retryBaseMs ?? 200,
      retryMaxMs: options.retryMaxMs ?? 2000,
      idleMs: options.idleMs ?? 5000,
    };
  }

  /** 1 … 65535, danach wieder 1 (0 bleibt frei, um Verwechslungen mit leeren Puffern zu vermeiden). */
  private nextTransactionId(): number {
    this.transactionId = (this.transactionId % 0xffff) + 1;
    return this.transactionId;
  }

  private connection(endpoint: ModbusEndpoint): Connection {
    const key = `${endpoint.host}:${endpoint.port}`;
    let c = this.connections.get(key);
    if (!c || c.closed) {
      c = new Connection(endpoint.host, endpoint.port, this.opts, (closed) => {
        if (this.connections.get(key) === closed) this.connections.delete(key);
      });
      this.connections.set(key, c);
    }
    return c;
  }

  /** Eine Anfrage mit Wiederholung bei Verbindungsfehler oder Timeout. */
  private async send(endpoint: ModbusEndpoint, pdu: Buffer): Promise<Buffer> {
    for (let attempt = 0; ; attempt++) {
      const connection = this.connection(endpoint);
      try {
        return await connection.enqueue(() =>
          connection.request(endpoint, this.nextTransactionId(), pdu),
        );
      } catch (error) {
        if (!isRetryable(error) || attempt >= this.opts.retries) throw error;
        const wait = backoffDelayMs(attempt, {
          baseMs: this.opts.retryBaseMs,
          maxMs: this.opts.retryMaxMs,
        });
        await new Promise((resolve) => setTimeout(resolve, wait));
      }
    }
  }

  private async read(
    fn: number,
    endpoint: ModbusEndpoint,
    address: number,
    count: number,
  ): Promise<number[]> {
    assertRange(endpoint, address, count, MAX_READ_REGISTERS);
    const pdu = await this.send(endpoint, readRequestPdu(fn, address, count));
    const byteCount = pdu.length >= 2 ? pdu.readUInt8(1) : -1;
    if (byteCount !== count * 2 || pdu.length !== 2 + byteCount) {
      throw new ModbusProtocolError(
        `Antwort enthält ${Math.max(0, byteCount) / 2} statt ${count} Register.`,
      );
    }
    return registersFrom(pdu.subarray(2));
  }

  readHoldingRegisters(endpoint: ModbusEndpoint, address: number, count: number) {
    return this.read(FunctionCode.ReadHoldingRegisters, endpoint, address, count);
  }

  readInputRegisters(endpoint: ModbusEndpoint, address: number, count: number) {
    return this.read(FunctionCode.ReadInputRegisters, endpoint, address, count);
  }

  async writeSingleRegister(endpoint: ModbusEndpoint, address: number, value: number) {
    assertRange(endpoint, address, 1, 1);
    assertInt('Registerwert', value, 0, 65535);
    const request = writeSingleRequestPdu(address, value);
    const pdu = await this.send(endpoint, request);
    // Kap. 6.6: Die normale Antwort ist ein Echo der Anfrage.
    if (!pdu.equals(request)) {
      throw new ModbusProtocolError('Antwort auf Write Single Register ist kein Echo der Anfrage.');
    }
  }

  async writeMultipleRegisters(endpoint: ModbusEndpoint, address: number, values: number[]) {
    assertRange(endpoint, address, values.length, MAX_WRITE_REGISTERS);
    values.forEach((v) => assertInt('Registerwert', v, 0, 65535));
    const pdu = await this.send(endpoint, writeMultipleRequestPdu(address, values));
    // Kap. 6.12: Antwort enthält Startadresse und Anzahl.
    if (
      pdu.length !== 5 ||
      pdu.readUInt16BE(1) !== address ||
      pdu.readUInt16BE(3) !== values.length
    ) {
      throw new ModbusProtocolError(
        'Antwort auf Write Multiple Registers passt nicht zu Adresse und Anzahl der Anfrage.',
      );
    }
  }

  async close(): Promise<void> {
    for (const c of [...this.connections.values()]) c.destroy();
    this.connections.clear();
  }
}
