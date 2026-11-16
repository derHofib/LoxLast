import {
  clusterOwnLimit,
  kwFromA,
  minPhase,
  siteAvailableA,
  structureHash,
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
  /**
   * Eingang Ec (Ladefreigabe) der Wallbox, Schlüssel `allow` (Erkundung 3, 2026-11-16). Laut
   * `get_doc` (Wallbox): invertiert und nicht verbunden = Laden erlaubt.
   */
  wallboxEnable: 'allow',
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
  /** Schlüssel der Seite, auf der der Baustein liegt (siehe PlannedPage). */
  page: string;
}

/**
 * Eine Logik-Seite in Config. Schlüssel = Schlüssel der Ebene: `site`, `cluster:<id>`,
 * `group:<id>`. Reihenfolge der Liste = Reihenfolge des Anlegens: Standort, dann je Cluster die
 * Cluster-Seite, ihre Gruppen-Seiten, danach ihre Unter-Cluster (Tiefensuche).
 */
export interface PlannedPage {
  key: string;
  name: string;
}

export interface PlannedWallboxManager {
  key: string;
  title: string;
  parent: { key: string; slot: number };
  /** Wallbox-Titel in der Reihenfolge, in der sie im Dialog eingetragen werden. */
  wallboxes: string[];
  page: string;
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
  page: string;
}

export interface PlannedVirtualInput {
  key: string;
  name: string;
  valueKw: number;
  valueA: number;
  target: { key: string; connector: 'maxP' | 'Pmax' };
  page: string;
}

export interface HandoverPlan {
  /** Seitenname mit Kennung, z. B. „LastPlan – Tiefgarage [lastplan:3f9a0c7e21b4:1a2b3c4d]“. */
  pageName: string;
  /** Anfang der Kennung ohne Struktur-Hash; daran erkennt ein späterer Lauf die Seite (6.6). */
  pageMatch: string;
  /** Kurzer Struktur-Hash in der Kennung, zum Vergleich mit einer vorhandenen Seite. */
  pageHash: string;
  /** Alle Seiten in Anlege-Reihenfolge; die erste ist die Standort-Seite mit `pageName`. */
  pages: PlannedPage[];
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

/** Gemeinsamer Anfang mehrerer Namen, z. B. „WB_UV-2_G1_“, als Suchhinweis für die Config-Dialoge. */
export function commonPrefix(names: readonly string[]): string {
  if (names.length === 0) return '';
  let prefix = names[0] ?? '';
  for (const n of names) while (!n.startsWith(prefix)) prefix = prefix.slice(0, -1);
  return prefix;
}

const searchHint = (names: readonly string[]) => {
  // bis zum letzten Trennzeichen kürzen: „WB_TG_G1_LP0“ → „WB_TG_G1_“
  const raw = commonPrefix(names);
  const cut = Math.max(raw.lastIndexOf('_'), raw.lastIndexOf(' '));
  const prefix = cut > 0 ? raw.slice(0, cut + 1) : raw;
  return names.length > 1 && prefix.length >= 3 ? ` (Suche: „${prefix}“)` : '';
};

/**
 * Seitenkennung (Umsetzungsplan 6.6, ADR 0013 Punkt 5): `[lastplan:<Projekt>:<Struktur>]` im
 * Seitennamen. Projekt = die letzten 12 Zeichen der Projekt-ID (UUID v7: dort steckt der
 * Zufallsteil, vorn die Uhrzeit), Struktur = die ersten 8 Zeichen des Struktur-Hashes. Der
 * Seitenname ist die einzige Stelle, die `get_pages` zurückgibt; ein Notiz-Baustein wäre erst nach
 * `get_page` je Seite lesbar.
 */
export function pageTag(project: Project): { match: string; hash: string; tag: string } {
  const id = project.id.replace(/-/g, '').slice(-12);
  const full = structureHash(project);
  const hash = (full.split(':')[1] ?? full).slice(0, 8);
  const match = `[lastplan:${id}:`;
  return { match, hash, tag: `${match}${hash}]` };
}

/** Liest den Struktur-Hash aus einem Seitennamen mit Kennung, sonst undefined. */
export function hashFromPageName(name: string, match: string): string | undefined {
  const at = name.indexOf(match);
  if (at < 0) return undefined;
  const rest = name.slice(at + match.length);
  const end = rest.indexOf(']');
  return end > 0 ? rest.slice(0, end) : undefined;
}

const pageFields = (project: Project) => {
  const t = pageTag(project);
  return {
    pageName: `Standort – ${project.name} ${t.tag}`,
    pageMatch: t.match,
    pageHash: t.hash,
  };
};

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
  /** Laufende Nummer der Gruppe in ihrem Cluster (1, 2, …), für {groupNo}. */
  const groupNo = (group: Group) =>
    String(project.groups.filter((g) => g.clusterId === group.clusterId).indexOf(group) + 1);
  const planGroup = (group: Group, clusterName: string, parentKey: string, slot: number) => {
    const key = `group:${group.id}`;
    const names = { cluster: clusterName, group: group.name, groupNo: groupNo(group) };
    const title = renderName(project, 'groupLimit', names);
    claimTitle(title, `Gruppe ${group.name}`);
    const cps = project.chargePoints.filter((cp) => cp.groupId === group.id);
    const titlesOfGroup: string[] = [];
    let minKw = Number.POSITIVE_INFINITY;
    for (const cp of cps) {
      const wbTitle = renderName(project, 'wallbox', { ...names, label: cp.label });
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
        page: key,
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
      page: key,
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
      page: key,
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
      name: `VI_${siteTitle} Limit kW (${fmt(siteA)} A)`,
      valueKw: kw3(siteA),
      valueA: siteA,
      target: { key: 'site', connector: LOXONE_CONNECTORS.loadManagerMaxP },
      page: 'site',
    },
  ];

  // Seiten (Tiefensuche): Standort, je Cluster die Cluster-Seite, ihre Gruppen (G1, G2 …), dann
  // ihre Unter-Cluster. Namen zeigen die Zugehörigkeit: „TG“, „TG · G1 Flotte“, „TG › Strang“.
  const { pageName } = pageFields(project);
  const pages: PlannedPage[] = [{ key: 'site', name: pageName }];
  const pageNames = new Set<string>([pageName]);
  const addPage = (key: string, name: string) => {
    if (pageNames.has(name)) blockers.push(`Seitenname „${name}“ kommt doppelt vor.`);
    pageNames.add(name);
    pages.push({ key, name });
  };
  const visitCluster = (c: Cluster, path: string) => {
    addPage(`cluster:${c.id}`, path);
    const groups = project.groups.filter((g) => g.clusterId === c.id);
    groups.forEach((g, i) => addPage(`group:${g.id}`, `${path} · G${i + 1} ${g.name}`));
    for (const child of childClusters(c.id)) visitCluster(child, `${path} › ${child.name}`);
  };
  for (const c of childClusters(undefined)) visitCluster(c, c.name);

  const manualSteps: ManualStep[] = [
    ...loadManagers
      .filter((lm) => lm.loads.length > 0)
      .map((lm) => ({
        block: lm.key,
        title: lm.title,
        items: [
          `Lasttabelle öffnen und je Zeile eintragen${searchHint(lm.loads.map((l) => l.title))} (Reihenfolge = Abwurf-Reihenfolge, oben zuerst):`,
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
        `Im Dialog „Konfigurieren…“ diese Wallboxen hinzufügen${searchHint(wm.wallboxes)} (Reihenfolge = Priorität):`,
        ...wm.wallboxes,
      ],
    })),
    ...(wallboxes.length > 0
      ? [
          {
            block: 'wallbox-enable',
            title: 'Ladefreigabe (Ec), nur bei Bedarf',
            items: [
              'LastPlan hat Ec bei jeder Wallbox invertiert und offen gelassen, damit ist Laden immer erlaubt. Wer eine Freigabe per App, Schalter o. Ä. will, verbindet Ec und nimmt die Invertierung zurück:',
              ...wallboxes.map((w) => w.title),
            ],
          },
        ]
      : []),
  ];

  const pending = [
    'Status der Wallbox (z. B. Fahrzeug verbunden) wird noch nicht an Modbus angebunden.',
  ];
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
    (a) =>
      `Modbusserver für ${a} in Config anlegen (LastPlan kann ihn nicht einfügen). Adresse leer lassen, dann trägt LastPlan sie ein, oder selbst eintragen.`,
  );

  return {
    ...pageFields(project),
    pages,
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
    ...pageFields(project),
    pages: [{ key: 'site', name: pageFields(project).pageName }],
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
 * zusammengesetzter Code. Verwendete `cfg`-Methoden laut `sdk_describe`: get_tree, get_pages,
 * get_page, get_insertable_types, get_block_properties, get_block, add_page, add_block,
 * set_block_property, set_connector_inverted, insert_object, add_object_ref, connect_blocks,
 * remove_block, arrange_page,
 * validate_project. Alles, was fehlen kann (Miniserver, Modbusserver), und alles, was doppelt
 * entstehen würde, wird vor der ersten Änderung geprüft.
 *
 * Wiedererkennung (6.6): Gibt es schon eine Seite mit der Kennung dieses Projekts, ändert das
 * Skript ohne `replace` nichts und meldet sie (`outcome: 'exists'`). Mit `replace` entfernt es
 * zuerst, was der letzte Lauf angelegt hat (Seiten samt Bausteinen, virtuelle Eingänge,
 * Modbus-Geräte laut `previous`), und legt dann neu an – alles in derselben Undo-Gruppe.
 */
/** Was das Skript braucht; das Gateway erhält genau diese Felder (protocol: ConfigHandoverPlan). */
export interface HandoverScriptInput {
  pageName: string;
  pageMatch: string;
  /** Vorhandene Seite mit derselben Kennung ersetzen statt abbrechen. */
  replace?: boolean;
  /** Was der letzte Lauf angelegt hat (aus dem ExportRecord); wird beim Ersetzen entfernt. */
  previous?: PreviousHandover;
  pages: PlannedPage[];
  loadManagers: Array<
    Pick<PlannedLoadManager, 'key' | 'title' | 'maxKw' | 'page'> & {
      parent?: PlannedLoadManager['parent'];
    }
  >;
  wallboxManagers: Array<Pick<PlannedWallboxManager, 'key' | 'title' | 'parent' | 'page'>>;
  wallboxes: Array<Pick<PlannedWallbox, 'key' | 'title' | 'maxKw' | 'minKw' | 'page'>>;
  virtualInputs: Array<Pick<PlannedVirtualInput, 'key' | 'name' | 'target' | 'page'>>;
  modbusDevices: Array<
    Omit<PlannedModbusDevice, 'registers'> & {
      registers: Array<
        Omit<PlannedModbusDevice['registers'][number], 'role' | 'properties'> & {
          role: string;
          properties: Record<string, number | boolean | string>;
        }
      >;
    }
  >;
  blockers?: readonly string[];
}

/** UUIDs aus einem früheren Lauf: Seiten (auch Folgeseiten) und Objekte im Peripheriebaum. */
export interface PreviousHandover {
  pages: string[];
  periphery: string[];
}

/** Nur die Felder, die das Gateway zum Ausführen braucht (ohne Anzeige-Angaben). */
export function handoverScriptInput(
  plan: HandoverPlan,
  options: { replace?: boolean; previous?: PreviousHandover | undefined } = {},
): HandoverScriptInput {
  return {
    pageName: plan.pageName,
    pageMatch: plan.pageMatch,
    replace: options.replace ?? false,
    previous: options.previous ?? { pages: [], periphery: [] },
    pages: plan.pages,
    loadManagers: plan.loadManagers.map(({ key, title, maxKw, parent, page }) => ({
      key,
      title,
      maxKw,
      page,
      ...(parent ? { parent } : {}),
    })),
    wallboxManagers: plan.wallboxManagers.map(({ key, title, parent, page }) => ({
      key,
      title,
      parent,
      page,
    })),
    wallboxes: plan.wallboxes.map(({ key, title, maxKw, minKw, page }) => ({
      key,
      title,
      maxKw,
      minKw,
      page,
    })),
    virtualInputs: plan.virtualInputs.map(({ key, name, target, page }) => ({
      key,
      name,
      target,
      page,
    })),
    modbusDevices: plan.modbusDevices,
  };
}

export function renderHandoverScript(plan: HandoverScriptInput): string {
  if (plan.blockers && plan.blockers.length > 0) {
    throw new Error(`Übergabe gesperrt: ${plan.blockers.join(' ')}`);
  }
  const data = {
    pageName: plan.pageName,
    pageMatch: plan.pageMatch,
    replace: plan.replace ?? false,
    previous: plan.previous ?? { pages: [], periphery: [] },
    types: LOXONE_TYPES,
    props: LOXONE_PROPERTIES,
    modeOverload: LOAD_MANAGER_MODE_OVERLOAD,
    conn: {
      enable: LOXONE_CONNECTORS.wallboxEnable,
      maxP: LOXONE_CONNECTORS.loadManagerMaxP,
      pmax: LOXONE_CONNECTORS.wallboxManagerPmax,
      viOut: LOXONE_CONNECTORS.virtualInputRefOut,
    },
    pages: plan.pages.map((p) => ({ key: p.key, name: p.name })),
    loadManagers: plan.loadManagers.map((l) => ({
      key: l.key,
      title: l.title,
      maxKw: l.maxKw,
      page: l.page,
      parent: l.parent ?? null,
    })),
    wallboxManagers: plan.wallboxManagers.map((w) => ({
      key: w.key,
      title: w.title,
      page: w.page,
      parent: w.parent,
    })),
    wallboxes: plan.wallboxes.map((w) => ({
      key: w.key,
      title: w.title,
      maxKw: w.maxKw,
      minKw: w.minKw,
      page: w.page,
    })),
    modbus: {
      types: MODBUS_TYPES,
      serverAddress: MODBUS_PROPERTIES.serverAddress,
      deviceAddress: MODBUS_PROPERTIES.deviceAddress,
      dataType: MODBUS_PROPERTIES.dataType,
    },
    // Modbus-Referenzen liegen auf der Seite ihrer Wallbox.
    modbusDevices: plan.modbusDevices.map((d) => ({
      ...d,
      page: plan.wallboxes.find((w) => w.key === d.wallboxKey)?.page ?? plan.pages[0]?.key ?? '',
    })),
    virtualInputs: plan.virtualInputs.map((v) => ({
      key: v.key,
      name: v.name,
      target: v.target,
      page: v.page,
    })),
  };
  return `const plan = ${JSON.stringify(data)};
${SCRIPT_BODY}`;
}

// Miniserver: Typ `LoxLIVE` (Test von Dennis am 2026-11-16, Projekt „Lox Grundschulung“). Das
// Skript nimmt einen Knoten mit diesem Typ oder mit „Miniserver“ im Typ, sonst das einzige Gerät
// direkt unter der Projektwurzel. Ist das nicht eindeutig, bricht es vor jeder Änderung ab und
// nennt, was unter der Wurzel steht. Den Ort für virtuelle Eingänge fragt es mit
// get_insertable_types ab, statt ihn anzunehmen. Modbusserver lassen sich per SDK nicht einfügen
// (kein Katalogtyp, gleicher Test); sie bleiben Voraussetzung.
const SCRIPT_BODY = String.raw`
const created = {};
// Antwortformen laut Test 2026-11-16: add_page → { page }, insert_object → { object }, add_block → { block }.
const uuidOf = (r) => {
  const id = (r && r.block && r.block.uuid) || (r && r.object && r.object.uuid) || (r && r.page && r.page.uuid) || (r && r.uuid);
  if (!id) throw new Error('Antwort ohne UUID: ' + JSON.stringify(r).slice(0, 200));
  return id;
};

const tree = cfg.get_tree({});
let miniservers = [];
const walk = (n) => {
  if (n.uuid && n.type && /^LoxLIVE$|miniserver/i.test(n.type) && n.isDevice) miniservers.push(n);
  for (const c of n.children || []) walk(c);
};
for (const r of tree.roots) walk(r);
const topLevel = [];
for (const r of tree.roots) for (const c of r.children || []) topLevel.push(c);
if (miniservers.length === 0) miniservers = topLevel.filter((c) => c.uuid && c.isDevice);
if (miniservers.length !== 1) {
  const seen = topLevel.map((c) => c.name + ' (' + c.type + (c.isDevice ? ', Gerät' : '') + ')').join('; ');
  throw new Error('Genau ein Miniserver erwartet, gefunden: ' + miniservers.length + '. Unter der Projektwurzel: ' + (seen || 'nichts'));
}
const miniserver = miniservers[0];

// Ort für virtuelle Eingänge: der Miniserver selbst oder einer seiner direkten Unterknoten.
let virtualParent;
if (plan.virtualInputs.length > 0) {
  const canHold = (n) => n.uuid && cfg.get_insertable_types({ parent_uuid: n.uuid }).types.some((t) => t.type === plan.types.virtualInput);
  const places = [miniserver].concat(miniserver.children || []);
  for (const n of places) if (canHold(n)) { virtualParent = n.uuid; break; }
  if (!virtualParent) throw new Error('Kein Ort für virtuelle Eingänge unter dem Miniserver „' + miniserver.name + '“ gefunden.');
}

// Modbusserver über ihre Adresse finden (vom Nutzer angelegt). Fehlt eine Adresse, bekommt sie
// ein vom Nutzer angelegter Modbusserver mit leerer Adresse (Eigenschaft 1000 ist änderbar).
const serverByAddress = {};
const serversSeen = [];
const emptyServers = [];
const findServers = (n) => {
  if (n.uuid && n.type === plan.modbus.types.server) {
    const props = cfg.get_block_properties({ uuid: n.uuid }).properties;
    const a = props.find((p) => p.id === plan.modbus.serverAddress);
    const value = a && typeof a.value === 'string' ? a.value.trim() : '';
    serversSeen.push(n.name + ' „' + value + '“');
    if (value) (serverByAddress[value] = serverByAddress[value] || []).push(n.uuid);
    else emptyServers.push(n.uuid);
  }
  for (const c of n.children || []) findServers(c);
};
if (plan.modbusDevices.length > 0) for (const r of tree.roots) findServers(r);
const wanted = [...new Set(plan.modbusDevices.map((d) => d.serverAddress))];
const missing = wanted.filter((a) => !serverByAddress[a]);
const twice = wanted.filter((a) => serverByAddress[a] && serverByAddress[a].length > 1);
if (missing.length > emptyServers.length) {
  throw new Error('Modbusserver fehlt in Config: ' + missing.join(', ') + '. Es fehlen ' + (missing.length - emptyServers.length) + ' Modbusserver (mit dieser Adresse oder mit leerer Adresse). Gefunden (Name „Adresse“): ' + (serversSeen.join('; ') || 'keiner'));
}
if (twice.length > 0) throw new Error('Modbusserver mehrfach mit gleicher Adresse: ' + twice.join(', '));

// Wiedererkennung (6.6): Seiten dieses Projekts (Kennung im Namen) und Folgeseiten des letzten
// Laufs. Ohne replace: nichts ändern, nur melden.
const prevPages = new Set(plan.previous.pages);
const prevPeriphery = new Set(plan.previous.periphery);
const ours = cfg.get_pages({}).pages.filter((p) => p.name.indexOf(plan.pageMatch) !== -1 || prevPages.has(p.uuid));
if (ours.length > 0 && !plan.replace) {
  return { outcome: 'exists', existingPages: ours.map((p) => ({ name: p.name, uuid: p.uuid })), created: {}, pages: [], periphery: [], removed: 0, validation: null };
}

// Was der letzte Lauf im Peripheriebaum angelegt hat und noch da ist.
const byUuid = {};
const index = (n) => { if (n.uuid) byUuid[n.uuid] = n; for (const c of n.children || []) index(c); };
for (const r of tree.roots) index(r);
const removePeriphery = plan.previous.periphery.filter((u) => byUuid[u]);
const goingAway = new Set();
const markGone = (n) => { if (n.uuid) goingAway.add(n.uuid); for (const c of n.children || []) markGone(c); };
for (const u of removePeriphery) markGone(byUuid[u]);

// Doppelte Namen vermeiden: Ein virtueller Eingang oder ein Modbus-Gerät mit einem geplanten Namen,
// das nicht entfernt wird, stammt vermutlich aus einer älteren Übergabe ohne Kennung.
const viNames = new Set(plan.virtualInputs.map((v) => v.name));
const devNames = new Set(plan.modbusDevices.map((d) => d.name));
const clashes = [];
const findClashes = (n) => {
  if (n.uuid && !goingAway.has(n.uuid)) {
    if (n.type === plan.types.virtualInput && viNames.has(n.name)) clashes.push(n.name);
    if (n.type === plan.modbus.types.device && devNames.has(n.name)) clashes.push(n.name);
  }
  for (const c of n.children || []) findClashes(c);
};
for (const r of tree.roots) findClashes(r);
if (clashes.length > 0) {
  throw new Error('In Config gibt es schon Objekte mit diesen Namen: ' + clashes.join(', ') + '. Vermutlich stammen sie aus einer älteren Übergabe. Bitte sie und die alte LastPlan-Seite in Config löschen, dann neu übergeben.');
}

// Ab hier wird geändert. Zuerst das Alte entfernen: Peripherie (mit ihren Ein-/Ausgängen und
// Referenzen), dann jede Seite Baustein für Baustein und die leere Seite selbst.
let removed = 0;
for (const u of removePeriphery) { cfg.remove_block({ uuid: u }); removed++; }
for (const p of ours) {
  let guard = 0;
  let blocks;
  while ((blocks = cfg.get_page({ uuid: p.uuid }).page.functionBlocks).length > 0) {
    if (++guard > 20000) throw new Error('Seite „' + p.name + '“ lässt sich nicht leeren.');
    cfg.remove_block({ uuid: blocks[0].uuid });
    removed++;
  }
  cfg.remove_block({ uuid: p.uuid });
}

missing.forEach((address, i) => {
  const uuid = emptyServers[i];
  cfg.set_block_property({ uuid, property_id: plan.modbus.serverAddress, value: address });
  serverByAddress[address] = [uuid];
  created['server:' + address] = uuid;
});

// Seiten in Anlege-Reihenfolge (Standort, Cluster, Gruppen …). Was auf einer anderen Seite liegt
// als sein Gegenüber, wird als Referenz verbunden (connect_blocks reference: true).
const pageOf = {};
for (const p of plan.pages) {
  pageOf[p.key] = uuidOf(cfg.add_page({ name: p.name, context_uuid: miniserver.uuid }));
  created['page:' + p.key] = pageOf[p.key];
}
const pageOfBlock = {};
const connect = (from, fromKey, to, toKey) => {
  const p = { from_block_uuid: from, from_connector_key: fromKey, to_block_uuid: to, to_connector_key: toKey };
  if (pageOfBlock[from] !== pageOfBlock[to]) p.reference = true;
  cfg.connect_blocks(p);
};
const place = (type, pageKey, title) => {
  const id = uuidOf(cfg.add_block({ type, page_uuid: pageOf[pageKey], title }));
  pageOfBlock[id] = pageKey;
  return id;
};
const placeRef = (source, pageKey) => {
  const id = uuidOf(cfg.add_object_ref({ source_uuid: source, page_uuid: pageOf[pageKey] }));
  pageOfBlock[id] = pageKey;
  return id;
};

for (const l of plan.loadManagers) {
  const id = place(plan.types.loadManager, l.page, l.title);
  created[l.key] = id;
  cfg.set_block_property({ uuid: id, property_id: plan.props.loadManagerMode, value: plan.modeOverload });
  cfg.set_block_property({ uuid: id, property_id: plan.props.loadManagerMaxP, value: l.maxKw });
}
for (const w of plan.wallboxManagers) {
  created[w.key] = place(plan.types.wallboxManager, w.page, w.title);
}
for (const w of plan.wallboxes) {
  const id = place(plan.types.wallbox, w.page, w.title);
  created[w.key] = id;
  cfg.set_block_property({ uuid: id, property_id: plan.props.wallboxMaxKw, value: w.maxKw });
  cfg.set_block_property({ uuid: id, property_id: plan.props.wallboxMinKw, value: w.minKw });
  // Ladefreigabe: invertiert und offen = Laden erlaubt (get_doc Wallbox).
  cfg.set_connector_inverted({ block_uuid: id, connector_key: plan.conn.enable, inverted: true });
}

for (const l of plan.loadManagers) {
  if (!l.parent) continue;
  connect(created[l.parent.key], 'AQl' + l.parent.slot, created[l.key], plan.conn.maxP);
}
for (const w of plan.wallboxManagers) {
  connect(created[w.parent.key], 'AQl' + w.parent.slot, created[w.key], plan.conn.pmax);
}

for (const v of plan.virtualInputs) {
  const vi = uuidOf(cfg.insert_object({ type: plan.types.virtualInput, parent_uuid: virtualParent, name: v.name }));
  created[v.key] = vi;
  cfg.set_block_property({ uuid: vi, property_id: plan.props.virtualInputDigital, value: false });
  const inst = placeRef(vi, v.page);
  connect(inst, plan.conn.viOut, created[v.target.key], v.target.connector);
}

// TODO(verify): Eingangs-Schlüssel einer platzierten Aktor-Instanz ist nicht dokumentiert; das
// Skript liest ihn per get_block und verlangt genau einen sichtbaren analogen Eingang.
const actorInput = (inst) => {
  const ins = cfg.get_block({ uuid: inst }).block.connectors.inputs.filter((c) => !c.hidden && c.dataType === 'analog');
  if (ins.length !== 1) throw new Error('Eingang der Aktor-Instanz nicht eindeutig: ' + ins.length);
  return ins[0].key;
};
// Ob „16-Bit Register“ und „Wortreihenfolge“ änderbar sind, hängt vom Datentyp ab (Erkundung
// 2026-11-16: bei 16-Bit-Typen schreibgeschützt und aus). Deshalb zuerst den Datentyp setzen, dann
// die Eigenschaften neu lesen. Schreibgeschützte werden übersprungen, wenn sie schon passen;
// sonst bricht das Skript mit Namen und Werten ab.
const setIoProperties = (uuid, props) => {
  const ids = Object.keys(props).map(Number);
  if (ids.includes(plan.modbus.dataType)) {
    cfg.set_block_property({ uuid, property_id: plan.modbus.dataType, value: props[plan.modbus.dataType] });
  }
  const current = cfg.get_block_properties({ uuid }).properties;
  for (const id of ids) {
    if (id === plan.modbus.dataType) continue;
    const want = props[id];
    const p = current.find((c) => c.id === id);
    if (p && p.editable === false) {
      if (p.value === want) continue;
      throw new Error('Eigenschaft ' + id + ' (' + p.name + ') ist in Config schreibgeschützt und steht auf ' + JSON.stringify(p.value) + ', gebraucht wird ' + JSON.stringify(want) + '.');
    }
    cfg.set_block_property({ uuid, property_id: id, value: want });
  }
};

for (const d of plan.modbusDevices) {
  const dev = uuidOf(cfg.insert_object({ type: plan.modbus.types.device, parent_uuid: serverByAddress[d.serverAddress][0], name: d.name }));
  created[d.key] = dev;
  cfg.set_block_property({ uuid: dev, property_id: plan.modbus.deviceAddress, value: d.unitId });
  for (const r of d.registers) {
    const type = r.kind === 'sensor' ? plan.modbus.types.analogSensor : plan.modbus.types.analogActor;
    const io = uuidOf(cfg.insert_object({ type, parent_uuid: dev, name: r.name }));
    created[d.key + ':' + r.role] = io;
    setIoProperties(io, r.properties);
    const inst = placeRef(io, d.page);
    const wb = created[d.wallboxKey];
    if (r.kind === 'sensor') connect(inst, plan.conn.viOut, wb, r.wallboxConnector);
    else connect(wb, r.wallboxConnector, inst, actorInput(inst));
  }
}

const allPages = [];
for (const p of plan.pages) {
  allPages.push(pageOf[p.key]);
  const arranged = cfg.arrange_page({ page_uuid: pageOf[p.key] });
  for (const o of (arranged && arranged.overflowPages) || []) if (o.uuid) allPages.push(o.uuid);
}
const periphery = plan.virtualInputs.map((v) => created[v.key]).concat(plan.modbusDevices.map((d) => created[d.key]));
const validation = cfg.validate_project();
return {
  outcome: ours.length > 0 ? 'replaced' : 'created',
  existingPages: ours.map((p) => ({ name: p.name, uuid: p.uuid })),
  created, pages: allPages, periphery, removed, validation,
};
`;
