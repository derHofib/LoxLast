import { z } from 'zod';
import { MiniserverStatusSchema } from './miniserver';
import { LiveChargePointSchema, ParameterResultSchema } from './parameters';

/**
 * WebSocket `/ws` (Kap. 8.3). Der Browser kann bei WebSockets keine Header setzen; deshalb
 * authentifiziert die erste Nachricht (`auth`) – das Token steht nie in der URL.
 * Die Nutzdaten-Nachrichten sind spezifiziert; gesendet werden sie ab Meilenstein 9.
 */
export const WS_PATH = '/ws';

export const ClientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('auth'), token: z.string().min(20) }),
  z.object({ type: z.literal('ping'), nonce: z.string().max(64).optional() }),
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

export const ServerMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready'), serverTime: z.iso.datetime() }),
  z.object({ type: z.literal('pong'), nonce: z.string().max(64).optional() }),
  z.object({
    type: z.literal('error'),
    code: z.enum(['unauthorized', 'invalid_message', 'forbidden_origin']),
    message: z.string(),
  }),
  z.object({
    type: z.literal('live.update'),
    projectId: z.string(),
    at: z.iso.datetime(),
    chargePoint: LiveChargePointSchema,
  }),
  z.object({ type: z.literal('miniserver.state'), status: MiniserverStatusSchema }),
  z.object({
    type: z.literal('parameter.applied'),
    projectId: z.string(),
    result: ParameterResultSchema,
  }),
  z.object({
    type: z.literal('parameter.failed'),
    projectId: z.string(),
    result: ParameterResultSchema,
    message: z.string(),
  }),
  z.object({
    type: z.literal('structure.mismatch'),
    projectId: z.string(),
    message: z.string(),
  }),
]);
export type ServerMessage = z.infer<typeof ServerMessageSchema>;

/** Verbindung wird geschlossen, wenn nicht binnen dieser Zeit authentifiziert wurde. */
export const WS_AUTH_TIMEOUT_MS = 5000;
