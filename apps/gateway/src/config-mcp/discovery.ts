import type { ConfigDiscoveryResponse } from '@lastplan/protocol';
import { ConfigMcpError, ConfigMcpUnreachableError, type ConfigMcpClient } from './client';
import { checkConfigMcp } from './status';

/**
 * Config-Erkundung (Umsetzungsplan 6.3, ADR 0013): liest am geöffneten Testprojekt, was der
 * Skript-Erzeuger später braucht, statt es anzunehmen. Ausschließlich `code_query` (nur lesend)
 * und `get_doc`. Alle verwendeten `cfg.*`-Methoden und Felder stammen aus `sdk_describe`
 * (abgerufen 2026-11-16).
 *
 * Inhalt:
 * - Bausteintypen, deren Schlüssel/Name/Kategorie/Beschreibung auf Wallbox, Last, Energie,
 *   Zähler, Laden oder Modbus deutet – mit Anschlüssen (`get_block_types`).
 * - einfügbare Peripherietypen (`get_insertable_types`), kompakt.
 * - Modbus-Objekte im Peripheriebaum (`get_tree`) mit Eigenschaften (`get_block_properties`)
 *   und, wo es Optionen gibt, deren Liste (`get_property_options`).
 * - platzierte Bausteine passender Typen mit Anschlüssen (`get_block_index`, `get_block`) und
 *   den Daten hinter ihrem Dialog (`get_block_data`, z. B. die Lasttabelle des Lastmanagers).
 *   `get_block_data_raw` wird bewusst nicht gelesen (serialisiert den Baustein, laut Skill nie in
 *   einer Schleife).
 * Fehler einzelner Aufrufe stehen im Bericht unter `errors` statt die Erkundung abzubrechen.
 */
export const DISCOVERY_QUERY = String.raw`
const RE = /wallbox|load|last|energ|meter|zähler|charg|lade|modbus/i;
const MAX_OBJECTS = 40;
const errors = [];
const attempt = (what, fn) => {
  try { return fn(); } catch (e) { errors.push({ what, code: e && e.code ? e.code : 'ERROR', message: String(e && e.message ? e.message : e) }); return undefined; }
};
const conn = (c) => ({ key: c.key, name: c.name, dataType: c.dataType, unit: c.unit, min: c.min, max: c.max });

const types = attempt('get_block_types', () => cfg.get_block_types().blockTypes) || [];
const blockTypes = types
  .filter((t) => RE.test([t.type, t.displayName, t.category, t.description].join(' ')))
  .map((t) => ({
    type: t.type, displayName: t.displayName, category: t.category, description: t.description,
    inputs: t.connectors.inputs.map(conn), outputs: t.connectors.outputs.map(conn), parameters: t.connectors.parameters.map(conn),
  }));

const ins = attempt('get_insertable_types', () => cfg.get_insertable_types({})) || { types: [], coveredGroups: [] };
const insertable = ins.types.map((t) => ({ type: t.type, displayName: t.displayName, group: t.group, needsInteraction: t.needsInteraction, variants: t.variants }));

const props = (uuid) => {
  const r = attempt('get_block_properties ' + uuid, () => cfg.get_block_properties({ uuid }));
  if (!r) return undefined;
  return r.properties.map((p) => {
    const out = { id: p.id, name: p.name, type: p.type, editable: p.editable, value: p.value, valueText: p.valueText, min: p.min, max: p.max, optionCount: p.optionCount };
    if (p.optionCount) {
      const o = attempt('get_property_options ' + uuid + '/' + p.id, () => cfg.get_property_options({ uuid, property_id: p.id }));
      if (o) out.options = o.property.options;
    }
    return out;
  });
};

const tree = attempt('get_tree', () => cfg.get_tree({})) || { roots: [] };
const modbusObjects = [];
const walk = (node, path) => {
  const here = path.concat(node.name);
  if (node.uuid && node.type && /modbus/i.test(node.type + ' ' + node.name) && modbusObjects.length < MAX_OBJECTS) {
    modbusObjects.push({ uuid: node.uuid, type: node.type, name: node.name, path: here.join(' / '), isDevice: node.isDevice, childCount: node.childCount, properties: props(node.uuid) });
  }
  for (const c of node.children || []) walk(c, here);
};
for (const r of tree.roots) walk(r, []);

const index = attempt('get_block_index', () => cfg.get_block_index().blocks) || [];
const wanted = new Set(blockTypes.map((t) => t.type));
const placedBlocks = index.filter((b) => wanted.has(b.type)).slice(0, MAX_OBJECTS).map((b) => {
  const d = attempt('get_block ' + b.uuid, () => cfg.get_block({ uuid: b.uuid }).block);
  return {
    uuid: b.uuid, type: b.type, title: b.title, page: b.page,
    configState: d ? d.configState : undefined,
    inputs: d ? d.connectors.inputs.map(conn) : undefined,
    outputs: d ? d.connectors.outputs.map(conn) : undefined,
    parameters: d ? d.connectors.parameters.map(conn) : undefined,
    properties: props(b.uuid),
    blockData: attempt('get_block_data ' + b.uuid, () => cfg.get_block_data({ uuid: b.uuid })),
  };
});

return { blockTypeCount: types.length, blockTypes, coveredGroups: ins.coveredGroups, insertable, modbusObjects, placedBlocks, errors };
`;

interface DiscoveryValue {
  blockTypes?: Array<{ type?: unknown }>;
  modbusObjects?: unknown[];
  placedBlocks?: unknown[];
  errors?: unknown[];
}

const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Höchstzahl der `get_doc`-Abrufe je Erkundung. */
export const MAX_DOCS = 20;

/**
 * Diese Bausteintypen bekommen ihre Doku zuerst, weil der Skript-Erzeuger (6.4) auf ihnen aufbaut:
 * Wallbox, Wallbox Manager, Lastmanager, Energiemanager. Schlüssel aus `get_block_types` der
 * Erkundung vom 2026-11-16.
 */
export const PRIORITY_DOC_TYPES = ['Wallbox', 'WBEM', 'LoadShed', 'EnergyManager2', 'EFM'] as const;

/** Reihenfolge der Doku-Abrufe: zuerst die vorrangigen Typen, dann der Rest wie gefunden. */
export function docOrder(found: readonly string[]): string[] {
  const set = new Set(found);
  const first = PRIORITY_DOC_TYPES.filter((t) => set.has(t));
  const rest = found.filter((t) => !(PRIORITY_DOC_TYPES as readonly string[]).includes(t));
  return [...new Set([...first, ...rest])].slice(0, MAX_DOCS);
}

/** Erkundung ausführen. Ohne Verbindung oder bei falscher Config-Version: nur der Status. */
export async function runConfigDiscovery(
  client: ConfigMcpClient | undefined,
  now: () => Date = () => new Date(),
): Promise<ConfigDiscoveryResponse> {
  const status = await checkConfigMcp(client);
  if (status.status !== 'ok' || !client) return { status, report: null };
  try {
    const value = (await client.query(DISCOVERY_QUERY, 120_000)) as DiscoveryValue;
    const docs: Record<string, string> = {};
    const found = asArray(value.blockTypes)
      .map((t) => (t as { type?: unknown }).type)
      .filter((t): t is string => typeof t === 'string');
    for (const type of docOrder(found)) {
      try {
        docs[type] = await client.getDoc(type);
      } catch (e) {
        if (e instanceof ConfigMcpUnreachableError) throw e;
        docs[type] = `Fehler: ${e instanceof ConfigMcpError ? e.code : 'unbekannt'}`;
      }
    }
    return {
      status,
      report: {
        generatedAt: now().toISOString(),
        server: status.server,
        project: status.project,
        summary: {
          blockTypes: asArray(value.blockTypes).length,
          modbusObjects: asArray(value.modbusObjects).length,
          placedBlocks: asArray(value.placedBlocks).length,
          errors: asArray(value.errors).length,
        },
        data: value as Record<string, unknown>,
        docs,
      },
    };
  } catch (e) {
    return {
      status: {
        ...status,
        status: e instanceof ConfigMcpUnreachableError ? 'unreachable' : 'error',
        message:
          e instanceof ConfigMcpError
            ? `Erkundung fehlgeschlagen (${e.code}): ${e.message}`
            : 'Erkundung fehlgeschlagen: Verbindung zu Loxone Config abgebrochen.',
      },
      report: null,
    };
  }
}
