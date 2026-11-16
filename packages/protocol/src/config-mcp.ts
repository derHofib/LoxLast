import { z } from 'zod';

/**
 * GET /api/config/status – Verbindung des Gateways zum „LOXONE Config“-MCP (ADR 0013).
 *
 * Nur lesend: `sdk_describe` und ein `code_query` mit `cfg.get_project()`.
 * - `ok`: Config erreichbar, Projekt geöffnet, alle benötigten SDK-Methoden vorhanden.
 * - `not_configured`: im Gateway abgeschaltet (`CONFIG_MCP_URL=off`).
 * - `unreachable`: keine Verbindung (Config läuft nicht oder „Config MCP“ ist aus).
 * - `no_document`: Config erreichbar, aber kein Projekt geöffnet.
 * - `methods_missing`: Die Config bietet eine benötigte SDK-Methode nicht an (andere Version).
 * - `error`: unerwartete Antwort.
 */
export const ConfigMcpStatusSchema = z.enum([
  'ok',
  'not_configured',
  'unreachable',
  'no_document',
  'methods_missing',
  'error',
]);
export type ConfigMcpStatus = z.infer<typeof ConfigMcpStatusSchema>;

export const ConfigMcpProjectSchema = z.object({
  title: z.string(),
  modified: z.boolean(),
  pagesCount: z.number().int().nonnegative(),
  functionBlocksCount: z.number().int().nonnegative(),
});
export type ConfigMcpProject = z.infer<typeof ConfigMcpProjectSchema>;

export const ConfigMcpStatusResponseSchema = z.object({
  status: ConfigMcpStatusSchema,
  /** Klartext für die Oberfläche (deutsch). */
  message: z.string(),
  /** Nur bei `methods_missing`: die fehlenden `cfg.*`-Methoden. */
  missingMethods: z.array(z.string()),
  /** Nur bei `ok`: Eckdaten des in Config geöffneten Projekts. */
  project: ConfigMcpProjectSchema.nullable(),
  /** Name und Version, die der MCP-Server beim Verbindungsaufbau meldet. */
  server: z.object({ name: z.string(), version: z.string() }).nullable(),
});
export type ConfigMcpStatusResponse = z.infer<typeof ConfigMcpStatusResponseSchema>;

/**
 * GET /api/config/discovery – Config-Erkundung (Umsetzungsplan 6.3), nur lesend. `report` enthält
 * die Antwort von Config weitgehend unverändert (Feldnamen aus `sdk_describe`); er ist zum
 * Herunterladen und Auswerten gedacht, nicht zur Anzeige im Detail.
 */
export const ConfigDiscoveryReportSchema = z.object({
  generatedAt: z.string(),
  server: ConfigMcpStatusResponseSchema.shape.server,
  project: ConfigMcpProjectSchema.nullable(),
  summary: z.object({
    blockTypes: z.number().int().nonnegative(),
    modbusObjects: z.number().int().nonnegative(),
    placedBlocks: z.number().int().nonnegative(),
    errors: z.number().int().nonnegative(),
  }),
  data: z.record(z.string(), z.unknown()),
  docs: z.record(z.string(), z.string()),
});
export type ConfigDiscoveryReport = z.infer<typeof ConfigDiscoveryReportSchema>;

export const ConfigDiscoveryResponseSchema = z.object({
  status: ConfigMcpStatusResponseSchema,
  report: ConfigDiscoveryReportSchema.nullable(),
});
export type ConfigDiscoveryResponse = z.infer<typeof ConfigDiscoveryResponseSchema>;

/**
 * POST /api/config/handover – Übergabe an Config (Umsetzungsplan 6.5, ADR 0013/0014).
 *
 * Die App schickt den Übergabeplan (aus `@lastplan/loxone-export`), nicht ein Skript: Das
 * Gateway erzeugt das `code_run`-Skript selbst und führt nur aus, was dieses Schema zulässt.
 */
const PlanKeySchema = z.string().regex(/^[a-z]+(:[0-9a-zA-Z-]+)?$/, 'Ungültiger Plan-Schlüssel');
const PlanTitleSchema = z.string().trim().min(1).max(200);
const KwSchema = z.number().finite().min(0).max(100000);
const ParentSchema = z.object({ key: PlanKeySchema, slot: z.number().int().min(1).max(12) });

const ConfigUuidSchema = z.string().regex(/^[0-9a-zA-Z-]{1,64}$/, 'Ungültige UUID');

export const ConfigHandoverPlanSchema = z.object({
  pageName: PlanTitleSchema,
  /** Anfang der Seitenkennung (Umsetzungsplan 6.6), z. B. „[lastplan:3f9a0c7e21b4:“. */
  pageMatch: z.string().regex(/^\[lastplan:[0-9a-zA-Z]{1,36}:$/, 'Ungültige Seitenkennung'),
  /** Vorhandene Seite mit derselben Kennung ersetzen; sonst meldet die Übergabe sie nur. */
  replace: z.boolean().default(false),
  /** Was der letzte Lauf angelegt hat; wird beim Ersetzen entfernt, sofern noch vorhanden. */
  previous: z
    .object({
      pages: z.array(ConfigUuidSchema).max(100),
      periphery: z.array(ConfigUuidSchema).max(10000),
    })
    .default({ pages: [], periphery: [] }),
  /** Seiten in Anlege-Reihenfolge; Schlüssel = Ebene (site, cluster:<id>, group:<id>). */
  pages: z
    .array(z.object({ key: PlanKeySchema, name: PlanTitleSchema }))
    .min(1)
    .max(2000),
  loadManagers: z
    .array(
      z.object({
        key: PlanKeySchema,
        title: PlanTitleSchema,
        maxKw: KwSchema,
        page: PlanKeySchema,
        parent: ParentSchema.optional(),
      }),
    )
    .min(1)
    .max(500),
  wallboxManagers: z
    .array(
      z.object({
        key: PlanKeySchema,
        title: PlanTitleSchema,
        parent: ParentSchema,
        page: PlanKeySchema,
      }),
    )
    .max(2000),
  wallboxes: z
    .array(
      z.object({
        key: PlanKeySchema,
        title: PlanTitleSchema,
        maxKw: KwSchema,
        minKw: KwSchema,
        page: PlanKeySchema,
      }),
    )
    .max(5000),
  virtualInputs: z
    .array(
      z.object({
        key: PlanKeySchema,
        name: PlanTitleSchema,
        target: z.object({ key: PlanKeySchema, connector: z.enum(['maxP', 'Pmax']) }),
        page: PlanKeySchema,
      }),
    )
    .max(500),
  modbusDevices: z
    .array(
      z.object({
        key: PlanKeySchema,
        name: PlanTitleSchema,
        wallboxKey: PlanKeySchema,
        serverAddress: z.string().regex(/^\d{1,3}(\.\d{1,3}){3}:\d{1,5}$/),
        unitId: z.number().int().min(0).max(255),
        registers: z
          .array(
            z.object({
              name: PlanTitleSchema,
              kind: z.enum(['sensor', 'actor']),
              role: z.string().regex(/^[a-zA-Z0-9]+$/),
              wallboxConnector: z.enum(['power', 'energy', 'outLimit']),
              properties: z.record(
                z.string().regex(/^\d{1,6}$/),
                z.union([z.number().finite(), z.boolean(), z.string().max(64)]),
              ),
            }),
          )
          .max(20),
      }),
    )
    .max(5000),
});
export type ConfigHandoverPlan = z.infer<typeof ConfigHandoverPlanSchema>;
/** Was die App schickt (replace und previous dürfen fehlen). */
export type ConfigHandoverPlanInput = z.input<typeof ConfigHandoverPlanSchema>;

export const ConfigHandoverRequestSchema = z.object({ plan: ConfigHandoverPlanSchema });
export type ConfigHandoverRequest = z.infer<typeof ConfigHandoverRequestSchema>;

export const ConfigValidationIssueSchema = z.object({
  rule: z.string(),
  severity: z.string(),
  message: z.string(),
  objectUuid: z.string().optional(),
});
export type ConfigValidationIssue = z.infer<typeof ConfigValidationIssueSchema>;

export const ConfigHandoverResultSchema = z.object({
  /**
   * created: neue Seite angelegt; replaced: vorhandene Seite(n) dieses Projekts ersetzt;
   * exists: Seite gibt es schon, ohne „ersetzen“ wurde nichts geändert.
   */
  outcome: z.enum(['created', 'replaced', 'exists']).default('created'),
  /** Seiten mit der Kennung dieses Projekts, die vor dem Lauf da waren. */
  existingPages: z.array(z.object({ name: z.string(), uuid: z.string() })).default([]),
  /** UUIDs der angelegten Objekte je Plan-Schlüssel. */
  created: z.record(z.string(), z.string()),
  /** Angelegte Seiten (mit Folgeseiten) und Peripherie – für das Ersetzen beim nächsten Lauf. */
  pages: z.array(z.string()).default([]),
  periphery: z.array(z.string()).default([]),
  /** Wie viele Objekte beim Ersetzen entfernt wurden. */
  removed: z.number().int().min(0).default(0),
  validation: z
    .object({ valid: z.boolean(), issues: z.array(ConfigValidationIssueSchema) })
    .nullable(),
});
export type ConfigHandoverResult = z.infer<typeof ConfigHandoverResultSchema>;

export const ConfigHandoverResponseSchema = z.object({
  status: ConfigMcpStatusResponseSchema,
  /** Gesetzt, wenn das Skript durchgelaufen ist. */
  result: ConfigHandoverResultSchema.nullable(),
  /**
   * Gesetzt, wenn das Skript mit Fehler abgebrochen ist. Was bis dahin angelegt wurde, liegt in
   * derselben Undo-Gruppe; `undoRecommended` sagt, ob ein Rückgängig sinnvoll ist.
   */
  failure: z
    .object({ code: z.string(), message: z.string(), undoRecommended: z.boolean() })
    .nullable(),
});
export type ConfigHandoverResponse = z.infer<typeof ConfigHandoverResponseSchema>;

/** POST /api/config/undo bzw. /api/config/save – einzelne, bewusst ausgelöste Schritte. */
export const ConfigUndoResponseSchema = z.object({
  success: z.boolean(),
  canUndo: z.boolean(),
  canRedo: z.boolean(),
  message: z.string(),
});
export type ConfigUndoResponse = z.infer<typeof ConfigUndoResponseSchema>;

export const ConfigSaveResponseSchema = z.object({ saved: z.boolean(), message: z.string() });
export type ConfigSaveResponse = z.infer<typeof ConfigSaveResponseSchema>;
