import { z } from 'zod';

/**
 * WebSocket `/api/live`. Der Browser kann bei WebSockets keine Header setzen; deshalb
 * authentifiziert die erste Nachricht (`auth`) – das Token steht nie in der URL.
 * Nutzdaten (Live-Werte, Parameter schreiben) folgen mit Meilenstein 9.
 */
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
    code: z.enum(['unauthorized', 'invalid_message']),
    message: z.string(),
  }),
]);
export type ServerMessage = z.infer<typeof ServerMessageSchema>;

/** Verbindung wird geschlossen, wenn nicht binnen dieser Zeit authentifiziert wurde. */
export const WS_AUTH_TIMEOUT_MS = 5000;
