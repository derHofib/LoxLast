import type { ConfigMcpProject, ConfigMcpStatusResponse } from '@lastplan/protocol';
import { ConfigMcpError, ConfigMcpUnreachableError, type ConfigMcpClient } from './client';

/**
 * `cfg.*`-Methoden, die die Übergabe an Config braucht (ADR 0013, Umsetzungsplan 6.4–6.6).
 * Namen und Signaturen stammen aus `sdk_describe` (abgerufen 2026-11-16). Fehlt eine davon in
 * der laufenden Config, wird die Übergabe gesperrt statt etwas anzunähern.
 */
export const REQUIRED_SDK_METHODS = [
  'get_project',
  'get_pages',
  'get_block_index',
  'get_block',
  'get_block_types',
  'get_block_properties',
  'get_property_options',
  'get_tree',
  'get_insertable_types',
  'insert_object',
  'add_page',
  'add_block',
  'add_object_ref',
  'set_block_property',
  'connect_blocks',
  'validate_project',
] as const;

/** Welche der benötigten Methoden in den Deklarationen von `sdk_describe` fehlen. */
export function findMissingMethods(declarations: string): string[] {
  return REQUIRED_SDK_METHODS.filter((m) => !new RegExp(`\\b${m}\\s*\\(`).test(declarations));
}

/** Liest nur Eckdaten. `cfg.get_project()` liefert `{ project, summary }` (skill_read). */
export const PROJECT_QUERY = `const r = cfg.get_project();
return {
  title: r.project.title,
  modified: r.project.modified,
  pagesCount: r.summary.pagesCount,
  functionBlocksCount: r.summary.functionBlocksCount,
};`;

function asProject(value: unknown): ConfigMcpProject | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const v = value as Record<string, unknown>;
  const count = (x: unknown): x is number => Number.isInteger(x) && (x as number) >= 0;
  if (
    typeof v['title'] !== 'string' ||
    typeof v['modified'] !== 'boolean' ||
    !count(v['pagesCount']) ||
    !count(v['functionBlocksCount'])
  ) {
    return undefined;
  }
  return {
    title: v['title'],
    modified: v['modified'],
    pagesCount: v['pagesCount'],
    functionBlocksCount: v['functionBlocksCount'],
  };
}

const response = (
  r: Pick<ConfigMcpStatusResponse, 'status' | 'message'> & Partial<ConfigMcpStatusResponse>,
): ConfigMcpStatusResponse => ({
  missingMethods: [],
  project: null,
  server: null,
  ...r,
});

/** Verbindung zu Config prüfen, ohne etwas zu ändern. */
export async function checkConfigMcp(
  client: ConfigMcpClient | undefined,
): Promise<ConfigMcpStatusResponse> {
  if (!client) {
    return response({
      status: 'not_configured',
      message:
        'Keine Verbindung zu Loxone Config eingerichtet. Im Gateway CONFIG_MCP_URL setzen (Adresse von „Config MCP“).',
    });
  }
  let server: ConfigMcpStatusResponse['server'] = null;
  try {
    server = await client.serverInfo();
    const missing = findMissingMethods(await client.describeSdk());
    if (missing.length > 0) {
      return response({
        status: 'methods_missing',
        message: `Diese Loxone-Config-Version bietet nicht alles, was LastPlan braucht (fehlt: ${missing.join(', ')}). Übergabe gesperrt.`,
        missingMethods: missing,
        server,
      });
    }
    const project = asProject(await client.query(PROJECT_QUERY));
    if (!project) {
      return response({
        status: 'error',
        message: 'Loxone Config hat unerwartet geantwortet (Projektdaten).',
        server,
      });
    }
    return response({
      status: 'ok',
      message: `Verbunden mit Loxone Config, Projekt „${project.title}“ geöffnet.`,
      project,
      server,
    });
  } catch (e) {
    if (e instanceof ConfigMcpUnreachableError) {
      return response({
        status: 'unreachable',
        message:
          'Loxone Config ist nicht erreichbar. Läuft Config und ist „Config MCP“ in der Titelleiste aktiviert?',
        server,
      });
    }
    if (e instanceof ConfigMcpError && e.code === 'NO_DOCUMENT') {
      return response({
        status: 'no_document',
        message: 'Loxone Config ist erreichbar, aber es ist kein Projekt geöffnet.',
        server,
      });
    }
    if (e instanceof ConfigMcpError && e.code === 'NOT_READY') {
      return response({
        status: 'unreachable',
        message: 'Loxone Config startet gerade den MCP-Server. Bitte gleich noch einmal prüfen.',
        server,
      });
    }
    return response({
      status: 'error',
      message: `Loxone Config hat einen Fehler gemeldet${e instanceof ConfigMcpError ? ` (${e.code})` : ''}.`,
      server,
    });
  }
}
