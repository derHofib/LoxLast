import { z } from 'zod';

/**
 * Gemeinsame Schemas für Gateway ↔ Browser (Kap. 8).
 * Meilenstein 1: nur Health-Check. Die übrigen Endpunkte und WebSocket-Nachrichten
 * folgen mit Meilenstein 8.
 */

export const HealthResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.literal('lastplan-gateway'),
  version: z.string(),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
