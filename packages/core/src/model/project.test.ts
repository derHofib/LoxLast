import { describe, expect, it } from 'vitest';
import { FIXED_NOW, makeChargePoint, makeSampleProject } from '../__tests__/fixtures';
import { createProject, DEFAULT_SETTINGS } from './factory';
import { StrictProjectSchema } from './invariants';
import {
  CURRENT_SCHEMA_VERSION,
  ChargePointSchema,
  ClusterSchema,
  GroupSchema,
  ProjectSchema,
} from './project';

describe('createProject', () => {
  it('erzeugt ein gültiges leeres Projekt mit Standardwerten', () => {
    const project = createProject({
      name: '  Wohnanlage Nord ',
      now: FIXED_NOW,
      idFactory: () => '0196a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
    });
    expect(project).toMatchObject({
      id: '0196a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
      schemaVersion: CURRENT_SCHEMA_VERSION,
      name: 'Wohnanlage Nord',
      settings: DEFAULT_SETTINGS,
      createdAt: '2026-11-15T12:00:00.000Z',
      updatedAt: '2026-11-15T12:00:00.000Z',
    });
    expect(StrictProjectSchema.safeParse(project).success).toBe(true);
  });

  it('verwendet standardmäßig echte Uhrzeit und UUID v7', () => {
    const project = createProject({ name: 'X' });
    expect(ProjectSchema.safeParse(project).success).toBe(true);
  });

  it('Einstellungen sind keine geteilte Referenz auf die Standardwerte', () => {
    const project = createProject({ name: 'X' });
    project.settings.namingScheme.wallbox = 'EV_{label}';
    expect(DEFAULT_SETTINGS.namingScheme.wallbox).toBe('WB_{cluster}_G{groupNo}_{label}');
  });
});

describe('ProjectSchema', () => {
  it('akzeptiert die Beispielanlage', () => {
    const project = makeSampleProject();
    expect(ProjectSchema.parse(project)).toEqual(project);
  });

  it('entfernt unbekannte Felder wie ein gespeichertes site.limitA', () => {
    const project = makeSampleProject();
    const parsed = ProjectSchema.parse({ ...project, site: { ...project.site, limitA: 170 } });
    expect(parsed.site).not.toHaveProperty('limitA');
  });

  it('lehnt eine andere Formatversion ab', () => {
    const r = ProjectSchema.safeParse({ ...makeSampleProject(), schemaVersion: 99 });
    expect(r.error?.issues[0]?.message).toBe(
      `Projektformat-Version wird nicht unterstützt (erwartet: ${CURRENT_SCHEMA_VERSION})`,
    );
  });

  it('akzeptiert optionale Zähler und PV', () => {
    const project = makeSampleProject();
    const meter = {
      vendor: 'Muster',
      model: 'Z1',
      protocol: 'modbus-tcp' as const,
      network: { ip: '192.168.10.5', port: 502 },
    };
    expect(
      ProjectSchema.safeParse({
        ...project,
        site: { ...project.site, gridMeter: meter, pv: { meter, peakKw: 29.9 } },
      }).success,
    ).toBe(true);
  });

  it('akzeptiert tenantId (vorbereitet, ungenutzt)', () =>
    expect(ProjectSchema.safeParse({ ...makeSampleProject(), tenantId: 'mandant-1' }).success).toBe(
      true,
    ));
});

describe('Teilschemas', () => {
  const cp = makeChargePoint('0196a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b');

  it('Priorität nur 1–5', () => {
    const group = { id: cp.id, name: 'Gäste', clusterId: cp.groupId, priority: 6 };
    expect(GroupSchema.safeParse(group).error?.issues[0]?.message).toBe(
      'Priorität muss zwischen 1 (höchste) und 5 liegen',
    );
    expect(GroupSchema.safeParse({ ...group, priority: 5 }).success).toBe(true);
  });

  it('Anschluss nur 1- oder 3-phasig', () =>
    expect(ChargePointSchema.safeParse({ ...cp, phases: 2 }).error?.issues[0]?.message).toBe(
      'Anschluss muss 1- oder 3-phasig sein',
    ));

  it('Modell-ID-Format', () => {
    expect(ChargePointSchema.safeParse({ ...cp, libraryModelId: 'ABL eM4' }).success).toBe(false);
    expect(ChargePointSchema.safeParse({ ...cp, libraryModelId: 'abl/em4-single@2' }).success).toBe(
      true,
    );
  });

  it('Phasen-Limits als Dreiertupel', () => {
    const cluster = { id: cp.id, name: 'UV', limitA: 63 };
    expect(ClusterSchema.safeParse({ ...cluster, phaseLimitA: [63, 63, 50] }).success).toBe(true);
    expect(ClusterSchema.safeParse({ ...cluster, phaseLimitA: [63, 63] }).success).toBe(false);
  });
});
