import { z } from 'zod';

/**
 * GET /api/config/status – Verbindung des Gateways zum „LOXONE Config“-MCP (ADR 0013).
 *
 * Nur lesend: `sdk_describe` und ein `code_query` mit `cfg.get_project()`.
 * - `ok`: Config erreichbar, Projekt geöffnet, alle benötigten SDK-Methoden vorhanden.
 * - `not_configured`: `CONFIG_MCP_URL` ist im Gateway nicht gesetzt.
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
