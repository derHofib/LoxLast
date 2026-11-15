import { z } from 'zod';
import {
  AmpereSchema,
  IdSchema,
  IsoDateTimeSchema,
  NetworkEndpointSchema,
  PhaseRotationSchema,
  PositiveAmpereSchema,
  requiredText,
} from './primitives';
import { NamingSchemeSchema } from './naming';

/**
 * Domänenmodell (Kap. 3). Die TypeScript-Typen werden ausschließlich aus den Zod-Schemas abgeleitet.
 *
 * Zwei Stufen (ADR 0004):
 * - `ProjectSchema` prüft Form und Wertebereiche einzelner Felder. Ein so gültiges Projekt darf
 *   noch fachliche Widersprüche enthalten (z. B. minA > maxA), weil der Nutzer im Editor
 *   Zwischenstände erzeugt. Diese meldet die Prüfung (Kap. 5) als Findings.
 * - `StrictProjectSchema` erzwingt zusätzlich alle Invarianten (siehe invariants.ts).
 *   Verwendung: Import von Dateien, Export.
 */

export const MeterProtocolSchema = z.enum(['modbus-tcp', 'http', 'loxone-native']);
export type MeterProtocol = z.infer<typeof MeterProtocolSchema>;

export const MeterSchema = z.object({
  vendor: requiredText('Hersteller'),
  model: requiredText('Modell'),
  protocol: MeterProtocolSchema,
  network: NetworkEndpointSchema,
});
export type Meter = z.infer<typeof MeterSchema>;

export const SiteSchema = z.object({
  /** Netzanschluss-Absicherung, z. B. 250 A (HAK/NH-Sicherung). */
  gridConnectionFuseA: PositiveAmpereSchema,
  /** Anzeigename, z. B. „HAK · 250 A NH2“. */
  gridConnectionLabel: requiredText('Bezeichnung des Netzanschlusses'),
  /** Reserve für die übrige Gebäudelast. */
  buildingReserveA: AmpereSchema,
  gridMeter: MeterSchema.optional(),
  pv: z
    .object({
      meter: MeterSchema.optional(),
      peakKw: z.number().min(0, 'PV-Leistung darf nicht negativ sein').max(100000).optional(),
    })
    .optional(),
  // Hinweis: `limitA` aus Kap. 3 wird bewusst NICHT gespeichert, sondern in calc berechnet
  // (gridConnectionFuseA − buildingReserveA), damit gespeicherter und berechneter Wert nie auseinanderlaufen. ADR 0004.
});
export type Site = z.infer<typeof SiteSchema>;

export const ClusterSchema = z.object({
  id: IdSchema,
  /** z. B. „UV-TG1 · Ebene −1“ */
  name: requiredText('Clustername'),
  /** Optional verschachtelt: Unterverteilung in Unterverteilung. */
  parentClusterId: IdSchema.optional(),
  /** Absicherung/Limit der Zuleitung. */
  limitA: PositiveAmpereSchema,
  /** Falls je Phase abweichend (L1, L2, L3). */
  phaseLimitA: z
    .tuple([PositiveAmpereSchema, PositiveAmpereSchema, PositiveAmpereSchema])
    .optional(),
});
export type Cluster = z.infer<typeof ClusterSchema>;

export const PRIORITIES = [1, 2, 3, 4, 5] as const;
export const PrioritySchema = z.literal(PRIORITIES, {
  error: 'Priorität muss zwischen 1 (höchste) und 5 liegen',
});
export type Priority = z.infer<typeof PrioritySchema>;

export const GroupSchema = z.object({
  id: IdSchema,
  /** z. B. „Mieter“, „Flotte“, „Gäste“ */
  name: requiredText('Gruppenname'),
  clusterId: IdSchema,
  /** 1 = höchste Priorität */
  priority: PrioritySchema,
  /** Optionales Gruppen-Limit. */
  maxA: PositiveAmpereSchema.optional(),
  /** Überschreibt den Mindeststrom der Ladepunkte, falls gesetzt. */
  minPerChargePointA: AmpereSchema.optional(),
});
export type Group = z.infer<typeof GroupSchema>;

export const ChargePointProtocolSchema = z.enum(['modbus-tcp', 'http', 'ocpp-bridge']);
export type ChargePointProtocol = z.infer<typeof ChargePointProtocolSchema>;

/** Verweis in die Wallbox-Bibliothek: „hersteller/modell@version“, z. B. „abl/em4-twin@1“. */
export const LibraryModelIdSchema = z
  .string()
  .regex(
    /^[a-z0-9-]+\/[a-z0-9-]+@[0-9]+$/,
    'Modell-ID muss die Form „hersteller/modell@version“ haben',
  );

export const ChargePointSchema = z.object({
  id: IdSchema,
  /** z. B. „LP01“ */
  label: requiredText('Ladepunkt-Bezeichnung'),
  groupId: IdSchema,
  libraryModelId: LibraryModelIdSchema,
  network: NetworkEndpointSchema,
  protocol: ChargePointProtocolSchema,
  /** Absicherung der Zuleitung. */
  fuseA: PositiveAmpereSchema,
  /** ≥ 6 A (IEC 61851) – als Invariante geprüft, nicht im Feldschema. */
  minA: AmpereSchema,
  /** ≤ min(fuseA, Modell-Max) */
  maxA: AmpereSchema,
  phases: z.literal([1, 3], { error: 'Anschluss muss 1- oder 3-phasig sein' }),
  phaseRotation: PhaseRotationSchema,
  /** Nur zulässig, wenn das Modell es kann (Prüfregel PHASE_SWITCH_UNSUPPORTED). */
  phaseSwitching: z.boolean(),
  room: z.string().trim().max(200).optional(),
  category: z.string().trim().max(200).optional(),
  notes: z.string().max(5000).optional(),
});
export type ChargePoint = z.infer<typeof ChargePointSchema>;

export const ProjectSettingsSchema = z.object({
  voltageV: z
    .number({ error: 'Spannung muss eine Zahl sein' })
    .min(100, 'Spannung muss zwischen 100 und 500 V liegen')
    .max(500, 'Spannung muss zwischen 100 und 500 V liegen'),
  maxUnbalanceA: AmpereSchema,
  namingScheme: NamingSchemeSchema,
});
export type ProjectSettings = z.infer<typeof ProjectSettingsSchema>;

export const ExportRecordSchema = z.object({
  id: IdSchema,
  createdAt: IsoDateTimeSchema,
  mode: z.enum(['templates', 'project']),
  configVersion: z.string().optional(),
  /** Für die Erkennung von Strukturänderungen (Kap. 9). */
  structureHash: z.string().min(1),
  user: z.string().optional(),
});
export type ExportRecord = z.infer<typeof ExportRecordSchema>;

/** Aktuelle Version des gespeicherten Projektformats. Bei Änderungen: Migration ergänzen (migrations/). */
export const CURRENT_SCHEMA_VERSION = 1;

export const ProjectSchema = z.object({
  id: IdSchema,
  schemaVersion: z.literal(CURRENT_SCHEMA_VERSION, {
    error: `Projektformat-Version wird nicht unterstützt (erwartet: ${CURRENT_SCHEMA_VERSION})`,
  }),
  /** Vorbereitet für späteren Mehrmandanten-Betrieb (Kap. 12), derzeit ungenutzt. */
  tenantId: z.string().optional(),
  name: requiredText('Projektname'),
  address: z.string().max(500).optional(),
  customer: z.string().max(200).optional(),
  notes: z.string().max(20000).optional(),
  site: SiteSchema,
  clusters: z.array(ClusterSchema),
  groups: z.array(GroupSchema),
  chargePoints: z.array(ChargePointSchema),
  settings: ProjectSettingsSchema,
  exportHistory: z.array(ExportRecordSchema),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type Project = z.infer<typeof ProjectSchema>;
