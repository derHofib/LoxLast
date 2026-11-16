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

export const ConfigHandoverPlanSchema = z.object({
  pageName: PlanTitleSchema,
  loadManagers: z
    .array(
      z.object({
        key: PlanKeySchema,
        title: PlanTitleSchema,
        maxKw: KwSchema,
        parent: ParentSchema.optional(),
      }),
    )
    .min(1)
    .max(500),
  wallboxManagers: z
    .array(z.object({ key: PlanKeySchema, title: PlanTitleSchema, parent: ParentSchema }))
    .max(2000),
  wallboxes: z
    .array(
      z.object({ key: PlanKeySchema, title: PlanTitleSchema, maxKw: KwSchema, minKw: KwSchema }),
    )
    .max(5000),
  virtualInputs: z
    .array(
      z.object({
        key: PlanKeySchema,
        name: PlanTitleSchema,
        target: z.object({ key: PlanKeySchema, connector: z.enum(['maxP', 'Pmax']) }),
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
  /** UUIDs der angelegten Objekte je Plan-Schlüssel. */
  created: z.record(z.string(), z.string()),
  validation: z.object({ valid: z.boolean(), issues: z.array(ConfigValidationIssueSchema) }),
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
