import { describe, expect, it } from 'vitest';
import { NAMING_SCHEME_V1, createProject, type ChargePoint, type Project } from '@lastplan/core';
import type { RegisterDef, WallboxModel } from '@lastplan/wallbox-library';
import {
  buildHandoverPlan,
  handoverScriptInput,
  hashFromPageName,
  LOAD_MANAGER_SLOTS,
  pageTag,
  renderHandoverScript,
  renderName,
  type HandoverPlan,
} from './config-handover';

/** Testmodell, KEIN reales Gerät: Registerwerte frei gewählt, nur für die Abbildung. */
const reg = (over: Partial<RegisterDef>): RegisterDef => ({
  address: 100,
  fn: 3,
  type: 'uint16',
  scale: 1,
  access: 'r',
  unit: 'A',
  source: 'Test',
  ...over,
});
export const TEST_MODEL: WallboxModel = {
  id: 'test/wallbox@1',
  vendor: 'Test',
  model: 'Testwallbox',
  firmware: { min: '1', max: null, source: 'Test' },
  protocols: ['modbus-tcp'],
  electrical: { minA: 6, maxA: 32, phases: [1, 3], phaseSwitching: false, source: 'Test' },
  modbus: {
    defaultPort: 502,
    defaultUnitId: 1,
    byteOrder: 'word-swapped',
    registers: {
      setpointCurrent: reg({ address: 200, fn: 16, type: 'uint16', scale: 0.1, access: 'rw' }),
      power: reg({ address: 10, fn: 4, type: 'uint32', scale: 1, unit: 'W' }),
      energy: reg({
        address: 20,
        fn: 4,
        type: 'float32',
        scale: 1,
        unit: 'kWh',
        byteOrder: 'big-endian',
      }),
    },
    source: 'Test',
  },
  loxone: { functionBlock: 'Wallbox', inputs: {}, outputs: {}, source: 'Test' },
};
const MODELS = new Map([[TEST_MODEL.id, TEST_MODEL]]);
const withModel = (
  registers: WallboxModel['modbus']['registers'],
  byteOrder: WallboxModel['modbus']['byteOrder'] = 'word-swapped',
) =>
  new Map([
    [TEST_MODEL.id, { ...TEST_MODEL, modbus: { ...TEST_MODEL.modbus, byteOrder, registers } }],
  ]);

const NOW = () => new Date('2026-11-16T12:00:00.000Z');
let n = 0;
const id = () => `0190a0b0-0000-7000-8000-${String(++n).padStart(12, '0')}`;

const cp = (groupId: string, label: string, over: Partial<ChargePoint> = {}): ChargePoint => ({
  id: id(),
  label,
  groupId,
  libraryModelId: 'test/wallbox@1',
  network: { ip: '192.168.10.21', port: 502, unitId: 1 },
  protocol: 'modbus-tcp',
  fuseA: 32,
  minA: 6,
  maxA: 16,
  phases: 3,
  phaseRotation: 'L1-L2-L3',
  phaseSwitching: false,
  ...over,
});

/** Hausanschluss 250 A − 80 A Reserve; UV-TG (125 A) mit UV-Strang (63 A); Gruppen darunter. */
function sample(): Project {
  const p = createProject({ name: 'Tiefgarage', now: NOW });
  const tg = { id: id(), name: 'TG', limitA: 125 };
  const strang = { id: id(), name: 'Strang', limitA: 63, parentClusterId: tg.id };
  const mieter = { id: id(), name: 'Mieter', clusterId: tg.id, priority: 2 as const };
  const flotte = { id: id(), name: 'Flotte', clusterId: tg.id, priority: 1 as const, maxA: 50 };
  const gaeste = { id: id(), name: 'Gäste', clusterId: strang.id, priority: 3 as const };
  return {
    ...p,
    // Die meisten Fälle prüfen mit dem alten, kurzen Schema; das neue Standard-Schema hat einen eigenen Test.
    settings: { ...p.settings, namingScheme: { ...NAMING_SCHEME_V1 } },
    site: { gridConnectionFuseA: 250, gridConnectionLabel: 'HAK', buildingReserveA: 80 },
    clusters: [tg, strang],
    groups: [mieter, flotte, gaeste],
    chargePoints: [
      cp(mieter.id, 'LP01'),
      cp(mieter.id, 'LP02', { minA: 8 }),
      cp(flotte.id, 'LP03', { phases: 1, maxA: 32 }),
      cp(gaeste.id, 'LP04'),
    ],
  };
}

describe('buildHandoverPlan', () => {
  it('bildet Standort, Cluster und Gruppen auf Lastmanager und Wallbox Manager ab', () => {
    const plan = buildHandoverPlan(sample(), MODELS);
    expect(plan.blockers).toEqual([]);
    expect(plan.pageName).toMatch(/^Standort – Tiefgarage \[lastplan:[0-9a-f]{12}:[0-9a-f]{8}\]$/);
    expect(plan.pageName).toContain(plan.pageMatch + plan.pageHash + ']');
    expect(
      plan.loadManagers.map((l) => [l.key.split(':')[0], l.title, l.maxKw, l.parent?.slot]),
    ).toEqual([
      ['site', 'LM_Standort', 117.3, undefined], // 170 A · 230 V · 3
      ['cluster', 'LM_TG', 86.25, 1],
      ['cluster', 'LM_Strang', 43.47, 1],
    ]);
    const tg = plan.loadManagers[1]!;
    // Erst Unter-Cluster, dann Gruppen nach Priorität.
    expect(tg.loads.map((l) => [l.slot, l.title, l.kind, l.maxKw, l.priority])).toEqual([
      [1, 'LM_Strang', 'cluster', 43.47, 1],
      [2, 'LIM_TG_Flotte', 'group', 34.5, 1],
      [3, 'LIM_TG_Mieter', 'group', 86.25, 2],
    ]);
    expect(plan.wallboxManagers.map((w) => [w.title, w.parent.slot, w.wallboxes])).toEqual([
      ['LIM_Strang_Gäste', 1, ['WB_LP04']],
      ['LIM_TG_Flotte', 2, ['WB_LP03']],
      ['LIM_TG_Mieter', 3, ['WB_LP01', 'WB_LP02']],
    ]);
  });

  it('rechnet A in kW: Obergrenzen abgerundet, Mindestwerte aufgerundet, je Phasenzahl', () => {
    const plan = buildHandoverPlan(sample(), MODELS);
    const wb = Object.fromEntries(plan.wallboxes.map((w) => [w.title, w]));
    expect(wb['WB_LP01']).toMatchObject({ maxKw: 11.04, minKw: 4.14, phases: 3 });
    expect(wb['WB_LP03']).toMatchObject({ maxKw: 7.36, minKw: 1.38, phases: 1 });
    const p = sample();
    p.settings.voltageV = 231;
    const w = buildHandoverPlan(p, MODELS).wallboxes[0]!;
    expect(w.maxKw).toBe(11.08); // 11,088 → ab
    expect(w.minKw).toBe(4.16); // 4,158 → auf
    // Mindestleistung einer Last: kleinste Wallbox-Mindestleistung darunter.
    const tg = buildHandoverPlan(sample(), MODELS).loadManagers[1]!;
    expect(tg.loads.find((l) => l.title === 'LIM_TG_Mieter')?.minKw).toBe(4.14);
    expect(tg.loads.find((l) => l.title === 'LM_Strang')?.minKw).toBe(4.14);
  });

  it('abweichende Phasen-Limits: das kleinste zählt', () => {
    const p = sample();
    p.clusters[0] = { ...p.clusters[0]!, phaseLimitA: [125, 100, 125] };
    expect(buildHandoverPlan(p, MODELS).loadManagers[1]?.maxA).toBe(100);
  });

  it('Standort-Limit kommt über einen analogen virtuellen Eingang', () => {
    const plan = buildHandoverPlan(sample(), MODELS);
    expect(plan.virtualInputs).toEqual([
      {
        key: 'vi:site',
        name: 'VI_LM_Standort Limit kW (170 A)',
        valueKw: 117.3,
        valueA: 170,
        target: { key: 'site', connector: 'maxP' },
        page: 'site',
      },
    ]);
  });

  it('Seiten: Standort, je Cluster eine, je Gruppe eine; Namen zeigen die Zugehörigkeit', () => {
    const plan = buildHandoverPlan(sample(), MODELS);
    expect(plan.pages.map((p) => p.name)).toEqual([
      plan.pageName,
      'TG',
      'TG · G1 Mieter',
      'TG · G2 Flotte',
      'TG › Strang',
      'TG › Strang · G1 Gäste',
    ]);
    const pageName = new Map(plan.pages.map((p) => [p.key, p.name]));
    const on = (page: string) => pageName.get(page);
    expect(plan.loadManagers.map((l) => [l.title, on(l.page)])).toEqual([
      ['LM_Standort', plan.pageName],
      ['LM_TG', 'TG'],
      ['LM_Strang', 'TG › Strang'],
    ]);
    expect(plan.wallboxManagers.map((w) => [w.title, on(w.page)])).toEqual([
      ['LIM_Strang_Gäste', 'TG › Strang · G1 Gäste'],
      ['LIM_TG_Flotte', 'TG · G2 Flotte'],
      ['LIM_TG_Mieter', 'TG · G1 Mieter'],
    ]);
    expect(plan.wallboxes.map((w) => [w.title, on(w.page)])).toContainEqual([
      'WB_LP01',
      'TG · G1 Mieter',
    ]);
  });

  it('Abhak-Liste: Lasttabelle in Abwurf-Reihenfolge, Wallboxen je Wallbox Manager', () => {
    const plan = buildHandoverPlan(sample(), MODELS);
    const tg = plan.manualSteps.find((s) => s.title === 'LM_TG')!;
    expect(tg.items.slice(1)).toEqual([
      'Last 3: LIM_TG_Mieter – Typ analog, max. 86,25 kW (125 A), min. 4,14 kW',
      'Last 2: LIM_TG_Flotte – Typ analog, max. 34,5 kW (50 A), min. 1,38 kW',
      'Last 1: LM_Strang – Typ analog, max. 43,47 kW (63 A), min. 4,14 kW',
    ]);
    expect(plan.manualSteps.find((s) => s.title === 'LIM_TG_Mieter')?.items.slice(1)).toEqual([
      'WB_LP01',
      'WB_LP02',
    ]);
    const ec = plan.manualSteps.find((s) => s.block === 'wallbox-enable')!;
    expect(ec.title).toBe('Ladefreigabe (Ec)');
    expect(ec.items.slice(1)).toEqual(plan.wallboxes.map((w) => w.title));
    expect(plan.pending.length).toBeGreaterThan(0);
  });

  it('Namen folgen dem Benennungsschema', () => {
    const p = sample();
    p.settings.namingScheme = {
      ...p.settings.namingScheme,
      clusterManager: 'Last {cluster}',
      wallbox: 'Wallbox {label}',
    };
    const plan = buildHandoverPlan(p, MODELS);
    expect(plan.loadManagers[1]?.title).toBe('Last TG');
    expect(plan.wallboxes[0]?.title).toBe('Wallbox LP04');
    expect(renderName(p, 'groupLimit', { cluster: 'A' })).toBe('LIM_A_');
  });

  it('Standard-Schema: Name beginnt mit dem Elternbaustein, Gruppe als G1, G2 …', () => {
    const p = { ...sample(), settings: createProject({ name: 'x', now: NOW }).settings };
    const plan = buildHandoverPlan(p, MODELS);
    expect(plan.wallboxManagers.map((w) => [w.title, w.wallboxes])).toEqual([
      ['WM_Strang_G1', ['WB_Strang_G1_LP04']],
      ['WM_TG_G2', ['WB_TG_G2_LP03']],
      ['WM_TG_G1', ['WB_TG_G1_LP01', 'WB_TG_G1_LP02']],
    ]);
    const steps = Object.fromEntries(plan.manualSteps.map((s) => [s.title, s.items[0]]));
    expect(steps['WM_TG_G1']).toContain('(Suche: „WB_TG_G1_“)');
    expect(steps['LM_TG']).not.toContain('Suche');
    expect(plan.virtualInputs[0]?.name).toMatch(/^VI_LM_Standort Limit kW \(/);
  });

  it('sperrt bei fehlenden Angaben, doppelten Namen, leeren Gruppen und Kreisen', () => {
    const p = sample();
    p.chargePoints[0] = { ...p.chargePoints[0]!, missingFields: ['minA'] };
    p.chargePoints[1] = { ...p.chargePoints[1]!, label: 'LP01' };
    p.groups.push({ id: id(), name: 'Leer', clusterId: p.clusters[0]!.id, priority: 5 });
    p.groups.push({ id: id(), name: 'Waise', clusterId: id(), priority: 5 });
    p.site.buildingReserveA = 250;
    const b = buildHandoverPlan(p, MODELS).blockers.join('\n');
    expect(b).toContain('LP01: Angaben fehlen');
    expect(b).toContain('„WB_LP01“ kommt doppelt vor');
    expect(b).toContain('„Leer“ hat keine Ladepunkte');
    expect(b).toContain('„Waise“ gehört zu keinem Cluster');
    expect(b).toContain('kein Strom');

    const c = sample();
    c.clusters[0] = { ...c.clusters[0]!, parentClusterId: c.clusters[1]!.id };
    const cyc = buildHandoverPlan(c, MODELS);
    expect(cyc.blockers[0]).toContain('Kreis');
    expect(cyc.loadManagers).toEqual([]);
    expect(() => renderHandoverScript(cyc)).toThrow(/gesperrt/);
  });

  it(`höchstens ${LOAD_MANAGER_SLOTS} Lasten je Lastmanager`, () => {
    const p = sample();
    const tg = p.clusters[0]!.id;
    for (let i = 0; i < 12; i++) {
      const g = { id: id(), name: `G${i}`, clusterId: tg, priority: 4 as const };
      p.groups.push(g);
      p.chargePoints.push(cp(g.id, `X${i}`));
    }
    const plan = buildHandoverPlan(p, MODELS);
    expect(plan.blockers.some((b) => b.includes('nur 12 Lasten'))).toBe(true);
    expect(plan.loadManagers[1]?.loads).toHaveLength(LOAD_MANAGER_SLOTS);
  });
});

/** Nachgebildetes cfg, das Aufrufe mitschreibt. */
function fakeCfg(
  miniservers = 1,
  servers: string[] = ['192.168.10.21:502'],
  actorInputs = [{ key: 'AI', dataType: 'analog' }],
  {
    msType = 'MiniserverGen2',
    virtualAt = 'vin0',
    pages = [],
    virtuals = [],
    devices = [],
  }: {
    msType?: string;
    virtualAt?: string;
    /** Vorhandene Seiten mit ihren Bausteinen. */
    pages?: Array<{ name: string; uuid: string; blocks: string[] }>;
    /** Vorhandene virtuelle Eingänge / Modbus-Geräte (unter Server 0). */
    virtuals?: Array<{ name: string; uuid: string }>;
    devices?: Array<{ name: string; uuid: string }>;
  } = {},
) {
  const node = (type: string) => (o: { name: string; uuid: string }) => ({
    ...o,
    type,
    childCount: 0,
    children: [],
  });
  const calls: Array<[string, Record<string, unknown>]> = [];
  const dataTypes = new Map<string, number>();
  const ioProps = (uuid: string) => {
    const is32 = (dataTypes.get(uuid) ?? 0) >= 2;
    return [
      { id: 1310, name: '16-Bit Register', editable: is32, value: is32 },
      { id: 1311, name: 'Wortreihenfolge', editable: is32, value: false },
    ];
  };
  let u = 0;
  let pg = 0;
  const next = () => `u${++u}`;
  const rec =
    (name: string, result: (p: Record<string, unknown>) => unknown = () => ({ success: true })) =>
    (p: Record<string, unknown> = {}) => {
      calls.push([name, p]);
      return result(p);
    };
  const cfg = {
    get_tree: rec('get_tree', () => ({
      roots: [
        {
          name: 'Projekt',
          childCount: 1,
          children: Array.from({ length: miniservers }, (_, i) => ({
            name: `MS${i}`,
            uuid: `ms${i}`,
            type: msType,
            isDevice: true,
            childCount: servers.length + 1,
            children: [
              {
                name: 'Virtuelle Eingänge',
                uuid: `vin${i}`,
                type: 'VirtualInCaption',
                childCount: virtuals.length,
                children: virtuals.map(node('VirtualIn')),
              },
              ...servers.map((_, j) => ({
                name: `Server ${j}`,
                uuid: `srv${j}`,
                type: 'ModbusServer',
                childCount: j === 0 ? devices.length : 0,
                children: j === 0 ? devices.map(node('ModbusDev')) : [],
              })),
            ],
          })),
        },
      ],
    })),
    get_insertable_types: rec('get_insertable_types', (p) => ({
      types: p['parent_uuid'] === virtualAt ? [{ type: 'VirtualIn' }] : [{ type: 'Other' }],
    })),
    get_block_properties: rec('get_block_properties', (p) => {
      const uuid = String(p['uuid']);
      if (uuid.startsWith('srv'))
        return { properties: [{ id: 1000, value: servers[Number(uuid.slice(3))] }] };
      return { properties: ioProps(uuid) };
    }),
    get_block: rec('get_block', () => ({
      block: {
        connectors: { inputs: [...actorInputs, { key: 'X', dataType: 'analog', hidden: true }] },
      },
    })),
    add_page: rec('add_page', () => ({ page: { uuid: `page${++pg}` }, success: true })),
    add_block: rec('add_block', (p) => {
      // wie Config: ohne Seite MISSING_PARAM
      if (!p['page_uuid']) throw new Error("Missing 'pageUuid' parameter");
      return { block: { uuid: next() }, success: true };
    }),
    set_block_property: rec('set_block_property', (p) => {
      const uuid = String(p['uuid']);
      const id = Number(p['property_id']);
      // wie Config: 16-Bit Register / Wortreihenfolge nur bei 32-Bit-Datentyp änderbar
      if (ioProps(uuid).find((x) => x.id === id)?.editable === false) {
        throw new Error(`Property is read-only: ${id}`);
      }
      if (id === 1309) dataTypes.set(uuid, Number(p['value']));
      return { success: true };
    }),
    connect_blocks: rec('connect_blocks'),
    insert_object: rec('insert_object', () => ({ object: { uuid: next() }, success: true })),
    add_object_ref: rec('add_object_ref', () => ({ block: { uuid: next() }, success: true })),
    arrange_page: rec('arrange_page', () => ({ arranged: true, overflowPages: [] })),
    get_pages: rec('get_pages', () => ({
      pages: pages.map((p) => ({ name: p.name, uuid: p.uuid, blockCount: p.blocks.length })),
    })),
    get_page: rec('get_page', (p) => {
      const page = pages.find((x) => x.uuid === p['uuid'])!;
      return { page: { ...page, functionBlocks: page.blocks.map((uuid) => ({ uuid })) } };
    }),
    remove_block: rec('remove_block', (p) => {
      const uuid = String(p['uuid']);
      const i = pages.findIndex((x) => x.uuid === uuid);
      if (i >= 0) {
        // wie Config: nur eine leere Seite lässt sich entfernen
        if (pages[i]!.blocks.length > 0) throw new Error('Page is not empty');
        pages.splice(i, 1);
      }
      for (const page of pages) page.blocks = page.blocks.filter((b) => b !== uuid);
      return { success: true };
    }),
    validate_project: rec('validate_project', () => ({ valid: true, issues: [] })),
  };
  return { cfg, calls };
}

const run = (
  plan: HandoverPlan,
  cfg: unknown,
  options: Parameters<typeof handoverScriptInput>[1] = {},
) =>
  new Function('cfg', renderHandoverScript({ ...handoverScriptInput(plan, options) }))(cfg) as {
    outcome: string;
    existingPages: Array<{ name: string; uuid: string }>;
    created: Record<string, string>;
    pages: string[];
    periphery: string[];
    removed: number;
    validation: unknown;
  };

describe('renderHandoverScript', () => {
  it('nur belegte cfg-Methoden', () => {
    const script = renderHandoverScript(buildHandoverPlan(sample(), MODELS));
    const used = new Set([...script.matchAll(/cfg\.(\w+)\(/g)].map((m) => m[1]));
    expect(used).toEqual(
      new Set([
        'get_tree',
        'get_pages',
        'get_page',
        'remove_block',
        'get_insertable_types',
        'get_block_properties',
        'get_block',
        'add_page',
        'add_block',
        'set_block_property',
        'connect_blocks',
        'insert_object',
        'add_object_ref',
        'arrange_page',
        'validate_project',
      ]),
    );
  });

  it('legt an, setzt Werte und verdrahtet laut Plan', () => {
    const plan = buildHandoverPlan(sample(), MODELS);
    const { cfg, calls } = fakeCfg();
    const res = run(plan, cfg);
    expect(res.validation).toEqual({ valid: true, issues: [] });
    expect(calls.find(([m]) => m === 'add_page')?.[1]).toEqual({
      name: plan.pageName,
      context_uuid: 'ms0',
    });
    expect(res.outcome).toBe('created');
    expect(res.pages).toEqual(['page1', 'page2', 'page3', 'page4', 'page5', 'page6']);
    expect(calls.filter(([m]) => m === 'add_page').map(([, p]) => p['name'])).toEqual(
      plan.pages.map((p) => p.name),
    );
    expect(calls.filter(([m]) => m === 'arrange_page')).toHaveLength(6);
    expect(res.periphery).toEqual([
      res.created['vi:site'],
      ...plan.modbusDevices.map((d) => res.created[d.key]),
    ]);
    const blocks = calls.filter(([m]) => m === 'add_block').map(([, p]) => [p['type'], p['title']]);
    expect(blocks).toEqual([
      ['LoadShed', 'LM_Standort'],
      ['LoadShed', 'LM_TG'],
      ['LoadShed', 'LM_Strang'],
      ['WBEM', 'LIM_Strang_Gäste'],
      ['WBEM', 'LIM_TG_Flotte'],
      ['WBEM', 'LIM_TG_Mieter'],
      ['Wallbox', 'WB_LP04'],
      ['Wallbox', 'WB_LP03'],
      ['Wallbox', 'WB_LP01'],
      ['Wallbox', 'WB_LP02'],
    ]);
    const site = res.created['site'];
    const props = calls.filter(([m]) => m === 'set_block_property').map(([, p]) => p);
    expect(props).toContainEqual({ uuid: site, property_id: 3054, value: 0 });
    expect(props).toContainEqual({ uuid: site, property_id: 416, value: 117.3 });
    expect(props).toContainEqual({ uuid: res.created['vi:site'], property_id: 1020, value: false });
    const wires = calls.filter(([m]) => m === 'connect_blocks').map(([, p]) => p);
    const tg = res.created[plan.loadManagers[1]!.key];
    expect(wires).toContainEqual({
      from_block_uuid: site,
      from_connector_key: 'AQl1',
      to_block_uuid: tg,
      to_connector_key: 'maxP',
      reference: true,
    });
    expect(wires).toContainEqual({
      from_block_uuid: tg,
      from_connector_key: 'AQl3',
      to_block_uuid: res.created[plan.wallboxManagers[2]!.key],
      to_connector_key: 'Pmax',
      reference: true,
    });
    expect(wires).toContainEqual(
      expect.objectContaining({
        from_connector_key: 'AQ',
        to_block_uuid: site,
        to_connector_key: 'maxP',
      }),
    );
    expect(calls.find(([m]) => m === 'insert_object')?.[1]).toMatchObject({
      type: 'VirtualIn',
      parent_uuid: 'vin0',
    });
  });

  it('bricht vor jeder Änderung ab, wenn nicht genau ein Miniserver da ist', () => {
    const plan = buildHandoverPlan(sample(), MODELS);
    for (const count of [0, 2]) {
      const { cfg, calls } = fakeCfg(count, undefined, undefined, { msType: 'Unbekannt' });
      expect(() => run(plan, cfg)).toThrow(/Genau ein Miniserver/);
      expect(calls.map(([m]) => m)).toEqual(['get_tree']);
    }
    const { cfg } = fakeCfg(2, undefined, undefined, { msType: 'Unbekannt' });
    expect(() => run(plan, cfg)).toThrow(
      'Unter der Projektwurzel: MS0 (Unbekannt, Gerät); MS1 (Unbekannt, Gerät)',
    );
    const empty = fakeCfg(0);
    expect(() => run(plan, empty.cfg)).toThrow('Unter der Projektwurzel: nichts');
  });

  it('Miniserver ohne „Miniserver“ im Typ: das einzige Gerät unter der Projektwurzel', () => {
    const plan = buildHandoverPlan(sample(), MODELS);
    const { cfg, calls } = fakeCfg(1, undefined, undefined, { msType: 'Unbekannt' });
    run(plan, cfg);
    expect(calls.find(([m]) => m === 'add_page')?.[1]).toMatchObject({ context_uuid: 'ms0' });
  });

  it('Antwort ohne UUID bricht verständlich ab', () => {
    const plan = buildHandoverPlan(sample(), MODELS);
    const { cfg } = fakeCfg();
    cfg.add_page = () => ({ success: true }) as never;
    expect(() => run(plan, cfg)).toThrow('Antwort ohne UUID: {"success":true}');
  });

  it('Miniserver vom Typ LoxLIVE', () => {
    const plan = buildHandoverPlan(sample(), MODELS);
    const { cfg, calls } = fakeCfg(1, undefined, undefined, { msType: 'LoxLIVE' });
    run(plan, cfg);
    expect(calls.find(([m]) => m === 'add_page')?.[1]).toMatchObject({ context_uuid: 'ms0' });
  });

  it('virtuelle Eingänge: Ort wird abgefragt, ohne passenden Ort Abbruch vor jeder Änderung', () => {
    const plan = buildHandoverPlan(sample(), MODELS);
    const atMs = fakeCfg(1, undefined, undefined, { virtualAt: 'ms0' });
    run(plan, atMs.cfg);
    expect(atMs.calls.find(([m]) => m === 'insert_object')?.[1]).toMatchObject({
      parent_uuid: 'ms0',
    });
    const none = fakeCfg(1, undefined, undefined, { virtualAt: 'nirgends' });
    expect(() => run(plan, none.cfg)).toThrow('Kein Ort für virtuelle Eingänge');
    expect(none.calls.some(([m]) => m === 'add_page')).toBe(false);
  });

  it('Modbus: Gerät, Sensoren und Aktor mit Eigenschaften aus der Bibliothek', () => {
    const plan = buildHandoverPlan(sample(), MODELS);
    expect(plan.prerequisites).toEqual([
      'Modbusserver für 192.168.10.21:502 in Config anlegen (LastPlan kann ihn nicht einfügen). Adresse leer lassen, dann trägt LastPlan sie ein, oder selbst eintragen.',
    ]);
    const lp03 = plan.modbusDevices.find((d) => d.name === 'MB_LP03')!;
    expect(lp03).toMatchObject({ serverAddress: '192.168.10.21:502', unitId: 1 });
    const byRole = Object.fromEntries(lp03.registers.map((r) => [r.role, r]));
    // Leistung: FC 4 → Index 3, uint32 → 2, 16-Bit-Register an, word-swapped → Wortreihenfolge, W → kW.
    expect(byRole['power']).toMatchObject({
      kind: 'sensor',
      wallboxConnector: 'power',
      properties: {
        1306: 10,
        1308: 3,
        1309: 2,
        1310: true,
        1311: true,
        1312: false,
        1319: 0.001,
        1040: 'kW',
        1307: 1,
      },
    });
    // Zählerstand: eigene Byte-Reihenfolge big-endian.
    expect(byRole['energy']?.properties).toMatchObject({
      1307: 2,
      1309: 4,
      1311: false,
      1312: false,
      1319: 1,
    });
    // Aktor: FC 16 → Index 3; 32 A einphasig = 7,36 kW ↔ 320 (Skala 0,1 A).
    expect(byRole['setpointCurrent']).toMatchObject({
      kind: 'actor',
      wallboxConnector: 'outLimit',
      properties: { 1306: 200, 1308: 3, 1309: 0, 1310: false, 1030: 0, 1031: 0, 1319: 320 },
    });
    expect(byRole['setpointCurrent']?.properties[1318]).toBeCloseTo(7.36, 6);

    const { cfg, calls } = fakeCfg();
    const res = run(plan, cfg);
    const inserts = calls.filter(([m]) => m === 'insert_object').map(([, p]) => p);
    expect(inserts.filter((p) => p['type'] === 'ModbusDev')).toHaveLength(4);
    expect(inserts.find((p) => p['name'] === 'MB_LP03')).toMatchObject({ parent_uuid: 'srv0' });
    const wires = calls.filter(([m]) => m === 'connect_blocks').map(([, p]) => p);
    const wb = res.created[plan.wallboxes.find((w) => w.title === 'WB_LP03')!.key];
    expect(wires).toContainEqual(
      expect.objectContaining({
        from_block_uuid: wb,
        from_connector_key: 'outLimit',
        to_connector_key: 'AI',
      }),
    );
    expect(wires).toContainEqual(
      expect.objectContaining({
        from_connector_key: 'AQ',
        to_block_uuid: wb,
        to_connector_key: 'power',
      }),
    );
  });

  it('Modbus: bricht ab, wenn Modbusserver fehlt, doppelt ist oder der Aktor-Eingang unklar', () => {
    const plan = buildHandoverPlan(sample(), MODELS);
    const missing = fakeCfg(1, ['10.0.0.1:502']);
    expect(() => run(plan, missing.cfg)).toThrow(
      'Modbusserver fehlt in Config: 192.168.10.21:502. Es fehlen 1 Modbusserver (mit dieser Adresse oder mit leerer Adresse). Gefunden (Name „Adresse“): Server 0 „10.0.0.1:502“',
    );
    const none = fakeCfg(1, []);
    expect(() => run(plan, none.cfg)).toThrow('Gefunden (Name „Adresse“): keiner');
    expect(missing.calls.some(([m]) => m === 'add_page')).toBe(false);
    const twice = fakeCfg(1, ['192.168.10.21:502', '192.168.10.21:502']);
    expect(() => run(plan, twice.cfg)).toThrow(/mehrfach/);
    const unclear = fakeCfg(1, undefined, []);
    expect(() => run(plan, unclear.cfg)).toThrow(/nicht eindeutig/);
  });

  it('Modbus: Datentyp zuerst, schreibgeschützte Kästchen werden übersprungen, wenn sie passen', () => {
    const plan = buildHandoverPlan(sample(), MODELS);
    const { cfg, calls } = fakeCfg();
    run(plan, cfg);
    const sets = calls.filter(([m]) => m === 'set_block_property').map(([, p]) => p);
    // je IO-Objekt kommt der Datentyp vor allen anderen Eigenschaften
    const byUuid = new Map<unknown, number[]>();
    for (const p of sets)
      byUuid.set(p['uuid'], [...(byUuid.get(p['uuid']) ?? []), Number(p['property_id'])]);
    const ios = [...byUuid.values()].filter((ids) => ids.includes(1309));
    expect(ios.length).toBeGreaterThan(0);
    expect(ios.every((ids) => ids[0] === 1309)).toBe(true);
    // 16-Bit-Aktor: 1310/1311 nicht geschrieben
    expect(ios.some((ids) => !ids.includes(1310) && !ids.includes(1311))).toBe(true);
  });

  it('Modbus: schreibgeschützte Eigenschaft mit falschem Wert bricht mit Namen ab', () => {
    const plan = buildHandoverPlan(sample(), MODELS);
    const { cfg } = fakeCfg();
    const original = cfg.get_block_properties;
    cfg.get_block_properties = (p: Record<string, unknown> = {}) =>
      String(p['uuid']).startsWith('srv')
        ? original(p)
        : { properties: [{ id: 1312, name: 'Byte-Reihenfolge', editable: false, value: true }] };
    expect(() => run(plan, cfg)).toThrow(
      'Eigenschaft 1312 (Byte-Reihenfolge) ist in Config schreibgeschützt und steht auf true, gebraucht wird false.',
    );
  });

  it('Modbus: leerer Modbusserver bekommt die fehlende Adresse', () => {
    const plan = buildHandoverPlan(sample(), MODELS);
    const { cfg, calls } = fakeCfg(1, ['10.0.0.1:502', '']);
    const res = run(plan, cfg);
    const sets = calls.filter(([m, p]) => m === 'set_block_property' && p['property_id'] === 1000);
    expect(sets).toEqual([
      ['set_block_property', { uuid: 'srv1', property_id: 1000, value: '192.168.10.21:502' }],
    ]);
    expect(res.created['server:192.168.10.21:502']).toBe('srv1');
    // Adresse wird erst nach der Vorprüfung gesetzt, vor dem Anlegen der Seite
    const order = calls.map(([m]) => m);
    expect(order.indexOf('set_block_property')).toBeLessThan(order.indexOf('add_page'));
    const devices = calls.filter(([m, p]) => m === 'insert_object' && p['type'] === 'ModbusDev');
    expect(devices.every(([, p]) => p['parent_uuid'] === 'srv1')).toBe(true);
  });

  it('Modbus: TODO und unpassende Angaben in der Bibliothek sperren', () => {
    const r = TEST_MODEL.modbus.registers;
    const problems = (models: ReadonlyMap<string, WallboxModel>) =>
      buildHandoverPlan(sample(), models).blockers.join('\n');
    expect(problems(new Map())).toContain('Modell test/wallbox@1 fehlt in der Bibliothek');
    expect(problems(withModel({ ...r, power: { ...r.power!, scale: 'TODO' } }))).toContain(
      'Register power: noch TODO (scale)',
    );
    expect(
      problems(withModel({ setpointCurrent: r.setpointCurrent!, energy: r.energy! })),
    ).toContain('Register power: fehlt');
    expect(problems(withModel(r, 'TODO'))).toContain(
      'Register power: Byte-Reihenfolge ist noch TODO',
    );
    expect(problems(withModel({ ...r, power: { ...r.power!, fn: 1 } }))).toContain(
      'Funktionscode 1 wird hier nicht unterstützt',
    );
    expect(problems(withModel({ ...r, power: { ...r.power!, unit: 'VA' } }))).toContain(
      'Einheit „VA“',
    );
    expect(
      problems(withModel({ ...r, setpointCurrent: { ...r.setpointCurrent!, unit: 'mA' } })),
    ).toContain('erwartet wird A');
    expect(
      problems(withModel({ ...r, setpointCurrent: { ...r.setpointCurrent!, access: 'r' } })),
    ).toContain('nicht beschreibbar');
    expect(
      problems(
        withModel({ ...r, setpointCurrent: { ...r.setpointCurrent!, fn: 6, type: 'uint32' } }),
      ),
    ).toContain('schreibt nur 16 Bit');

    const u = sample();
    u.chargePoints[0] = { ...u.chargePoints[0]!, network: { ip: '192.168.10.21', port: 502 } };
    expect(
      buildHandoverPlan(u, MODELS).modbusDevices.find((d) => d.name === 'MB_LP01')?.unitId,
    ).toBe(1);
    const noUnit = new Map([
      [
        TEST_MODEL.id,
        { ...TEST_MODEL, modbus: { ...TEST_MODEL.modbus, defaultUnitId: 'TODO' as const } },
      ],
    ]);
    expect(buildHandoverPlan(u, noUnit).blockers.join('\n')).toContain('LP01: Unit-ID fehlt');

    const p = sample();
    p.chargePoints[0] = { ...p.chargePoints[0]!, protocol: 'http' };
    const plan = buildHandoverPlan(p, MODELS);
    expect(plan.blockers).toEqual([]);
    expect(plan.pending.join('\n')).toContain('LP01: Protokoll http');
    expect(plan.modbusDevices).toHaveLength(3);
  });

  it('Namen mit Anführungszeichen landen als Daten im Skript, nicht als Code', () => {
    const p = sample();
    p.name = 'x"; cfg.remove_block({uuid:"a"}); //';
    const script = renderHandoverScript(buildHandoverPlan(p, MODELS));
    expect(script).not.toContain('cfg.remove_block({uuid:"a"})');
    const { cfg, calls } = fakeCfg();
    run(buildHandoverPlan(p, MODELS), cfg);
    expect(calls.find(([m]) => m === 'add_page')?.[1]['name']).toBe(
      `Standort – ${p.name} ${pageTag(p).tag}`,
    );
  });
});

describe('Seitenkennung (6.6)', () => {
  it('Kennung: Zufallsteil der Projekt-ID und Struktur-Hash; Hash ändert sich mit der Struktur', () => {
    const p = sample();
    const t = pageTag(p);
    expect(t.match).toBe(`[lastplan:${p.id.replace(/-/g, '').slice(-12)}:`);
    expect(hashFromPageName(`LastPlan – X ${t.tag}`, t.match)).toBe(t.hash);
    expect(hashFromPageName('LastPlan – X', t.match)).toBeUndefined();
    const q = sample();
    q.site.buildingReserveA = 90;
    expect(pageTag({ ...q, id: p.id }).hash).not.toBe(t.hash);
    expect(pageTag({ ...p, name: 'Anders' }).hash).toBe(t.hash);
  });

  it('vorhandene Seite: ohne „ersetzen“ wird nichts geändert, nur gemeldet', () => {
    const plan = buildHandoverPlan(sample(), MODELS);
    const old = { name: `LastPlan – Alt ${plan.pageMatch}00000000]`, uuid: 'old', blocks: ['b1'] };
    const other = { name: 'Licht', uuid: 'licht', blocks: ['b9'] };
    const { cfg, calls } = fakeCfg(1, undefined, undefined, { pages: [old, other] });
    const res = run(plan, cfg);
    expect(res).toMatchObject({
      outcome: 'exists',
      existingPages: [{ name: old.name, uuid: 'old' }],
      created: {},
      validation: null,
    });
    const changing = [
      'add_page',
      'add_block',
      'set_block_property',
      'insert_object',
      'remove_block',
    ];
    expect(calls.filter(([m]) => changing.includes(m))).toEqual([]);
  });

  it('ersetzen: entfernt Peripherie und Seiten des letzten Laufs, fremde Seiten bleiben', () => {
    const plan = buildHandoverPlan(sample(), MODELS);
    const pages = [
      { name: `LastPlan – Alt ${plan.pageMatch}00000000]`, uuid: 'old', blocks: ['b1', 'b2'] },
      { name: 'Folgeseite', uuid: 'old2', blocks: ['b3'] },
      { name: 'Licht', uuid: 'licht', blocks: ['b9'] },
    ];
    const virtuals = [{ name: plan.virtualInputs[0]!.name, uuid: 'vi-old' }];
    const devices = plan.modbusDevices.map((d, i) => ({ name: d.name, uuid: `dev-old${i}` }));
    const { cfg, calls } = fakeCfg(1, undefined, undefined, { pages, virtuals, devices });
    const res = run(plan, cfg, {
      replace: true,
      previous: {
        pages: ['old2', 'weg'],
        periphery: ['vi-old', ...devices.map((d) => d.uuid), 'längst-gelöscht'],
      },
    });
    expect(res.outcome).toBe('replaced');
    expect(res.existingPages.map((p) => p.uuid)).toEqual(['old', 'old2']);
    const removed = calls.filter(([m]) => m === 'remove_block').map(([, p]) => p['uuid']);
    expect(removed).toEqual([
      'vi-old',
      ...devices.map((d) => d.uuid),
      'b1',
      'b2',
      'old',
      'b3',
      'old2',
    ]);
    expect(res.removed).toBe(1 + devices.length + 3);
    expect(pages.map((p) => p.uuid)).toEqual(['licht']);
    // erst entfernen, dann anlegen
    const order = calls.map(([m]) => m);
    expect(order.lastIndexOf('remove_block')).toBeLessThan(order.indexOf('add_page'));
  });

  it('Objekte mit geplanten Namen, die nicht vom letzten Lauf stammen: Abbruch vor jeder Änderung', () => {
    const plan = buildHandoverPlan(sample(), MODELS);
    const virtuals = [{ name: plan.virtualInputs[0]!.name, uuid: 'vi-fremd' }];
    const devices = [{ name: 'MB_LP03', uuid: 'dev-fremd' }];
    const { cfg, calls } = fakeCfg(1, undefined, undefined, { virtuals, devices });
    expect(() => run(plan, cfg, { replace: true })).toThrow(
      `In Config gibt es schon Objekte mit diesen Namen: ${plan.virtualInputs[0]!.name}, MB_LP03.`,
    );
    const changing = [
      'add_page',
      'add_block',
      'set_block_property',
      'insert_object',
      'remove_block',
    ];
    expect(calls.filter(([m]) => changing.includes(m))).toEqual([]);
  });
});

describe('Mehrere Seiten', () => {
  it('Bausteine auf ihrer Seite; Verbindungen über Seitengrenzen als Referenz', () => {
    const plan = buildHandoverPlan(sample(), MODELS);
    const { cfg, calls } = fakeCfg();
    const res = run(plan, cfg);
    const pageUuid = (key: string) => res.created['page:' + key];
    const blocks = calls.filter(([m]) => m === 'add_block').map(([, p]) => p);
    expect(blocks.find((b) => b['title'] === 'LM_Standort')?.['page_uuid']).toBe(pageUuid('site'));
    const mieter = plan.wallboxManagers.find((w) => w.title === 'LIM_TG_Mieter')!;
    expect(blocks.find((b) => b['title'] === 'WB_LP01')?.['page_uuid']).toBe(pageUuid(mieter.key));
    const refs = calls.filter(([m]) => m === 'add_object_ref').map(([, p]) => p['page_uuid']);
    // VI auf dem Standort, Modbus-Referenzen auf der Gruppen-Seite ihrer Wallbox
    expect(refs[0]).toBe(pageUuid('site'));
    expect(refs).toContain(pageUuid(mieter.key));

    const wires = calls.filter(([m]) => m === 'connect_blocks').map(([, p]) => p);
    const site = res.created['site'];
    const tg = res.created[plan.loadManagers[1]!.key];
    // LM_Standort (Standort-Seite) → LM_TG (Seite TG): Referenz
    expect(wires).toContainEqual(
      expect.objectContaining({ from_block_uuid: site, to_block_uuid: tg, reference: true }),
    );
    // VI-Instanz → LM_Standort, beide auf der Standort-Seite: direkte Leitung
    const vi = wires.find((w) => w['to_block_uuid'] === site)!;
    expect(vi).not.toHaveProperty('reference');
    // Wallbox → Aktor auf derselben Gruppen-Seite: direkte Leitung
    const wb = res.created[plan.wallboxes.find((w) => w.title === 'WB_LP01')!.key];
    const toActor = wires.find((w) => w['from_block_uuid'] === wb)!;
    expect(toActor).not.toHaveProperty('reference');
  });
});
