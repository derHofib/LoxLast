import Ajv2020 from 'ajv/dist/2020.js';
import schema from '../schema/wallbox-model.schema.json';
import {
  REGISTER_ROLES,
  isTodo,
  type RegisterDef,
  type RegisterType,
  type WallboxModel,
} from './model';

/**
 * Prüfung einer Modelldatei.
 *
 * - `invalid`: Schema- oder Regelverletzung. Die CI bricht ab, die App übernimmt das Modell nicht.
 * - `incomplete`: gültig, aber mindestens ein TODO-Platzhalter. Export bleibt gesperrt.
 * - `complete`: gültig und ohne TODO-Platzhalter.
 */
export type ModelStatus = 'complete' | 'incomplete' | 'invalid';

export interface ValidationIssue {
  severity: 'error';
  /** Pfad im Dokument, z. B. "/modbus/registers/power/source" oder "/" für das Ganze. */
  path: string;
  message: string;
}

export interface ModelCheck {
  status: ModelStatus;
  /** Gesetzt, sobald das Schema erfüllt ist (auch bei `incomplete`). */
  model?: WallboxModel;
  /** Pfade aller TODO-Platzhalter, z. B. "/modbus/registers/power/address". */
  todos: string[];
  issues: ValidationIssue[];
}

const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
const validateSchema = ajv.compile(schema);

/** Sammelt die Pfade aller TODO-Platzhalter in einem Wert (rekursiv). */
export function findTodos(value: unknown, path = ''): string[] {
  if (isTodo(value)) return [path || '/'];
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => findTodos(item, `${path}/${index}`));
  }
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, child]) => findTodos(child, `${path}/${key}`));
  }
  return [];
}

/** Ein Block mit Quelle darf nur dann echte Werte enthalten, wenn `source` gesetzt ist. */
function sourceIssues(path: string, block: Record<string, unknown>): ValidationIssue[] {
  const source = block['source'];
  const hasSource = typeof source === 'string' && !isTodo(source) && source.trim() !== '';
  if (hasSource) return [];
  const setKeys = Object.entries(block)
    .filter(([key, value]) => key !== 'source' && key !== 'registers' && !isTodo(value))
    .map(([key]) => key);
  if (setKeys.length === 0) return [];
  return [
    {
      severity: 'error',
      path,
      message: `Werte ohne Quelle: ${setKeys.join(', ')}. Quelle angeben oder die Werte auf "TODO" setzen.`,
    },
  ];
}

const REGISTER_WIDTH: Record<RegisterType, number> = {
  uint16: 1,
  int16: 1,
  uint32: 2,
  int32: 2,
  float32: 2,
};

function registerIssues(model: WallboxModel): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  // Belegte Adressbereiche je Funktionscode; 32-Bit-Typen belegen zwei Adressen.
  const occupied: Array<{ role: string; fn: number; from: number; to: number }> = [];
  for (const role of REGISTER_ROLES) {
    if (!model.modbus.registers[role]) {
      issues.push({
        severity: 'error',
        path: `/modbus/registers/${role}`,
        message: 'Pflichtregister fehlt.',
      });
    }
  }
  for (const [role, reg] of Object.entries(model.modbus.registers) as Array<
    [string, RegisterDef]
  >) {
    issues.push(
      ...sourceIssues(`/modbus/registers/${role}`, reg as unknown as Record<string, unknown>),
    );
    if (typeof reg.fn === 'number' && typeof reg.address === 'number' && !isTodo(reg.type)) {
      const width = REGISTER_WIDTH[reg.type as RegisterType];
      const from = reg.address;
      const to = from + width - 1;
      const clash = occupied.find((o) => o.fn === reg.fn && from <= o.to && o.from <= to);
      if (clash) {
        issues.push({
          severity: 'error',
          path: `/modbus/registers/${role}`,
          message: `Adressen ${from}–${to} (Funktion ${reg.fn}) überschneiden sich mit "${clash.role}".`,
        });
      }
      occupied.push({ role, fn: reg.fn, from, to });
    }
  }
  return issues;
}

/** Regeln, die das JSON-Schema nicht ausdrücken kann. */
export function checkRules(model: WallboxModel): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  issues.push(...sourceIssues('/firmware', model.firmware as unknown as Record<string, unknown>));
  issues.push(
    ...sourceIssues('/electrical', model.electrical as unknown as Record<string, unknown>),
  );
  issues.push(...sourceIssues('/modbus', model.modbus as unknown as Record<string, unknown>));
  issues.push(...registerIssues(model));

  const { minA, maxA } = model.electrical;
  if (typeof minA === 'number' && typeof maxA === 'number' && minA > maxA) {
    issues.push({
      severity: 'error',
      path: '/electrical',
      message: `minA (${minA} A) ist größer als maxA (${maxA} A).`,
    });
  }

  issues.push(...sourceIssues('/loxone', model.loxone as unknown as Record<string, unknown>));
  for (const [direction, mapping] of [
    ['inputs', model.loxone.inputs],
    ['outputs', model.loxone.outputs],
  ] as const) {
    if (isTodo(mapping)) continue;
    for (const [name, target] of Object.entries(mapping)) {
      const role = target.replace(/^registers\./, '');
      const register = Object.hasOwn(model.modbus.registers, role)
        ? model.modbus.registers[role]
        : undefined;
      if (!register) {
        issues.push({
          severity: 'error',
          path: `/loxone/${direction}/${name}`,
          message: `Verweis "${target}" zeigt auf kein Register.`,
        });
      } else if (direction === 'outputs' && register.access === 'r') {
        issues.push({
          severity: 'error',
          path: `/loxone/${direction}/${name}`,
          message: `Ausgang "${name}" zeigt auf "${role}", das nur lesbar (access: r) ist.`,
        });
      }
    }
  }
  return issues;
}

/** Prüft ein geparstes Dokument. Der Pfad dient nur der Fehlermeldung. */
export function checkModel(data: unknown): ModelCheck {
  if (!validateSchema(data)) {
    const issues = (validateSchema.errors ?? []).map((error) => ({
      severity: 'error' as const,
      path: error.instancePath || '/',
      message: `Schemaverletzung: ${error.message ?? 'unbekannt'}`,
    }));
    return { status: 'invalid', todos: [], issues };
  }
  const model = data as unknown as WallboxModel;
  const issues = checkRules(model);
  const todos = findTodos(data);
  const status: ModelStatus =
    issues.length > 0 ? 'invalid' : todos.length > 0 ? 'incomplete' : 'complete';
  return { status, model, todos, issues };
}
