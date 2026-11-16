import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

/**
 * Nachbildung des „LOXONE Config“-MCP für Tests (ADR 0013). Bildet nur nach, was die
 * Selbstbeschreibung dokumentiert: Werkzeuge `sdk_describe` und `code_query`, Skriptergebnis
 * `{ value, logs }` bzw. `{ success: false, error, message }`. Skripte werden nicht ausgeführt;
 * `onQuery` entscheidet, was zurückkommt.
 */
export interface FakeConfigMcpOptions {
  declarations?: string;
  onQuery?: (code: string) => { value: unknown } | { error: string; message: string };
  /** Antwort von `get_doc` je Typ; fehlt der Typ, antwortet der Fake mit einem Werkzeugfehler. */
  docs?: Record<string, string>;
  /** Antwort von `code_run`; ohne Angabe `{ value: null }`. */
  onRun?: (code: string) => { value: unknown } | { error: string; message: string };
  /** Antwort von `undo` bzw. `save_project` als JSON-Objekt; `isError`, wenn `success: false`. */
  onUndo?: () => Record<string, unknown>;
  onSave?: () => Record<string, unknown>;
}

/** Auszug aus `sdk_describe` (Form wie geliefert: Methoden als `name(p: …): Result;`). */
export const FAKE_DECLARATIONS = `declare const cfg: {
  get_project(): GetProjectResult;
  get_pages(): GetPagesResult;
  get_block_index(): GetBlockIndexResult;
  get_block(p: { uuid: string }): GetBlockResult;
  get_block_types(): GetBlockTypesResult;
  get_block_properties(p: { uuid: string }): GetBlockPropertiesResult;
  get_property_options(p: { uuid: string; property_id: number }): GetPropertyOptionsResult;
  get_tree(p: { root_uuid?: string; depth?: number }): GetTreeResult;
  get_insertable_types(p: { parent_uuid?: string }): GetInsertableTypesResult;
  insert_object(p: { type: string; parent_uuid: string; name?: string; hardware_version?: number }): ObjectInsertResult;
  add_page(p: { name: string; context_uuid?: string }): PageMutationResult;
  add_block(p: { type: string; page_uuid: string; title?: string }): BlockMutationResult;
  add_object_ref(p: { source_uuid: string; page_uuid: string }): BlockMutationResult;
  set_block_property(p: { uuid: string; property_id: number | string; value: unknown }): SetBlockPropertyResult;
  connect_blocks(p: { from_block_uuid: string; from_connector_key: string; to_block_uuid: string; to_connector_key: string }): ConnectionResult;
  arrange_page(p: { page_uuid: string }): ArrangePageResult;
  validate_project(): ValidateResult;
};`;

export interface FakeConfigMcp {
  url: URL;
  queries: string[];
  runs: string[];
  /** Aufrufe von `undo` und `save_project`, in Reihenfolge. */
  lifecycle: string[];
  stop(): Promise<void>;
}

export async function startFakeConfigMcp(opts: FakeConfigMcpOptions = {}): Promise<FakeConfigMcp> {
  const queries: string[] = [];
  const runs: string[] = [];
  const lifecycle: string[] = [];
  const scriptPayload = (r: { value: unknown } | { error: string; message: string }) =>
    'error' in r
      ? { success: false, error: r.error, message: r.message, logs: [] }
      : { value: r.value, logs: [] };
  const objectReply = (o: Record<string, unknown>) => ({
    content: [{ type: 'text' as const, text: JSON.stringify(o) }],
    ...(o['success'] === false ? { isError: true } : {}),
  });
  const build = (): McpServer => {
    const server = new McpServer({ name: 'loxone-config', version: 'fake' });
    server.registerTool('sdk_describe', { inputSchema: { method: z.string().optional() } }, () => ({
      content: [{ type: 'text', text: opts.declarations ?? FAKE_DECLARATIONS }],
    }));
    server.registerTool(
      'code_query',
      { inputSchema: { code: z.string(), timeout_ms: z.number().int().optional() } },
      ({ code }) => {
        queries.push(code);
        const r = opts.onQuery?.(code) ?? { value: null };
        const payload =
          'error' in r
            ? { success: false, error: r.error, message: r.message, logs: [] }
            : { value: r.value, logs: [] };
        return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
      },
    );
    server.registerTool(
      'get_doc',
      { inputSchema: { type: z.string().optional(), uuid: z.string().optional() } },
      ({ type }) => {
        const doc = type === undefined ? undefined : opts.docs?.[type];
        return doc === undefined
          ? { content: [{ type: 'text', text: 'NOT_FOUND' }], isError: true }
          : { content: [{ type: 'text', text: doc }] };
      },
    );
    server.registerTool(
      'code_run',
      { inputSchema: { code: z.string(), timeout_ms: z.number().int().optional() } },
      ({ code }) => {
        runs.push(code);
        const payload = scriptPayload(opts.onRun?.(code) ?? { value: null });
        return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
      },
    );
    server.registerTool('undo', {}, () => {
      lifecycle.push('undo');
      return objectReply(opts.onUndo?.() ?? { success: true, canUndo: false, canRedo: true });
    });
    server.registerTool('save_project', { inputSchema: { path: z.string().optional() } }, () => {
      lifecycle.push('save_project');
      return objectReply(opts.onSave?.() ?? { success: true });
    });
    return server;
  };

  // Zustandslos: je Anfrage ein eigener Server und Transport.
  const http: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      void (async () => {
        const server = build();
        const transport = new StreamableHTTPServerTransport({});
        res.on('close', () => {
          void transport.close();
          void server.close();
        });
        await server.connect(transport);
        const raw = Buffer.concat(chunks).toString('utf8');
        await transport.handleRequest(req, res, raw ? JSON.parse(raw) : undefined);
      })();
    });
  });
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  const { port } = http.address() as AddressInfo;
  return {
    url: new URL(`http://127.0.0.1:${port}/mcp`),
    queries,
    runs,
    lifecycle,
    stop: () =>
      new Promise<void>((resolve) => {
        http.closeAllConnections();
        http.close(() => resolve());
      }),
  };
}
