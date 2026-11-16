import { kwFromA, type ChargePoint } from '@lastplan/core';
import {
  isTodo,
  type ByteOrder,
  type RegisterDef,
  type RegisterRole,
  type WallboxModel,
} from '@lastplan/wallbox-library';

/**
 * Modbus-Teil der Übergabe (Umsetzungsplan 6.4, ADR 0014).
 *
 * Je Ladepunkt mit Modbus TCP: ein Modbus-Gerät unter dem passenden Modbusserver, je ein
 * analoger Sensor für Leistung und Zählerstand und ein analoger Aktor für den Ladestrom. Alle
 * Registerangaben kommen aus der Wallbox-Bibliothek; ein `TODO` dort sperrt die Übergabe.
 *
 * Eigenschafts-IDs und Optionslisten stammen aus `get_block_properties`/`get_property_options`
 * der Erkundung vom 2026-11-16, die Bedeutung der Kästchen aus `get_doc` der Modbus-Typen.
 * Die Modbusserver legt der Nutzer vorher von Hand an (ADR 0013); das Skript findet sie über
 * ihre Adresse „IP:Port“.
 */

export const MODBUS_TYPES = {
  server: 'ModbusServer',
  device: 'ModbusDev',
  analogSensor: 'ModbusASensor',
  analogActor: 'ModbusAActor',
} as const;

export const MODBUS_PROPERTIES = {
  serverAddress: 1000,
  deviceAddress: 1282,
  ioAddress: 1306,
  command: 1308,
  dataType: 1309,
  registers16Bit: 1310,
  wordOrderLowFirst: 1311,
  byteOrderLowFirst: 1312,
  inputValue1: 1030,
  targetValue1: 1031,
  inputValue2: 1318,
  targetValue2: 1319,
  unit: 1040,
} as const;

/** Optionsindex von „Befehl“ (1308) je Funktionscode. */
const SENSOR_COMMAND: Record<number, number> = { 3: 2, 4: 3 };
const ACTOR_COMMAND: Record<number, number> = { 6: 1, 16: 3 };

/** Optionsindex von „Datentyp“ (1309). */
const DATA_TYPE: Record<string, number> = {
  uint16: 0,
  int16: 1,
  uint32: 2,
  int32: 3,
  float32: 4,
};

/** Kästchen Wortreihenfolge / Byte-Reihenfolge („niederwertig zuerst“), siehe Bibliothek-README. */
const ORDER_FLAGS: Record<ByteOrder, { word: boolean; byte: boolean }> = {
  'big-endian': { word: false, byte: false },
  'word-swapped': { word: true, byte: false },
  'byte-swapped': { word: false, byte: true },
  'little-endian': { word: true, byte: true },
};

/** Umrechnung der Einheit aus der Bibliothek in die Einheit des Wallbox-Eingangs. */
const POWER_TO_KW: Record<string, number> = { W: 0.001, kW: 1 };
const ENERGY_TO_KWH: Record<string, number> = { Wh: 0.001, kWh: 1 };

export interface PlannedRegister {
  name: string;
  kind: 'sensor' | 'actor';
  role: RegisterRole;
  /** Anschluss am Wallbox-Baustein: Ziel (Sensor) bzw. Quelle (Aktor). */
  wallboxConnector: string;
  properties: Record<number, number | boolean | string>;
}

export interface PlannedModbusDevice {
  key: string;
  name: string;
  wallboxKey: string;
  /** Adresse des Modbusservers, wie sie in Config steht: „IP:Port“. */
  serverAddress: string;
  unitId: number;
  registers: PlannedRegister[];
}

const floor = (x: number) => Math.floor(x * 1e6) / 1e6;

/**
 * Plant das Modbus-Gerät eines Ladepunkts. Gibt entweder das Gerät oder die Gründe zurück,
 * warum es nicht geplant werden kann.
 */
export function planModbusDevice(
  cp: ChargePoint,
  model: WallboxModel | undefined,
  names: { device: string; wallboxKey: string },
  voltageV: number,
): { device: PlannedModbusDevice } | { problems: string[] } {
  if (!model)
    return { problems: [`${cp.label}: Modell ${cp.libraryModelId} fehlt in der Bibliothek.`] };
  const problems: string[] = [];
  const where = (role: string) => `${cp.label} (${model.id}), Register ${role}`;

  const reg = (role: RegisterRole): RegisterDef | undefined => {
    const r = model.modbus.registers[role];
    if (!r) {
      problems.push(`${where(role)}: fehlt in der Bibliothek.`);
      return undefined;
    }
    const todo = (['address', 'fn', 'type', 'scale', 'unit'] as const).filter((k) => isTodo(r[k]));
    if (todo.length > 0) {
      problems.push(`${where(role)}: noch TODO (${todo.join(', ')}).`);
      return undefined;
    }
    return r;
  };

  const order = (r: RegisterDef): ByteOrder | undefined => {
    const o = r.byteOrder ?? model.modbus.byteOrder;
    return isTodo(o) ? undefined : o;
  };

  const common = (role: RegisterRole, r: RegisterDef, commands: Record<number, number>) => {
    const fn = r.fn as number;
    const type = r.type as string;
    const command = commands[fn];
    const o = order(r);
    if (command === undefined)
      problems.push(`${where(role)}: Funktionscode ${fn} wird hier nicht unterstützt.`);
    if (o === undefined) problems.push(`${where(role)}: Byte-Reihenfolge ist noch TODO.`);
    const is32 = type.endsWith('32');
    if (is32 && fn === 6)
      problems.push(`${where(role)}: 32-Bit-Wert mit Funktionscode 6 schreibt nur 16 Bit.`);
    const flags = ORDER_FLAGS[o ?? 'big-endian'];
    return {
      [MODBUS_PROPERTIES.ioAddress]: r.address as number,
      [MODBUS_PROPERTIES.command]: command ?? 0,
      [MODBUS_PROPERTIES.dataType]: DATA_TYPE[type] ?? 0,
      [MODBUS_PROPERTIES.registers16Bit]: is32,
      [MODBUS_PROPERTIES.wordOrderLowFirst]: flags.word,
      [MODBUS_PROPERTIES.byteOrderLowFirst]: flags.byte,
    };
  };

  const sensor = (
    role: RegisterRole,
    label: string,
    connector: string,
    toUnit: Record<string, number>,
    unit: string,
  ): PlannedRegister | undefined => {
    const r = reg(role);
    if (!r) return undefined;
    const factor = toUnit[r.unit as string];
    if (factor === undefined) {
      problems.push(
        `${where(role)}: Einheit „${String(r.unit)}“ kann nicht in ${unit} umgerechnet werden.`,
      );
      return undefined;
    }
    return {
      name: `${names.device} ${label}`,
      kind: 'sensor',
      role,
      wallboxConnector: connector,
      properties: {
        ...common(role, r, SENSOR_COMMAND),
        [MODBUS_PROPERTIES.inputValue1]: 0,
        [MODBUS_PROPERTIES.targetValue1]: 0,
        [MODBUS_PROPERTIES.inputValue2]: 1,
        [MODBUS_PROPERTIES.targetValue2]: floor((r.scale as number) * factor),
        [MODBUS_PROPERTIES.unit]: unit,
      },
    };
  };

  /** Aktor: Eingang ist die Zielleistung in kW (Wallbox Tp), geschrieben wird der Strom im Rohwert. */
  const actor = (): PlannedRegister | undefined => {
    const role = 'setpointCurrent';
    const r = reg(role);
    if (!r) return undefined;
    if (r.unit !== 'A') {
      problems.push(`${where(role)}: Einheit „${String(r.unit)}“, erwartet wird A.`);
      return undefined;
    }
    if (r.access !== 'rw') problems.push(`${where(role)}: Register ist nicht beschreibbar.`);
    return {
      name: `${names.device} Ladestrom`,
      kind: 'actor',
      role,
      wallboxConnector: 'outLimit',
      properties: {
        ...common(role, r, ACTOR_COMMAND),
        [MODBUS_PROPERTIES.inputValue1]: 0,
        [MODBUS_PROPERTIES.targetValue1]: 0,
        [MODBUS_PROPERTIES.inputValue2]: kwFromA(cp.maxA, cp.phases, voltageV),
        [MODBUS_PROPERTIES.targetValue2]: cp.maxA / (r.scale as number),
      },
    };
  };

  const registers = [
    sensor('power', 'Leistung', 'power', POWER_TO_KW, 'kW'),
    sensor('energy', 'Zählerstand', 'energy', ENERGY_TO_KWH, 'kWh'),
    actor(),
  ].filter((r): r is PlannedRegister => r !== undefined);

  const defaultUnit = model.modbus.defaultUnitId;
  const unitId = cp.network.unitId ?? (isTodo(defaultUnit) ? undefined : defaultUnit);
  if (unitId === undefined) {
    problems.push(`${cp.label}: Unit-ID fehlt (weder am Ladepunkt noch als Standard im Modell).`);
  }
  if (problems.length > 0 || unitId === undefined) return { problems };
  return {
    device: {
      key: `mb:${cp.id}`,
      name: names.device,
      wallboxKey: names.wallboxKey,
      serverAddress: `${cp.network.ip}:${cp.network.port}`,
      unitId,
      registers,
    },
  };
}
