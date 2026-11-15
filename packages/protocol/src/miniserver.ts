import { z } from 'zod';
import { HostSchema } from './network';

/** POST /api/miniserver – Passwort wird nur geschrieben und verschlüsselt gespeichert. */
export const MiniserverConfigRequestSchema = z.object({
  host: HostSchema,
  user: z.string().trim().min(1).max(200),
  password: z.string().min(1).max(500),
});
export type MiniserverConfigRequest = z.infer<typeof MiniserverConfigRequestSchema>;

export const MiniserverConfigResponseSchema = z.object({
  configured: z.boolean(),
  host: z.string().nullable(),
  user: z.string().nullable(),
});
export type MiniserverConfigResponse = z.infer<typeof MiniserverConfigResponseSchema>;

export const MiniserverStateSchema = z.enum(['connected', 'connecting', 'disconnected', 'error']);
export type MiniserverState = z.infer<typeof MiniserverStateSchema>;

/** GET /api/miniserver/status; auch Payload von `miniserver.state` (Kap. 8.3/8.4). */
export const MiniserverStatusSchema = z.object({
  state: MiniserverStateSchema,
  /** Zeitpunkt der letzten empfangenen Werte → „letzte Werte von 14:32“ */
  lastValuesAt: z.iso.datetime().nullable(),
  message: z.string().optional(),
});
export type MiniserverStatus = z.infer<typeof MiniserverStatusSchema>;
