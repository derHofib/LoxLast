import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

/**
 * Zugang zum „LOXONE Config“-MCP (ADR 0013).
 *
 * Belegt durch die Selbstbeschreibung des Servers (skill_read, abgerufen 2026-11-16):
 * LoxoneConfig.exe startet den Server selbst, sobald „Config MCP“ aktiviert ist; Transport
 * Streamable HTTP auf `127.0.0.1:57707`, der genaue Endpunkt steht im Plugin-Manifest.
 * TODO(verify): Pfad des Endpunkts – deshalb gibt es keinen Standardwert, `CONFIG_MCP_URL` ist
 * vollständig anzugeben.
 *
 * Skripte laufen über `code_query` (nur lesend) und `code_run` (ändernd). Ergebnis eines Skripts:
 * `{ value, logs }`, bei Fehler `{ success: false, error, message, logs }`.
 */
export interface ConfigMcpClient {
  /** Name und Version, die der Server beim Verbindungsaufbau meldet. */
  serverInfo(): Promise<{ name: string; version: string }>;
  /** TypeScript-Deklarationen der `cfg.*`-API (`sdk_describe` ohne Argument). */
  describeSdk(): Promise<string>;
  /** Nur lesendes Skript (`code_query`). Liefert `value` des Skripts. */
  query(code: string, timeoutMs?: number): Promise<unknown>;
  close(): Promise<void>;
}

/** Fehler eines Skripts oder Werkzeugs, mit dem Fehlercode des Servers (z. B. `NO_DOCUMENT`). */
export class ConfigMcpError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ConfigMcpError';
  }
}

/** Keine Verbindung zum Server (Config läuft nicht, „Config MCP“ aus, falsche Adresse). */
export class ConfigMcpUnreachableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ConfigMcpUnreachableError';
  }
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

/**
 * Prüft die Adresse: nur http(s) auf Loopback. Der Endpunkt hat keine dokumentierte Anmeldung;
 * eine Adresse im Netz hieße, dass jeder dort Projekte ändern könnte (ADR 0013).
 */
export function parseConfigMcpUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`CONFIG_MCP_URL „${raw}“ ist keine gültige Adresse.`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`CONFIG_MCP_URL muss mit http:// oder https:// beginnen.`);
  }
  if (!LOOPBACK.has(url.hostname)) {
    throw new Error(
      `CONFIG_MCP_URL muss auf diesen Rechner zeigen (127.0.0.1, localhost oder [::1]), nicht auf „${url.hostname}“. ` +
        'Das Gateway läuft deshalb auf demselben System wie Loxone Config.',
    );
  }
  return url;
}

interface ToolResult {
  content?: unknown;
  structuredContent?: unknown;
  isError?: boolean;
}

/** Erstes Textstück eines Werkzeug-Ergebnisses. */
function firstText(result: ToolResult): string | undefined {
  if (!Array.isArray(result.content)) return undefined;
  for (const part of result.content as Array<{ type?: unknown; text?: unknown }>) {
    if (part.type === 'text' && typeof part.text === 'string') return part.text;
  }
  return undefined;
}

/**
 * Antwort eines Skript-Werkzeugs auswerten. TODO(verify): ob der Server `{ value, logs }` als
 * `structuredContent` oder als JSON-Text liefert – beides wird angenommen.
 */
export function parseScriptResult(result: ToolResult): unknown {
  let payload: unknown = result.structuredContent;
  if (payload === undefined) {
    const text = firstText(result);
    if (text === undefined) throw new ConfigMcpError('BAD_RESPONSE', 'Antwort ohne Inhalt.');
    try {
      payload = JSON.parse(text);
    } catch {
      if (result.isError) throw new ConfigMcpError('TOOL_ERROR', text);
      throw new ConfigMcpError('BAD_RESPONSE', 'Antwort ist kein JSON.');
    }
  }
  if (typeof payload !== 'object' || payload === null) {
    throw new ConfigMcpError('BAD_RESPONSE', 'Antwort hat kein erwartetes Format.');
  }
  const p = payload as { success?: unknown; error?: unknown; message?: unknown; value?: unknown };
  if (p.success === false || result.isError) {
    const code = typeof p.error === 'string' ? p.error : 'TOOL_ERROR';
    const message = typeof p.message === 'string' ? p.message : code;
    throw new ConfigMcpError(code, message);
  }
  if (!('value' in p)) throw new ConfigMcpError('BAD_RESPONSE', 'Antwort ohne „value“.');
  return p.value;
}

/** Client über das offizielle MCP-SDK (Streamable HTTP). Verbindet beim ersten Aufruf. */
export function createConfigMcpClient(url: URL, clientVersion: string): ConfigMcpClient {
  let connected: Promise<Client> | undefined;

  const connect = (): Promise<Client> => {
    connected ??= (async () => {
      const client = new Client({ name: 'lastplan-gateway', version: clientVersion });
      try {
        await client.connect(new StreamableHTTPClientTransport(url));
      } catch (e) {
        connected = undefined;
        throw new ConfigMcpUnreachableError('Loxone Config ist nicht erreichbar.', { cause: e });
      }
      return client;
    })();
    return connected;
  };

  const call = async (name: string, args: Record<string, unknown>): Promise<ToolResult> => {
    const client = await connect();
    try {
      return (await client.callTool({ name, arguments: args })) as ToolResult;
    } catch (e) {
      // Verbindung verloren: beim nächsten Aufruf neu verbinden.
      connected = undefined;
      await client.close().catch(() => undefined);
      throw new ConfigMcpUnreachableError('Verbindung zu Loxone Config abgebrochen.', { cause: e });
    }
  };

  return {
    async serverInfo() {
      const info = (await connect()).getServerVersion();
      return { name: info?.name ?? '', version: info?.version ?? '' };
    },
    async describeSdk() {
      const result = await call('sdk_describe', {});
      const text = firstText(result);
      if (result.isError || text === undefined) {
        throw new ConfigMcpError('BAD_RESPONSE', 'sdk_describe lieferte keine Deklarationen.');
      }
      return text;
    },
    async query(code, timeoutMs) {
      const args: Record<string, unknown> = { code };
      if (timeoutMs !== undefined) args['timeout_ms'] = timeoutMs;
      return parseScriptResult(await call('code_query', args));
    },
    async close() {
      const pending = connected;
      connected = undefined;
      if (pending) await (await pending.catch(() => undefined))?.close();
    },
  };
}
