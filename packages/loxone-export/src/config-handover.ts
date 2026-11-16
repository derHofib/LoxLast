import {
  clusterOwnLimit,
  kwFromA,
  minPhase,
  siteAvailableA,
  type Cluster,
  type Group,
  type NamingField,
  type Project,
} from '@lastplan/core';
import type { WallboxModel } from '@lastplan/wallbox-library';
import {
  MODBUS_PROPERTIES,
  MODBUS_TYPES,
  planModbusDevice,
  type PlannedModbusDevice,
} from './config-handover-modbus';

/**
 * Übergabeplan für Loxone Config (Umsetzungsplan 6.4, ADR 0013 und 0014).
 *
 * Aus dem LastPlan-Projekt entsteht zuerst ein reiner Datenplan: welche Bausteine, welche Werte,
 * welche Verbindungen und was der Nutzer danach im Dialog von Hand einträgt. Der Plan enthält
 * nur, was die Erkundung vom 2026-11-16 belegt hat (Typ-Schlüssel, Eigenschafts-IDs,
 * Anschluss-Schlüssel). Aus dem Plan erzeugt `renderHandoverScript` ein Skript für `code_run`.
 *
 * Abbildung (ADR 0014, vom Auftraggeber entschieden):
 * - Standort und jeder Cluster: ein Lastmanager (`LoadShed`) im Modus Überlastschutz.
 * - Jede Gruppe: ein Wallbox Manager (`WBEM`) mit den Wallboxen dieser Gruppe.
 * - Jeder Ladepunkt: ein Wallbox-Baustein (`Wallbox`) mit Max./Min. Ladeleistung in kW.
 * - Das Standort-Limit kommt über einen analogen virtuellen Eingang an MaxP des Standort-
 *   Lastmanagers. Kind-Lastmanager und Wallbox Manager erhalten ihr Limit vom Ausgang der
 *   Elternebene (`AQl1`–`AQl12` an `maxP` bzw. `Pmax`).
 * - Lasttabelle der Lastmanager und Zuordnung der Wallboxen zum Wallbox Manager sind per MCP
 *   nicht schreibbar und kommen als Abhak-Liste.
 *
 * - Je Ladepunkt mit Modbus TCP: Modbus-Gerät mit Sensoren (Leistung, Zählerstand → Eingänge
 *   `power`, `energy`) und Aktor (Ladestrom ← Ausgang `outLimit` = Tp in kW). Die Umrechnung
 *   kW → A übernimmt die Skalierung des Aktors (config-handover-modbus.ts).
 */

/** Typ-Schlüssel aus `get_block_types` (Erkundung 2026-11-16). */
export const LOXONE_TYPES = {
  loadManager: 'LoadShed',
  wallboxManager: 'WBEM',
  wallbox: 'Wallbox',
  virtualInput: 'VirtualIn',
} as const;

/** Eigenschafts-IDs aus `get_block_properties` (Erkundung 2026-11-16) bzw. Skill (VirtualIn). */
export const LOXONE_PROPERTIES = {
  loadManagerMaxP: 416,
  loadManagerMode: 3054,
  wallboxMaxKw: 3050,
  wallboxMinKw: 3049,
  /** „Als Digitaleingang verwenden“ eines virtuellen Eingangs (Skill, references/periphery.md). */
  virtualInputDigital: 1020,
} as const;

/** Optionsindex „Überlastschutz“ der Eigenschaft Arbeitsmodus (3054). */
export const LOAD_MANAGER_MODE_OVERLOAD = 0;

/** Anschluss-Schlüssel aus `get_block` (Erkundung 2026-11-16) bzw. Skill (Referenz-Instanz). */
export const LOXONE_CONNECTORS = {
  loadManagerMaxP: 'maxP',
  loadManagerLoadOut: (n: number) => `AQl${n}`,
  wallboxManagerPmax: 'Pmax',
  /** Lebender Ausgang einer platzierten Instanz eines virtuellen Eingangs oder Sensors. */
  virtualInputRefOut: 'AQ',
} as const;

/** Ein Lastmanager hat 12 Lasten (`AQl1`–`AQl12`). */
export const LOAD_MANAGER_SLOTS = 12;

export interface PlannedLoad {
  /** Nummer der Last im Eltern-Lastmanager (1–12). */
  slot: number;
  /** Titel des versorgten Bausteins. */
  title: string;
  kind: 'cluster' | 'group';
  /** Höchstleistung dieser Last (Limit des Clusters bzw. der Gruppe). */
  maxKw: number;
  maxA: number;
  /** Vorschlag: kleinste Mindestladeleistung einer Wallbox darunter. */
  minKw: number;
  /** 1 = höchste Priorität (zuletzt abgeworfen). */
  priority: number;
}

export interface PlannedLoadManager {
  key: string;
  title: string;
  /** Eigenes Limit (MaxP) in kW, auf 0,01 kW abgerundet. */
  maxKw: number;
  maxA: number;
  /** Elternteil, von dem das Limit kommt; fehlt beim Standort (virtueller Eingang). */
  parent?: { key: string; slot: number };
  loads: PlannedLoad[];
}

export interface PlannedWallboxManager {
  key: string;
  title: string;
  parent: { key: string; slot: number };
  /** Wallbox-Titel in der Reihenfolge, in der sie im Dialog eingetragen werden. */
  wallboxes: string[];
}

export interface PlannedWallbox {
  key: string;
  title: string;
  managerKey: string;
  maxKw: number;
  minKw: number;
  maxA: number;
  minA: number;
  phases: 1 | 3;
}

export interface PlannedVirtualInput {
  key: string;
  name: string;
  valueKw: number;
  valueA: number;
  target: { key: string; connector: string };
}

export interface HandoverPlan {
  pageName: string;
  voltageV: number;
  virtualInputs: PlannedVirtualInput[];
  loadManagers: PlannedLoadManager[];
  wallboxManagers: PlannedWallboxManager[];
  wallboxes: PlannedWallbox[];
  /** Was der Nutzer nach dem Lauf in den Dialogen einträgt. */
  modbusDevices: PlannedModbusDevice[];
  /** Was vor dem Lauf in Config angelegt sein muss (Modbusserver mit Adresse). */
  prerequisites: string[];
  manualSteps: ManualStep[];
  /** Was LastPlan noch nicht übergibt, weil es nicht belegt ist. */
  pending: string[];
  /** Gründe, aus denen der Plan nicht ausgeführt werden darf. Leer = ausführbar. */
  blockers: string[];
}

export interface ManualStep {
  block: string;
  title: string;
  items: string[];
}

const floor2 = (v: number) => Math.floor(v * 100 + 1e-9) / 100;
const ceil2 = (v: number) => Math.ceil(v * 100 - 1e-9) / 100;
const fmt = (v: number) => v.toLocaleString('de-DE', { maximumFractionDigits: 2 });

/** Setzt Platzhalter einer Namensvorlage ein, z. B. „LM_{cluster}“. */
export function renderName(
  project: Project,
  field: NamingField,
  values: Record<string, string>,
): string {
  return project.settings.namingScheme[field].replace(
    /\{([^{}]*)\}/g,
    (_, k: string) => values[k] ?? '',
  );
}

/** Cluster-Limit in A je Phase: bei abweichenden Phasen-Limits das kleinste. */
function clusterLimitA(cluster: Cluster): number {
  return minPhase(clusterOwnLimit(cluster));
}

export function buildHandoverPlan(
  project: Project,
  models: ReadonlyMap<string, WallboxModel> = new Map(),
): HandoverPlan {
  const V = project.settings.voltageV;
  const blockers: string[] = [];
  const kw3 = (a: number) => floor2(kwFromA(a, 3, V));

  const clusterById = new Map(project.clusters.map((c) => [c.id, c]));
  const childClusters = (parentId: string | undefined) =>
    project.clusters.filter((c) =>
      parentId === undefined
        ? c.parentClusterId === undefined || !clusterById.has(c.parentClusterId)
        : c.parentClusterId === parentId,
    );

  // Zyklen in der Cluster-Hierarchie: nicht übergeben.
  for (const c of project.clusters) {
    const seen = new Set<string>();
    let cur: Cluster | undefined = c;
    while (cur?.parentClusterId !== undefined) {
      if (seen.has(cur.id)) {
        blockers.push(`Cluster „${c.name}“ liegt in einem Kreis von Unterverteilungen.`);
        break;
      }
      seen.add(cur.id);
      cur = clusterById.get(cur.parentClusterId);
    }
  }
  if (blockers.length > 0) return emptyPlan(project, blockers);

  const cpMissing = project.chargePoints.filter((cp) => (cp.missingFields?.length ?? 0) > 0);
  for (const cp of cpMissing) {
    blockers.push(
      `Ladepunkt ${cp.label}: Angaben fehlen noch (${(cp.missingFields ?? []).join(', ')}).`,
    );
  }

  const wallboxes: PlannedWallbox[] = [];
  const wallboxManagers: PlannedWallboxManager[] = [];
  const loadManagers: PlannedLoadManager[] = [];
  const titles = new Map<string, string>();
  const claimTitle = (title: string, what: string) => {
    const prev = titles.get(title);
    if (prev) blockers.push(`Name „${title}“ kommt doppelt vor (${prev} und ${what}).`);
    else titles.set(title, what);
  };

  const groupMinKw = new Map<string, number>();
  const planGroup = (group: Group, clusterName: string, parentKey: string, slot: number) => {
    const key = `group:${group.id}`;
    const title = renderName(project, 'groupLimit', { cluster: clusterName, group: group.name });
    claimTitle(title, `Gruppe ${group.name}`);
    const cps = project.chargePoints.filter((cp) => cp.groupId === group.id);
    const titlesOfGroup: string[] = [];
    let minKw = Number.POSITIVE_INFINITY;
    for (const cp of cps) {
      const wbTitle = renderName(project, 'wallbox', { label: cp.label });
      claimTitle(wbTitle, `Ladepunkt ${cp.label}`);
      const wbMin = ceil2(kwFromA(cp.minA, cp.phases, V));
      minKw = Math.min(minKw, wbMin);
      wallboxes.push({
        key: `cp:${cp.id}`,
        title: wbTitle,
        managerKey: key,
        maxKw: floor2(kwFromA(cp.maxA, cp.phases, V)),
        minKw: wbMin,
        maxA: cp.maxA,
        minA: cp.minA,
        phases: cp.phases,
      });
      titlesOfGroup.push(wbTitle);
    }
    if (cps.length === 0) blockers.push(`Gruppe „${group.name}“ hat keine Ladepunkte.`);
    groupMinKw.set(group.id, Number.isFinite(minKw) ? minKw : 0);
    wallboxManagers.push({
      key,
      title,
      parent: { key: parentKey, slot },
      wallboxes: titlesOfGroup,
    });
    return { key, title };
  };

  const planLevel = (
    key: string,
    title: string,
    limitA: number,
    clusterId: string | undefined,
    clusterName: string,
    parent: PlannedLoadManager['parent'],
  ) => {
    claimTitle(title, clusterId === undefined ? 'Standort' : `Cluster ${clusterName}`);
    const lm: PlannedLoadManager = {
      key,
      title,
      maxKw: kw3(limitA),
      maxA: limitA,
      ...(parent ? { parent } : {}),
      loads: [],
    };
    loadManagers.push(lm);
    const children: Array<() => PlannedLoad> = [];
    for (const child of childClusters(clusterId)) {
      children.push(() => {
        const slot = lm.loads.length + 1;
        const childTitle = renderName(project, 'clusterManager', { cluster: child.name });
        const childMin = planLevel(
          `cluster:${child.id}`,
          childTitle,
          clusterLimitA(child),
          child.id,
          child.name,
          { key, slot },
        );
        return {
          slot,
          title: childTitle,
          kind: 'cluster',
          maxKw: kw3(clusterLimitA(child)),
          maxA: clusterLimitA(child),
          minKw: childMin,
          priority: 1,
        };
      });
    }
    if (clusterId !== undefined) {
      const groups = project.groups
        .filter((g) => g.clusterId === clusterId)
        .sort((a, b) => a.priority - b.priority);
      for (const group of groups) {
        children.push(() => {
          const slot = lm.loads.length + 1;
          const g = planGroup(group, clusterName, key, slot);
          const maxA = Math.min(group.maxA ?? limitA, limitA);
          return {
            slot,
            title: g.title,
            kind: 'group',
            maxKw: kw3(maxA),
            maxA,
            minKw: groupMinKw.get(group.id) ?? 0,
            priority: group.priority,
          };
        });
      }
    }
    if (children.length > LOAD_MANAGER_SLOTS) {
      blockers.push(
        `${title}: ${children.length} Unterebenen, ein Lastmanager hat aber nur ${LOAD_MANAGER_SLOTS} Lasten.`,
      );
    }
    for (const make of children.slice(0, LOAD_MANAGER_SLOTS)) lm.loads.push(make());
    return lm.loads.length > 0 ? Math.min(...lm.loads.map((l) => l.minKw)) : 0;
  };

  const siteA = siteAvailableA(project);
  if (siteA <= 0) blockers.push('Am Standort steht kein Strom zur Verfügung (Limit 0 A).');
  const siteTitle = renderName(project, 'siteManager', {});
  planLevel('site', siteTitle, siteA, undefined, '', undefined);

  const orphanGroups = project.groups.filter((g) => !clusterById.has(g.clusterId));
  for (const g of orphanGroups) blockers.push(`Gruppe „${g.name}“ gehört zu keinem Cluster.`);

  const virtualInputs: PlannedVirtualInput[] = [
    {
      key: 'vi:site',
      name: `${siteTitle} Limit (kW) – ${fmt(siteA)} A`,
      valueKw: kw3(siteA),
      valueA: siteA,
      target: { key: 'site', connector: LOXONE_CONNECTORS.loadManagerMaxP },
    },
  ];

  const manualSteps: ManualStep[] = [
    ...loadManagers
      .filter((lm) => lm.loads.length > 0)
      .map((lm) => ({
        block: lm.key,
        title: lm.title,
        items: [
          'Lasttabelle öffnen und je Zeile eintragen (Reihenfolge = Abwurf-Reihenfolge, oben zuerst):',
          ...[...lm.loads]
            .sort((a, b) => b.priority - a.priority || b.slot - a.slot)
            .map(
              (l) =>
                `Last ${l.slot}: ${l.title} – Typ analog, max. ${fmt(l.maxKw)} kW (${fmt(l.maxA)} A), min. ${fmt(l.minKw)} kW`,
            ),
        ],
      })),
    ...wallboxManagers.map((wm) => ({
      block: wm.key,
      title: wm.title,
      items: [
        'Im Dialog „Konfigurieren…“ diese Wallboxen hinzufügen (Reihenfolge = Priorität):',
        ...wm.wallboxes,
      ],
    })),
  ];

  const pending = ['Freigabe (Ec) und Status der Wallbox werden noch nicht an Modbus angebunden.'];
  const modbusDevices: PlannedModbusDevice[] = [];
  const wallboxKeys = new Map(wallboxes.map((w) => [w.key, w]));
  for (const cp of project.chargePoints) {
    const wallboxKey = `cp:${cp.id}`;
    if (!wallboxKeys.has(wallboxKey)) continue;
    if (cp.protocol !== 'modbus-tcp') {
      pending.push(`${cp.label}: Protokoll ${cp.protocol} wird noch nicht übergeben.`);
      continue;
    }
    const name = renderName(project, 'modbusDevice', { label: cp.label });
    claimTitle(name, `Modbus-Gerät ${cp.label}`);
    const res = planModbusDevice(
      cp,
      models.get(cp.libraryModelId),
      { device: name, wallboxKey },
      V,
    );
    if ('problems' in res) blockers.push(...res.problems);
    else modbusDevices.push(res.device);
  }
  const servers = [...new Set(modbusDevices.map((d) => d.serverAddress))];
  const prerequisites = servers.map(
    (a) => `Modbusserver mit Adresse ${a} in Config anlegen (LastPlan kann ihn nicht einfügen).`,
  );

  return {
    pageName: `LastPlan – ${project.name}`,
    voltageV: V,
    virtualInputs,
    loadManagers,
    wallboxManagers,
    wallboxes,
    modbusDevices,
    prerequisites,
    manualSteps,
    pending,
    blockers,
  };
}

function emptyPlan(project: Project, blockers: string[]): HandoverPlan {
  return {
    pageName: `LastPlan – ${project.name}`,
    voltageV: project.settings.voltageV,
    virtualInputs: [],
    loadManagers: [],
    wallboxManagers: [],
    wallboxes: [],
    modbusDevices: [],
    prerequisites: [],
    manualSteps: [],
    pending: [],
    blockers,
  };
}

/**
 * Skript für `code_run` (ein Undo-Schritt). Daten gehen als JSON-Literal hinein, nie als
 * zusammengesetzter Code. Verwendete `cfg`-Methoden laut `sdk_describe`: get_tree,
 * get_block_properties, get_block, add_page, add_block, set_block_property, insert_object,
 * add_object_ref, connect_blocks, arrange_page, validate_project. Alles, was fehlen kann
 * (Miniserver, Modbusserver), wird vor der ersten Änderung geprüft. Gibt die angelegten UUIDs
 * je Plan-Schlüssel zurück.
 */
export function renderHandoverScript(plan: HandoverPlan): string {
  if (plan.blockers.length > 0) {
    throw new Error(`Übergabe gesperrt: ${plan.blockers.join(' ')}`);
  }
  const data = {
    pageName: plan.pageName,
    types: LOXONE_TYPES,
    props: LOXONE_PROPERTIES,
    modeOverload: LOAD_MANAGER_MODE_OVERLOAD,
    conn: {
      maxP: LOXONE_CONNECTORS.loadManagerMaxP,
      pmax: LOXONE_CONNECTORS.wallboxManagerPmax,
      viOut: LOXONE_CONNECTORS.virtualInputRefOut,
    },
    loadManagers: plan.loadManagers.map((l) => ({
      key: l.key,
      title: l.title,
      maxKw: l.maxKw,
      parent: l.parent ?? null,
    })),
    wallboxManagers: plan.wallboxManagers.map((w) => ({
      key: w.key,
      title: w.title,
      parent: w.parent,
    })),
    wallboxes: plan.wallboxes.map((w) => ({
      key: w.key,
      title: w.title,
      maxKw: w.maxKw,
      minKw: w.minKw,
    })),
    modbus: {
      types: MODBUS_TYPES,
      serverAddress: MODBUS_PROPERTIES.serverAddress,
      deviceAddress: MODBUS_PROPERTIES.deviceAddress,
    },
    modbusDevices: plan.modbusDevices,
    virtualInputs: plan.virtualInputs.map((v) => ({
      key: v.key,
      name: v.name,
      target: v.target,
    })),
  };
  return `const plan = ${JSON.stringify(data)};
${SCRIPT_BODY}`;
}

// TODO(verify): Typ-Schlüssel des Miniservers im Peripheriebaum ist nicht belegt; das Skript
// sucht ihn über den Typnamen und bricht ab, wenn es nicht genau einen findet (vor jeder Änderung).
const SCRIPT_BODY = String.raw`
const created = {};
const uuidOf = (r) => (r && r.block && r.block.uuid) || (r && r.object && r.object.uuid) || (r && r.uuid);

const miniservers = [];
const walk = (n) => {
  if (n.uuid && n.type && /miniserver/i.test(n.type) && n.isDevice) miniservers.push(n.uuid);
  for (const c of n.children || []) walk(c);
};
const tree = cfg.get_tree({});
for (const r of tree.roots) walk(r);
if (miniservers.length !== 1) {
  throw new Error('Genau ein Miniserver erwartet, gefunden: ' + miniservers.length);
}

// Modbusserver über ihre Adresse finden (vom Nutzer angelegt).
const serverByAddress = {};
const findServers = (n) => {
  if (n.uuid && n.type === plan.modbus.types.server) {
    const props = cfg.get_block_properties({ uuid: n.uuid }).properties;
    const a = props.find((p) => p.id === plan.modbus.serverAddress);
    if (a && typeof a.value === 'string') (serverByAddress[a.value.trim()] = serverByAddress[a.value.trim()] || []).push(n.uuid);
  }
  for (const c of n.children || []) findServers(c);
};
if (plan.modbusDevices.length > 0) for (const r of tree.roots) findServers(r);
const wanted = [...new Set(plan.modbusDevices.map((d) => d.serverAddress))];
const missing = wanted.filter((a) => !serverByAddress[a]);
const twice = wanted.filter((a) => serverByAddress[a] && serverByAddress[a].length > 1);
if (missing.length > 0) throw new Error('Modbusserver fehlt in Config: ' + missing.join(', '));
if (twice.length > 0) throw new Error('Modbusserver mehrfach mit gleicher Adresse: ' + twice.join(', '));

const page = uuidOf(cfg.add_page({ name: plan.pageName, context_uuid: miniservers[0] }));
created.page = page;

for (const l of plan.loadManagers) {
  const id = uuidOf(cfg.add_block({ type: plan.types.loadManager, page_uuid: page, title: l.title }));
  created[l.key] = id;
  cfg.set_block_property({ uuid: id, property_id: plan.props.loadManagerMode, value: plan.modeOverload });
  cfg.set_block_property({ uuid: id, property_id: plan.props.loadManagerMaxP, value: l.maxKw });
}
for (const w of plan.wallboxManagers) {
  created[w.key] = uuidOf(cfg.add_block({ type: plan.types.wallboxManager, page_uuid: page, title: w.title }));
}
for (const w of plan.wallboxes) {
  const id = uuidOf(cfg.add_block({ type: plan.types.wallbox, page_uuid: page, title: w.title }));
  created[w.key] = id;
  cfg.set_block_property({ uuid: id, property_id: plan.props.wallboxMaxKw, value: w.maxKw });
  cfg.set_block_property({ uuid: id, property_id: plan.props.wallboxMinKw, value: w.minKw });
}

for (const l of plan.loadManagers) {
  if (!l.parent) continue;
  cfg.connect_blocks({
    from_block_uuid: created[l.parent.key], from_connector_key: 'AQl' + l.parent.slot,
    to_block_uuid: created[l.key], to_connector_key: plan.conn.maxP,
  });
}
for (const w of plan.wallboxManagers) {
  cfg.connect_blocks({
    from_block_uuid: created[w.parent.key], from_connector_key: 'AQl' + w.parent.slot,
    to_block_uuid: created[w.key], to_connector_key: plan.conn.pmax,
  });
}

for (const v of plan.virtualInputs) {
  const vi = uuidOf(cfg.insert_object({ type: plan.types.virtualInput, parent_uuid: miniservers[0], name: v.name }));
  created[v.key] = vi;
  cfg.set_block_property({ uuid: vi, property_id: plan.props.virtualInputDigital, value: false });
  const inst = uuidOf(cfg.add_object_ref({ source_uuid: vi, page_uuid: page }));
  cfg.connect_blocks({
    from_block_uuid: inst, from_connector_key: plan.conn.viOut,
    to_block_uuid: created[v.target.key], to_connector_key: v.target.connector,
  });
}

// TODO(verify): Eingangs-Schlüssel einer platzierten Aktor-Instanz ist nicht dokumentiert; das
// Skript liest ihn per get_block und verlangt genau einen sichtbaren analogen Eingang.
const actorInput = (inst) => {
  const ins = cfg.get_block({ uuid: inst }).block.connectors.inputs.filter((c) => !c.hidden && c.dataType === 'analog');
  if (ins.length !== 1) throw new Error('Eingang der Aktor-Instanz nicht eindeutig: ' + ins.length);
  return ins[0].key;
};
for (const d of plan.modbusDevices) {
  const dev = uuidOf(cfg.insert_object({ type: plan.modbus.types.device, parent_uuid: serverByAddress[d.serverAddress][0], name: d.name }));
  created[d.key] = dev;
  cfg.set_block_property({ uuid: dev, property_id: plan.modbus.deviceAddress, value: d.unitId });
  for (const r of d.registers) {
    const type = r.kind === 'sensor' ? plan.modbus.types.analogSensor : plan.modbus.types.analogActor;
    const io = uuidOf(cfg.insert_object({ type, parent_uuid: dev, name: r.name }));
    created[d.key + ':' + r.role] = io;
    for (const id of Object.keys(r.properties)) {
      cfg.set_block_property({ uuid: io, property_id: Number(id), value: r.properties[id] });
    }
    const inst = uuidOf(cfg.add_object_ref({ source_uuid: io, page_uuid: page }));
    const wb = created[d.wallboxKey];
    if (r.kind === 'sensor') {
      cfg.connect_blocks({ from_block_uuid: inst, from_connector_key: plan.conn.viOut, to_block_uuid: wb, to_connector_key: r.wallboxConnector });
    } else {
      cfg.connect_blocks({ from_block_uuid: wb, from_connector_key: r.wallboxConnector, to_block_uuid: inst, to_connector_key: actorInput(inst) });
    }
  }
}

cfg.arrange_page({ page_uuid: page });
const validation = cfg.validate_project();
return { created, validation };
`;
