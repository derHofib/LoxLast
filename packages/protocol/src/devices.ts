import { z } from 'zod';
import { LibraryModelIdSchema, NetworkEndpointSchema } from './network';

/** POST /api/devices/test – Implementierung folgt mit Test-Wallbox (Register nur aus der Bibliothek). */
export const DeviceTestRequestSchema = z.object({
  endpoint: NetworkEndpointSchema,
  libraryModelId: LibraryModelIdSchema,
});
export type DeviceTestRequest = z.infer<typeof DeviceTestRequestSchema>;

export const DeviceTestResponseSchema = z.object({
  reachable: z.boolean(),
  latencyMs: z.number().nonnegative().nullable(),
  values: z.record(z.string(), z.union([z.number(), z.string()]).nullable()),
  firmware: z.string().nullable(),
});
export type DeviceTestResponse = z.infer<typeof DeviceTestResponseSchema>;

/** Standard-Polling (Kap. 8.4), je Gerät konfigurierbar. */
export const DEFAULT_POLL_INTERVAL_MS = 2000;
