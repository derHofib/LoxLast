import type { Meter, Project } from '../model';

/**
 * Struktur-Hash (Kap. 7.2, 9): ändert sich genau dann, wenn eine Übertragung per Loxone Config
 * nötig wird.
 *
 * Strukturrelevant: Ladepunkte, Gruppen, Cluster, Zuordnungen, Namen (werden zu Loxone-Objektnamen),
 * Netzwerkdaten, Protokolle, Modelle, Zähler, Benennungsschema.
 * Nicht strukturrelevant: Werte, die später als virtuelle Eingänge live gesetzt werden
 * (Limits, Min/Max-Ströme, Prioritäten, Reserve) sowie Notizen und Kundendaten.
 *
 * TODO(verify): Ob Anschlussphasen, Phasenrotation und Phasenumschaltung im Loxone-Baustein
 * Parameter (live setzbar) oder Struktur sind, klärt die Analyse der .Loxone-Dateien (Meilenstein 7).
 * Bis dahin gelten Anschlussphasen und Phasenumschaltung als Struktur, die Rotation nicht.
 */

const STRUCTURE_HASH_VERSION = 'v1';

function meterShape(meter: Meter | undefined) {
  return meter
    ? { vendor: meter.vendor, model: meter.model, protocol: meter.protocol, network: meter.network }
    : null;
}

const byId = <T extends { id: string }>(items: readonly T[]) =>
  [...items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

/** Die strukturrelevanten Daten in kanonischer Form. */
export function structureSnapshot(project: Project) {
  return {
    projectId: project.id,
    naming: project.settings.namingScheme,
    gridMeter: meterShape(project.site.gridMeter),
    pvMeter: meterShape(project.site.pv?.meter),
    clusters: byId(project.clusters).map((c) => ({
      id: c.id,
      name: c.name,
      parent: c.parentClusterId ?? null,
    })),
    groups: byId(project.groups).map((g) => ({ id: g.id, name: g.name, clusterId: g.clusterId })),
    chargePoints: byId(project.chargePoints).map((cp) => ({
      id: cp.id,
      label: cp.label,
      groupId: cp.groupId,
      model: cp.libraryModelId,
      protocol: cp.protocol,
      network: { ip: cp.network.ip, port: cp.network.port, unitId: cp.network.unitId ?? null },
      phases: cp.phases,
      phaseSwitching: cp.phaseSwitching,
      room: cp.room ?? null,
      category: cp.category ?? null,
    })),
  };
}

/** JSON mit sortierten Schlüsseln, damit die Reihenfolge der Eigenschaften keine Rolle spielt. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** UTF-8-Bytes ohne TextEncoder (core hat bewusst keine DOM-/Node-Typen). */
function* utf8(text: string): Generator<number> {
  for (const char of text) {
    const cp = char.codePointAt(0) as number;
    if (cp < 0x80) yield cp;
    else if (cp < 0x800) yield* [0xc0 | (cp >> 6), 0x80 | (cp & 0x3f)];
    else if (cp < 0x10000)
      yield* [0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f)];
    else
      yield* [
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f),
      ];
  }
}

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK_64 = 0xffffffffffffffffn;

/** FNV-1a, 64 Bit, über UTF-8. Synchron und ohne Node-/Browser-API; keine kryptografische Sicherheit nötig. */
export function fnv1a64(text: string): string {
  let hash = FNV_OFFSET;
  for (const byte of utf8(text)) {
    hash ^= BigInt(byte);
    hash = (hash * FNV_PRIME) & MASK_64;
  }
  return hash.toString(16).padStart(16, '0');
}

export function structureHash(project: Project): string {
  return `${STRUCTURE_HASH_VERSION}:${fnv1a64(canonicalJson(structureSnapshot(project)))}`;
}
