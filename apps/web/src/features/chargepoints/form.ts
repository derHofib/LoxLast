import {
  AmpereSchema,
  IpV4Schema,
  PHASE_ROTATIONS,
  PortSchema,
  PositiveAmpereSchema,
  UnitIdSchema,
  type ChargePoint,
  type ChargePointPatch,
  type Project,
} from '@lastplan/core';

/** Felder des Ladepunkt-Formulars (Kap. 11.2). */
export type FieldKey =
  | 'label'
  | 'vendor'
  | 'libraryModelId'
  | 'ip'
  | 'groupId'
  | 'minA'
  | 'maxA'
  | 'phaseRotation'
  | 'port'
  | 'unitId'
  | 'fuseA'
  | 'protocol'
  | 'phases'
  | 'phaseSwitching'
  | 'room'
  | 'category'
  | 'notes';

export const FIELD_LABEL: Record<FieldKey, string> = {
  label: 'Bezeichnung',
  vendor: 'Hersteller',
  libraryModelId: 'Modell',
  ip: 'IP-Adresse',
  groupId: 'Gruppe',
  minA: 'Mindeststrom',
  maxA: 'Maximalstrom',
  phaseRotation: 'Phasenlage',
  port: 'Port',
  unitId: 'Unit-ID',
  fuseA: 'Absicherung',
  protocol: 'Protokoll',
  phases: 'Phasen',
  phaseSwitching: 'Phasenumschaltung',
  room: 'Raum',
  category: 'Kategorie',
  notes: 'Notizen',
};

export const COMMON_FIELDS: FieldKey[] = [
  'label',
  'vendor',
  'libraryModelId',
  'ip',
  'groupId',
  'minA',
  'maxA',
  'phaseRotation',
];
export const ADVANCED_FIELDS: FieldKey[] = [
  'port',
  'unitId',
  'fuseA',
  'protocol',
  'phases',
  'phaseSwitching',
  'room',
  'category',
  'notes',
];

/** Je Ladepunkt eindeutig: bei Mehrfachauswahl gesperrt (Kap. 11.2). */
export const UNIQUE_FIELDS: readonly FieldKey[] = ['label', 'ip'];

/** Felder, die direkt im Ladepunkt stehen (Hersteller ist aus dem Modell abgeleitet). */
type StoredField = Exclude<FieldKey, 'vendor'>;

export function readField(cp: ChargePoint, key: StoredField): string {
  switch (key) {
    case 'ip':
      return cp.network.ip;
    case 'port':
      return String(cp.network.port);
    case 'unitId':
      return cp.network.unitId === undefined ? '' : String(cp.network.unitId);
    case 'phaseSwitching':
      return cp.phaseSwitching ? 'ja' : 'nein';
    case 'minA':
    case 'maxA':
    case 'fuseA':
    case 'phases':
      return String(cp[key]);
    case 'room':
    case 'category':
    case 'notes':
      return cp[key] ?? '';
    default:
      return cp[key];
  }
}

export interface CommonValue {
  /** Wert, wenn alle ausgewählten Ladepunkte ihn teilen, sonst ''. */
  value: string;
  /** Die Werte weichen voneinander ab („verschieden“). */
  mixed: boolean;
}

/** Gemeinsame Werte der ausgewählten Ladepunkte (Kap. 11.2, Mehrfachauswahl). */
export function commonValue(cps: readonly ChargePoint[], key: StoredField): CommonValue {
  const first = cps[0];
  if (!first) return { value: '', mixed: false };
  const v = readField(first, key);
  const mixed = cps.some((cp) => readField(cp, key) !== v);
  return { value: mixed ? '' : v, mixed };
}

export type ParseResult = { ok: true; patch: ChargePointPatch } | { ok: false; error: string };

const fail = (error: string): ParseResult => ({ ok: false, error });

function firstIssue(
  schema: {
    safeParse: (v: unknown) => { success: boolean; error?: { issues: { message: string }[] } };
  },
  v: unknown,
): string | undefined {
  const r = schema.safeParse(v);
  return r.success ? undefined : (r.error?.issues[0]?.message ?? 'Ungültiger Wert');
}

/** „6,5“ und „6.5“ → 6.5; sonst NaN. */
function toNumber(raw: string): number {
  const t = raw.trim().replace(',', '.');
  return t === '' ? Number.NaN : Number(t);
}

/**
 * Prüft und übersetzt einen Eingabewert in einen Patch. `takenLabels` sind die Bezeichnungen
 * der übrigen Ladepunkte (Eindeutigkeit).
 */
export function parseField(
  key: StoredField,
  raw: string,
  takenLabels: readonly string[] = [],
): ParseResult {
  switch (key) {
    case 'label': {
      const t = raw.trim();
      if (!t) return fail('Bezeichnung darf nicht leer sein');
      if (t.length > 200) return fail('Bezeichnung ist zu lang (max. 200 Zeichen)');
      if (
        takenLabels.some(
          (l) => l.trim().toLocaleLowerCase('de-DE') === t.toLocaleLowerCase('de-DE'),
        )
      )
        return fail(`Bezeichnung „${t}“ ist schon vergeben`);
      return { ok: true, patch: { label: t } };
    }
    case 'ip': {
      const t = raw.trim();
      const issue = firstIssue(IpV4Schema, t);
      return issue ? fail(issue) : { ok: true, patch: { network: { ip: t } } };
    }
    case 'port': {
      const n = toNumber(raw);
      const issue = firstIssue(PortSchema, n);
      return issue ? fail(issue) : { ok: true, patch: { network: { port: n } } };
    }
    case 'unitId': {
      if (raw.trim() === '') return { ok: true, patch: { network: { unitId: undefined } } };
      const n = toNumber(raw);
      const issue = firstIssue(UnitIdSchema, n);
      return issue ? fail(issue) : { ok: true, patch: { network: { unitId: n } } };
    }
    case 'minA':
    case 'maxA': {
      const n = toNumber(raw);
      const issue = firstIssue(AmpereSchema, n);
      return issue ? fail(issue) : { ok: true, patch: { [key]: n } };
    }
    case 'fuseA': {
      const n = toNumber(raw);
      const issue = firstIssue(PositiveAmpereSchema, n);
      return issue ? fail(issue) : { ok: true, patch: { fuseA: n } };
    }
    case 'phaseRotation':
      return (PHASE_ROTATIONS as readonly string[]).includes(raw)
        ? { ok: true, patch: { phaseRotation: raw as ChargePoint['phaseRotation'] } }
        : fail('Phasenlage muss L1-L2-L3, L2-L3-L1 oder L3-L1-L2 sein');
    case 'phases':
      return raw === '1' || raw === '3'
        ? { ok: true, patch: { phases: Number(raw) as 1 | 3 } }
        : fail('Anschluss muss 1- oder 3-phasig sein');
    case 'protocol':
      return raw === 'modbus-tcp' || raw === 'http' || raw === 'ocpp-bridge'
        ? { ok: true, patch: { protocol: raw } }
        : fail('Unbekanntes Protokoll');
    case 'phaseSwitching':
      return raw === 'ja' || raw === 'nein'
        ? { ok: true, patch: { phaseSwitching: raw === 'ja' } }
        : fail('Bitte Ja oder Nein wählen');
    case 'groupId':
      return raw ? { ok: true, patch: { groupId: raw } } : fail('Bitte eine Gruppe wählen');
    case 'libraryModelId':
      return raw ? { ok: true, patch: { libraryModelId: raw } } : fail('Bitte ein Modell wählen');
    case 'room':
    case 'category': {
      if (raw.trim().length > 200)
        return fail(`${FIELD_LABEL[key]} ist zu lang (max. 200 Zeichen)`);
      return { ok: true, patch: { [key]: raw.trim() === '' ? undefined : raw.trim() } };
    }
    case 'notes': {
      if (raw.length > 5000) return fail('Notizen sind zu lang (max. 5000 Zeichen)');
      return { ok: true, patch: { notes: raw === '' ? undefined : raw } };
    }
  }
}

/** „Cluster › Gruppe“ für Pfadanzeige und Gruppenauswahl. */
export function groupPath(project: Project, groupId: string): string {
  const group = project.groups.find((g) => g.id === groupId);
  if (!group) return 'ohne Gruppe';
  const names: string[] = [group.name];
  let cluster = project.clusters.find((c) => c.id === group.clusterId);
  const seen = new Set<string>();
  while (cluster && !seen.has(cluster.id)) {
    seen.add(cluster.id);
    names.unshift(cluster.name);
    const parent = cluster.parentClusterId;
    cluster = parent ? project.clusters.find((c) => c.id === parent) : undefined;
  }
  return names.join(' › ');
}

/** Weiche Hinweise zu den aktuellen Werten (blockieren das Speichern nicht). */
export function softWarnings(
  project: Project,
  cps: readonly ChargePoint[],
): Partial<Record<FieldKey, string>> {
  const warnings: Partial<Record<FieldKey, string>> = {};
  const [cp] = cps;
  if (!cp) return warnings;
  const minA = commonValue(cps, 'minA');
  const maxA = commonValue(cps, 'maxA');
  const fuseA = commonValue(cps, 'fuseA');
  if (!minA.mixed && Number(minA.value) < 6)
    warnings.minA = 'Unter 6 A lädt kein Fahrzeug (IEC 61851)';
  if (cps.some((c) => c.minA > c.maxA))
    warnings.minA = 'Mindeststrom ist größer als der Maximalstrom';
  if (!maxA.mixed && !fuseA.mixed && Number(maxA.value) > Number(fuseA.value))
    warnings.maxA = 'Maximalstrom ist größer als die Absicherung';
  if (cps.length === 1) {
    const clash = project.chargePoints.find(
      (o) => o.id !== cp.id && o.network.ip === cp.network.ip,
    );
    if (clash) warnings.ip = `Diese IP-Adresse hat auch ${clash.label}`;
  }
  return warnings;
}
