import { describe, expect, it } from 'vitest';
import { createProject, type ChargePoint, type Project } from '@lastplan/core';
import {
  buildHandoverPlan,
  LOAD_MANAGER_SLOTS,
  renderHandoverScript,
  renderName,
  type HandoverPlan,
} from './config-handover';

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
    const plan = buildHandoverPlan(sample());
    expect(plan.blockers).toEqual([]);
    expect(plan.pageName).toBe('LastPlan – Tiefgarage');
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
    const plan = buildHandoverPlan(sample());
    const wb = Object.fromEntries(plan.wallboxes.map((w) => [w.title, w]));
    expect(wb['WB_LP01']).toMatchObject({ maxKw: 11.04, minKw: 4.14, phases: 3 });
    expect(wb['WB_LP03']).toMatchObject({ maxKw: 7.36, minKw: 1.38, phases: 1 });
    const p = sample();
    p.settings.voltageV = 231;
    const w = buildHandoverPlan(p).wallboxes[0]!;
    expect(w.maxKw).toBe(11.08); // 11,088 → ab
    expect(w.minKw).toBe(4.16); // 4,158 → auf
    // Mindestleistung einer Last: kleinste Wallbox-Mindestleistung darunter.
    const tg = buildHandoverPlan(sample()).loadManagers[1]!;
    expect(tg.loads.find((l) => l.title === 'LIM_TG_Mieter')?.minKw).toBe(4.14);
    expect(tg.loads.find((l) => l.title === 'LM_Strang')?.minKw).toBe(4.14);
  });

  it('abweichende Phasen-Limits: das kleinste zählt', () => {
    const p = sample();
    p.clusters[0] = { ...p.clusters[0]!, phaseLimitA: [125, 100, 125] };
    expect(buildHandoverPlan(p).loadManagers[1]?.maxA).toBe(100);
  });

  it('Standort-Limit kommt über einen analogen virtuellen Eingang', () => {
    const plan = buildHandoverPlan(sample());
    expect(plan.virtualInputs).toEqual([
      {
        key: 'vi:site',
        name: 'LM_Standort Limit (kW) – 170 A',
        valueKw: 117.3,
        valueA: 170,
        target: { key: 'site', connector: 'maxP' },
      },
    ]);
  });

  it('Abhak-Liste: Lasttabelle in Abwurf-Reihenfolge, Wallboxen je Wallbox Manager', () => {
    const plan = buildHandoverPlan(sample());
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
    expect(plan.pending.length).toBeGreaterThan(0);
  });

  it('Namen folgen dem Benennungsschema', () => {
    const p = sample();
    p.settings.namingScheme = {
      ...p.settings.namingScheme,
      clusterManager: 'Last {cluster}',
      wallbox: 'Wallbox {label}',
    };
    const plan = buildHandoverPlan(p);
    expect(plan.loadManagers[1]?.title).toBe('Last TG');
    expect(plan.wallboxes[0]?.title).toBe('Wallbox LP04');
    expect(renderName(p, 'groupLimit', { cluster: 'A' })).toBe('LIM_A_');
  });

  it('sperrt bei fehlenden Angaben, doppelten Namen, leeren Gruppen und Kreisen', () => {
    const p = sample();
    p.chargePoints[0] = { ...p.chargePoints[0]!, missingFields: ['minA'] };
    p.chargePoints[1] = { ...p.chargePoints[1]!, label: 'LP01' };
    p.groups.push({ id: id(), name: 'Leer', clusterId: p.clusters[0]!.id, priority: 5 });
    p.groups.push({ id: id(), name: 'Waise', clusterId: id(), priority: 5 });
    p.site.buildingReserveA = 250;
    const b = buildHandoverPlan(p).blockers.join('\n');
    expect(b).toContain('LP01: Angaben fehlen');
    expect(b).toContain('„WB_LP01“ kommt doppelt vor');
    expect(b).toContain('„Leer“ hat keine Ladepunkte');
    expect(b).toContain('„Waise“ gehört zu keinem Cluster');
    expect(b).toContain('kein Strom');

    const c = sample();
    c.clusters[0] = { ...c.clusters[0]!, parentClusterId: c.clusters[1]!.id };
    const cyc = buildHandoverPlan(c);
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
    const plan = buildHandoverPlan(p);
    expect(plan.blockers.some((b) => b.includes('nur 12 Lasten'))).toBe(true);
    expect(plan.loadManagers[1]?.loads).toHaveLength(LOAD_MANAGER_SLOTS);
  });
});

/** Nachgebildetes cfg, das Aufrufe mitschreibt. */
function fakeCfg(miniservers = 1) {
  const calls: Array<[string, Record<string, unknown>]> = [];
  let u = 0;
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
            type: 'MiniserverGen2',
            isDevice: true,
            childCount: 0,
            children: [],
          })),
        },
      ],
    })),
    add_page: rec('add_page', () => ({ page: { uuid: 'page' }, success: true })),
    add_block: rec('add_block', () => ({ block: { uuid: next() }, success: true })),
    set_block_property: rec('set_block_property'),
    connect_blocks: rec('connect_blocks'),
    insert_object: rec('insert_object', () => ({ object: { uuid: next() }, success: true })),
    add_object_ref: rec('add_object_ref', () => ({ block: { uuid: next() }, success: true })),
    arrange_page: rec('arrange_page'),
    validate_project: rec('validate_project', () => ({ valid: true, issues: [] })),
  };
  return { cfg, calls };
}

const run = (plan: HandoverPlan, cfg: unknown) =>
  new Function('cfg', renderHandoverScript(plan))(cfg) as {
    created: Record<string, string>;
    validation: unknown;
  };

describe('renderHandoverScript', () => {
  it('nur belegte cfg-Methoden', () => {
    const script = renderHandoverScript(buildHandoverPlan(sample()));
    const used = new Set([...script.matchAll(/cfg\.(\w+)\(/g)].map((m) => m[1]));
    expect(used).toEqual(
      new Set([
        'get_tree',
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
    const plan = buildHandoverPlan(sample());
    const { cfg, calls } = fakeCfg();
    const res = run(plan, cfg);
    expect(res.validation).toEqual({ valid: true, issues: [] });
    expect(calls.find(([m]) => m === 'add_page')?.[1]).toEqual({
      name: 'LastPlan – Tiefgarage',
      context_uuid: 'ms0',
    });
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
    });
    expect(wires).toContainEqual({
      from_block_uuid: tg,
      from_connector_key: 'AQl3',
      to_block_uuid: res.created[plan.wallboxManagers[2]!.key],
      to_connector_key: 'Pmax',
    });
    expect(wires.at(-1)).toMatchObject({ from_connector_key: 'AQ', to_block_uuid: site });
    expect(calls.find(([m]) => m === 'insert_object')?.[1]).toMatchObject({
      type: 'VirtualIn',
      parent_uuid: 'ms0',
    });
  });

  it('bricht vor jeder Änderung ab, wenn nicht genau ein Miniserver da ist', () => {
    const plan = buildHandoverPlan(sample());
    for (const count of [0, 2]) {
      const { cfg, calls } = fakeCfg(count);
      expect(() => run(plan, cfg)).toThrow(/Genau ein Miniserver/);
      expect(calls.map(([m]) => m)).toEqual(['get_tree']);
    }
  });

  it('Namen mit Anführungszeichen landen als Daten im Skript, nicht als Code', () => {
    const p = sample();
    p.name = 'x"; cfg.remove_block({uuid:"a"}); //';
    const script = renderHandoverScript(buildHandoverPlan(p));
    expect(script).not.toContain('cfg.remove_block({uuid:"a"})');
    const { cfg, calls } = fakeCfg();
    run(buildHandoverPlan(p), cfg);
    expect(calls.find(([m]) => m === 'add_page')?.[1]['name']).toBe(`LastPlan – ${p.name}`);
  });
});
