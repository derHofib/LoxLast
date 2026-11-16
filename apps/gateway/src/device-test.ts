import {
  DEVICE_TEST_ROLES,
  type DeviceReading,
  type DeviceTestResponse,
  type DeviceTestRole,
  type NetworkEndpoint,
} from '@lastplan/protocol';
import { isTodo, type RegisterType, type WallboxModel } from '@lastplan/wallbox-library';
import { ModbusError, ModbusExceptionError } from './clients/modbus-errors';
import { FunctionCode } from './clients/modbus-frame';
import type { ModbusClient, ModbusEndpoint } from './clients/types';

/**
 * Geräte-Verbindungstest (Kap. 8.1, ADR 0012). Liest Ströme, Leistung und Status eines Ladepunkts.
 *
 * Grundsätze:
 * - Nur lesen (0x03/0x04), nie schreiben.
 * - Adresse, Funktionscode, Datentyp, Skalierung, Einheit und Byte-Reihenfolge kommen
 *   ausschließlich aus der Modelldatei. Fehlt etwas (TODO), wird KEIN Register gelesen; es wird
 *   höchstens geprüft, ob am Port eine TCP-Verbindung zustande kommt.
 */

export const ROLE_LABEL: Record<DeviceTestRole, string> = {
  currentL1: 'Strom L1',
  currentL2: 'Strom L2',
  currentL3: 'Strom L3',
  power: 'Leistung',
  status: 'Status',
};

const FIELD_LABEL = {
  address: 'Adresse',
  fn: 'Funktionscode',
  type: 'Datentyp',
  scale: 'Skalierung',
  unit: 'Einheit',
} as const;
type RegisterField = keyof typeof FIELD_LABEL;

const READ_CODES: readonly number[] = [
  FunctionCode.ReadHoldingRegisters,
  FunctionCode.ReadInputRegisters,
];

type ByteOrder = 'big-endian' | 'little-endian' | 'word-swapped';

export interface PlannedRead {
  role: DeviceTestRole;
  address: number;
  fn: number;
  type: RegisterType;
  scale: number;
  unit: string;
  enum: Record<string, string> | undefined;
}

export type ReadPlan =
  | { ok: true; unitId: number; byteOrder: ByteOrder; reads: PlannedRead[] }
  | { ok: false; missing: string[]; message: string };

/** Was der Test lesen würde – oder warum er es nicht darf. */
export function planDeviceTest(
  model: WallboxModel | undefined,
  modelId: string,
  endpointUnitId: number | undefined,
): ReadPlan {
  if (!model) {
    return {
      ok: false,
      missing: [],
      message: `Nicht prüfbar: Modell „${modelId}“ steht nicht in der Wallbox-Bibliothek.`,
    };
  }
  if (!model.protocols.includes('modbus-tcp')) {
    return {
      ok: false,
      missing: [],
      message: `Nicht prüfbar: ${model.vendor} ${model.model} unterstützt laut Bibliothek kein Modbus TCP.`,
    };
  }
  const missing: string[] = [];
  const gaps: string[] = [];
  const problems: string[] = [];

  const unitId = endpointUnitId ?? model.modbus.defaultUnitId;
  if (isTodo(unitId)) {
    missing.push('modbus.defaultUnitId');
    gaps.push('Unit-ID (am Ladepunkt eintragen oder in der Bibliothek ergänzen)');
  }
  const byteOrder = model.modbus.byteOrder;
  if (isTodo(byteOrder)) {
    missing.push('modbus.byteOrder');
    gaps.push('Byte-Reihenfolge');
  }

  const reads: PlannedRead[] = [];
  for (const role of DEVICE_TEST_ROLES) {
    const def = model.modbus.registers[role];
    if (!def) {
      missing.push(`modbus.registers.${role}`);
      gaps.push(`${ROLE_LABEL[role]}: ganzes Register`);
      continue;
    }
    const absent = (Object.keys(FIELD_LABEL) as RegisterField[]).filter((f) => isTodo(def[f]));
    if (absent.length > 0) {
      missing.push(...absent.map((f) => `modbus.registers.${role}.${f}`));
      gaps.push(`${ROLE_LABEL[role]}: ${absent.map((f) => FIELD_LABEL[f]).join(', ')}`);
      continue;
    }
    const fn = def.fn as number;
    if (!READ_CODES.includes(fn)) {
      problems.push(
        `${ROLE_LABEL[role]}: Funktionscode ${fn} ist kein Lesecode (erwartet 3 oder 4)`,
      );
      continue;
    }
    reads.push({
      role,
      address: def.address as number,
      fn,
      type: def.type as RegisterType,
      scale: def.scale as number,
      unit: def.unit as string,
      enum: def.enum === undefined || isTodo(def.enum) ? undefined : def.enum,
    });
  }

  if (gaps.length > 0 || problems.length > 0) {
    const parts: string[] = [];
    if (gaps.length > 0)
      parts.push(
        `Register fehlen in der Bibliothek (${gaps.join('; ')}). Werte aus der Herstellerdoku in der Modelldatei nachtragen.`,
      );
    if (problems.length > 0) parts.push(`Bibliothek widersprüchlich (${problems.join('; ')}).`);
    return { ok: false, missing, message: `Nicht prüfbar: ${parts.join(' ')}` };
  }
  return { ok: true, unitId: unitId as number, byteOrder: byteOrder as ByteOrder, reads };
}

const is32 = (t: RegisterType): boolean => t === 'uint32' || t === 'int32' || t === 'float32';

/**
 * Register in einen Zahlenwert umwandeln. Modbus überträgt jedes Register Big-Endian
 * (Application Protocol V1.1b3, Kap. 4.2); für Werte über mehrere Register legt die Spezifikation
 * nichts fest – das regelt `byteOrder` der Modelldatei (Bedeutung siehe ADR 0012):
 * big-endian = ABCD, word-swapped = CDAB, little-endian = DCBA (bei 16 Bit: BA).
 */
export function decodeRegisters(
  raw: readonly number[],
  type: RegisterType,
  order: ByteOrder,
): number {
  const bytes = Buffer.alloc(raw.length * 2);
  raw.forEach((r, i) => bytes.writeUInt16BE(r, i * 2));
  let b = bytes;
  if (order === 'little-endian') b = Buffer.from(bytes).reverse();
  else if (order === 'word-swapped' && raw.length === 2)
    b = Buffer.concat([bytes.subarray(2, 4), bytes.subarray(0, 2)]);
  switch (type) {
    case 'uint16':
      return b.readUInt16BE(0);
    case 'int16':
      return b.readInt16BE(0);
    case 'uint32':
      return b.readUInt32BE(0);
    case 'int32':
      return b.readInt32BE(0);
    case 'float32':
      return b.readFloatBE(0);
  }
}

/** Skalieren und Rundungsrauschen (Gleitkomma) entfernen. */
const scaled = (v: number, scale: number): number => Number((v * scale).toPrecision(12));

export interface DeviceTestDeps {
  modbus: ModbusClient;
  /** TCP-Verbindungsaufbau; liefert ms. */
  probe: (host: string, port: number) => Promise<number>;
  /** Uhr für Latenzmessung (ms). */
  now?: () => number;
  /** Zeitstempel des Tests. */
  clock?: () => Date;
}

export interface DeviceTestTarget {
  endpoint: NetworkEndpoint;
  modelId: string;
  model: WallboxModel | undefined;
  modelSource: 'request' | 'gateway' | null;
}

const errorText = (e: unknown): string =>
  e instanceof Error ? e.message : 'Unbekannter Fehler beim Lesen.';

export async function runDeviceTest(
  target: DeviceTestTarget,
  deps: DeviceTestDeps,
): Promise<DeviceTestResponse> {
  const now = deps.now ?? (() => performance.now());
  const testedAt = (deps.clock?.() ?? new Date()).toISOString();
  const base = { firmware: null, modelSource: target.modelSource, testedAt };
  const plan = planDeviceTest(target.model, target.modelId, target.endpoint.unitId);

  if (!plan.ok) {
    // Nur Erreichbarkeit prüfen (TCP), keinen Lesezugriff mit geratenen Werten.
    try {
      const ms = await deps.probe(target.endpoint.ip, target.endpoint.port);
      return {
        ...base,
        outcome: 'not_testable',
        reachable: true,
        latencyMs: Math.round(ms),
        values: {},
        readings: [],
        missing: plan.missing,
        message: `${plan.message} Der Port ist per TCP erreichbar; Register wurden nicht gelesen.`,
      };
    } catch (error) {
      return {
        ...base,
        outcome: 'not_testable',
        reachable: false,
        latencyMs: null,
        values: {},
        readings: [],
        missing: plan.missing,
        message: `${plan.message} Außerdem: ${errorText(error)}`,
      };
    }
  }

  const endpoint: ModbusEndpoint = {
    host: target.endpoint.ip,
    port: target.endpoint.port,
    unitId: plan.unitId,
  };
  const readings: DeviceReading[] = [];
  let latencyMs: number | null = null;
  let reachable = false;
  let fatal: ModbusError | Error | undefined;

  for (const read of plan.reads) {
    const reading: DeviceReading = {
      role: read.role,
      label: ROLE_LABEL[read.role],
      value: null,
      unit: read.unit,
      text: null,
      raw: [],
      error: null,
    };
    readings.push(reading);
    if (fatal) {
      reading.error = 'Nicht gelesen (vorheriger Fehler).';
      continue;
    }
    const count = is32(read.type) ? 2 : 1;
    const start = now();
    try {
      const raw =
        read.fn === FunctionCode.ReadInputRegisters
          ? await deps.modbus.readInputRegisters(endpoint, read.address, count)
          : await deps.modbus.readHoldingRegisters(endpoint, read.address, count);
      latencyMs ??= Math.round(now() - start);
      reachable = true;
      reading.raw = raw;
      reading.value = scaled(decodeRegisters(raw, read.type, plan.byteOrder), read.scale);
      reading.text = read.enum?.[String(reading.value)] ?? null;
    } catch (error) {
      if (error instanceof ModbusExceptionError) {
        // Gerät hat geantwortet; die übrigen Register trotzdem lesen.
        latencyMs ??= Math.round(now() - start);
        reachable = true;
        reading.error = `${error.message} Register ${read.address} (${reading.label}).`;
        continue;
      }
      if (error instanceof ModbusError && error.connected) reachable = true;
      fatal = error instanceof Error ? error : new Error(errorText(error));
      reading.error = errorText(error);
    }
  }

  const values = Object.fromEntries(readings.map((r) => [r.role, r.text ?? r.value]));
  const firstError = readings.find((r) => r.error !== null)?.error ?? null;
  const outcome: DeviceTestResponse['outcome'] =
    firstError === null ? 'ok' : reachable ? 'device_error' : 'unreachable';
  return {
    ...base,
    outcome,
    reachable,
    latencyMs,
    values,
    readings,
    missing: [],
    message: firstError,
  };
}
