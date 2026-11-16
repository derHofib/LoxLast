/**
 * Modbus-TCP-Rahmen (ADU = MBAP-Header + PDU).
 *
 * Grundlage (öffentlich, modbus.org):
 * - „MODBUS Messaging on TCP/IP Implementation Guide V1.0b“ (2006), Kap. 3.1.3 „MBAP Header
 *   description“: Transaction Identifier (2 Byte), Protocol Identifier (2 Byte, 0 = MODBUS),
 *   Length (2 Byte, Anzahl der folgenden Bytes inkl. Unit Identifier), Unit Identifier (1 Byte).
 *   Alle Felder Big-Endian. Maximale ADU-Größe 260 Byte, PDU höchstens 253 Byte.
 * - „MODBUS Application Protocol Specification V1.1b3“ (2012):
 *   Kap. 4.2 Datenkodierung Big-Endian; Kap. 6.3 (0x03 Read Holding Registers, 1–125 Register),
 *   6.4 (0x04 Read Input Registers, 1–125 Register), 6.6 (0x06 Write Single Register, Antwort ist
 *   ein Echo), 6.12 (0x10 Write Multiple Registers, 1–123 Register, Antwort Adresse + Anzahl),
 *   Kap. 7 Exception-Antwort: Funktionscode | 0x80, gefolgt von einem Byte Exception-Code.
 */

export const MBAP_HEADER_LENGTH = 7;
/** Kap. 3.1.3: Protocol Identifier 0 = MODBUS. */
export const MODBUS_PROTOCOL_ID = 0;
/** Implementation Guide Kap. 3.1.3: max. ADU 260 Byte → Length-Feld höchstens 254 (Unit-ID + 253 PDU). */
export const MAX_PDU_LENGTH = 253;

export const FunctionCode = {
  ReadHoldingRegisters: 0x03,
  ReadInputRegisters: 0x04,
  WriteSingleRegister: 0x06,
  WriteMultipleRegisters: 0x10,
} as const;
export type FunctionCode = (typeof FunctionCode)[keyof typeof FunctionCode];

/** Application Protocol V1.1b3, Kap. 6.3/6.4: Quantity of Registers 1 bis 125 (0x7D). */
export const MAX_READ_REGISTERS = 125;
/** Application Protocol V1.1b3, Kap. 6.12: Quantity of Registers 1 bis 123 (0x7B). */
export const MAX_WRITE_REGISTERS = 123;
/** Kap. 7: Exception-Antworten setzen das höchste Bit des Funktionscodes. */
export const EXCEPTION_FLAG = 0x80;

export interface MbapFrame {
  transactionId: number;
  protocolId: number;
  unitId: number;
  pdu: Buffer;
}

/** ADU bauen: MBAP-Header (7 Byte) + PDU. */
export function encodeFrame(transactionId: number, unitId: number, pdu: Buffer): Buffer {
  const header = Buffer.alloc(MBAP_HEADER_LENGTH);
  header.writeUInt16BE(transactionId & 0xffff, 0);
  header.writeUInt16BE(MODBUS_PROTOCOL_ID, 2);
  header.writeUInt16BE(pdu.length + 1, 4);
  header.writeUInt8(unitId & 0xff, 6);
  return Buffer.concat([header, pdu]);
}

export type FrameScan =
  | { kind: 'incomplete' }
  | { kind: 'frame'; frame: MbapFrame; rest: Buffer }
  | { kind: 'invalid'; reason: string };

/**
 * Ersten vollständigen Rahmen aus einem TCP-Puffer lösen. TCP liefert einen Bytestrom; ein Rahmen
 * kann auf mehrere Pakete verteilt sein oder mehrere Rahmen können in einem Paket liegen.
 */
export function scanFrame(buffer: Buffer): FrameScan {
  if (buffer.length < MBAP_HEADER_LENGTH) return { kind: 'incomplete' };
  const length = buffer.readUInt16BE(4);
  if (length < 2 || length > MAX_PDU_LENGTH + 1) {
    return { kind: 'invalid', reason: `Längenfeld ${length} im MBAP-Header ist ungültig` };
  }
  const total = 6 + length;
  if (buffer.length < total) return { kind: 'incomplete' };
  return {
    kind: 'frame',
    frame: {
      transactionId: buffer.readUInt16BE(0),
      protocolId: buffer.readUInt16BE(2),
      unitId: buffer.readUInt8(6),
      pdu: buffer.subarray(MBAP_HEADER_LENGTH, total),
    },
    rest: buffer.subarray(total),
  };
}

/** PDU für 0x03/0x04: Funktionscode, Startadresse (2), Anzahl (2). */
export function readRequestPdu(fn: number, address: number, count: number): Buffer {
  const pdu = Buffer.alloc(5);
  pdu.writeUInt8(fn, 0);
  pdu.writeUInt16BE(address, 1);
  pdu.writeUInt16BE(count, 3);
  return pdu;
}

/** PDU für 0x06: Funktionscode, Adresse (2), Wert (2). */
export function writeSingleRequestPdu(address: number, value: number): Buffer {
  const pdu = Buffer.alloc(5);
  pdu.writeUInt8(FunctionCode.WriteSingleRegister, 0);
  pdu.writeUInt16BE(address, 1);
  pdu.writeUInt16BE(value, 3);
  return pdu;
}

/** PDU für 0x10: Funktionscode, Startadresse (2), Anzahl (2), Bytezahl (1), Werte (2·N). */
export function writeMultipleRequestPdu(address: number, values: readonly number[]): Buffer {
  const pdu = Buffer.alloc(6 + values.length * 2);
  pdu.writeUInt8(FunctionCode.WriteMultipleRegisters, 0);
  pdu.writeUInt16BE(address, 1);
  pdu.writeUInt16BE(values.length, 3);
  pdu.writeUInt8(values.length * 2, 5);
  values.forEach((v, i) => pdu.writeUInt16BE(v, 6 + i * 2));
  return pdu;
}

/** Register (Big-Endian, je 2 Byte) aus einem Bytebereich lesen. */
export function registersFrom(bytes: Buffer): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < bytes.length; i += 2) out.push(bytes.readUInt16BE(i));
  return out;
}
