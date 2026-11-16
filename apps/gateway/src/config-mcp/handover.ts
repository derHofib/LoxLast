import type {
  ConfigHandoverPlan,
  ConfigHandoverResponse,
  ConfigSaveResponse,
  ConfigUndoResponse,
} from '@lastplan/protocol';
import { ConfigHandoverResultSchema } from '@lastplan/protocol';
import { renderHandoverScript } from '@lastplan/loxone-export';
import { ConfigMcpError, ConfigMcpUnreachableError, type ConfigMcpClient } from './client';
import { checkConfigMcp } from './status';

/**
 * Übergabe an Config (Umsetzungsplan 6.5, ADR 0013/0014).
 *
 * Das Gateway nimmt einen geprüften Plan entgegen, erzeugt daraus selbst das Skript und führt es
 * mit `code_run` aus (ein Undo-Schritt). Speichern und Rückgängig sind eigene, vom Nutzer
 * ausgelöste Aufrufe; das Skript kann beides nicht.
 */

/** Zeitlimit für den Lauf: große Anlagen legen einige hundert Objekte an. */
export const HANDOVER_TIMEOUT_MS = 120_000;

/** Fehlercodes, bei denen das Skript nicht gestartet ist und nichts angelegt wurde. */
const NOTHING_CHANGED = new Set(['NO_DOCUMENT', 'NOT_READY', 'UNDO_GROUP_ACTIVE']);

export async function runConfigHandover(
  client: ConfigMcpClient | undefined,
  plan: ConfigHandoverPlan,
): Promise<ConfigHandoverResponse> {
  const status = await checkConfigMcp(client);
  if (status.status !== 'ok' || !client) return { status, result: null, failure: null };
  const script = renderHandoverScript(plan);
  try {
    const value = await client.run(script, HANDOVER_TIMEOUT_MS);
    const parsed = ConfigHandoverResultSchema.safeParse(value);
    if (!parsed.success) {
      return {
        status,
        result: null,
        failure: {
          code: 'BAD_RESPONSE',
          message: 'Das Skript ist durchgelaufen, die Antwort hat aber ein unerwartetes Format.',
          undoRecommended: true,
        },
      };
    }
    return { status, result: parsed.data, failure: null };
  } catch (e) {
    if (e instanceof ConfigMcpUnreachableError) {
      return {
        status: { ...status, status: 'unreachable', message: e.message },
        result: null,
        failure: {
          code: 'UNREACHABLE',
          message:
            'Die Verbindung zu Loxone Config ist während der Übergabe abgebrochen. Bitte in Config prüfen, was angelegt wurde.',
          undoRecommended: true,
        },
      };
    }
    const code = e instanceof ConfigMcpError ? e.code : 'ERROR';
    const message = e instanceof ConfigMcpError ? e.message : 'Unbekannter Fehler.';
    return {
      status,
      result: null,
      failure: { code, message, undoRecommended: !NOTHING_CHANGED.has(code) },
    };
  }
}

const describe = (e: unknown): string =>
  e instanceof ConfigMcpUnreachableError
    ? e.message
    : e instanceof ConfigMcpError
      ? `${e.message} (${e.code})`
      : 'Unbekannter Fehler.';

export async function undoConfig(client: ConfigMcpClient | undefined): Promise<ConfigUndoResponse> {
  if (!client) {
    return { success: false, canUndo: false, canRedo: false, message: 'Im Gateway abgeschaltet.' };
  }
  try {
    const state = await client.undo();
    return { success: true, ...state, message: 'Letzter Schritt in Config rückgängig gemacht.' };
  } catch (e) {
    const p = e instanceof ConfigMcpError ? e.payload : {};
    return {
      success: false,
      canUndo: p['canUndo'] === true,
      canRedo: p['canRedo'] === true,
      message:
        e instanceof ConfigMcpError && e.code === 'NOTHING_TO_UNDO'
          ? 'In Config gibt es nichts mehr rückgängig zu machen.'
          : describe(e),
    };
  }
}

export async function saveConfig(client: ConfigMcpClient | undefined): Promise<ConfigSaveResponse> {
  if (!client) return { saved: false, message: 'Im Gateway abgeschaltet.' };
  try {
    await client.save();
    return { saved: true, message: 'Projekt in Loxone Config gespeichert.' };
  } catch (e) {
    if (e instanceof ConfigMcpError && e.code === 'NEEDS_INTERACTION') {
      return {
        saved: false,
        message:
          'Das Projekt hat noch keinen Speicherort. Bitte einmal in Loxone Config mit „Speichern unter“ ablegen.',
      };
    }
    return { saved: false, message: describe(e) };
  }
}
