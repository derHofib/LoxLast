import { z } from 'zod';

/** POST /api/projects/:id/parameters – Werte der virtuellen Eingänge (Kap. 7.2/9). Folgt mit Meilenstein 9. */
export const ParameterChangeSchema = z.object({
  name: z.string().min(1).max(200),
  value: z.number().finite(),
});
export type ParameterChange = z.infer<typeof ParameterChangeSchema>;

export const ParametersRequestSchema = z.object({
  changes: z.array(ParameterChangeSchema).min(1).max(200),
  /** Pflicht bei kritischen Änderungen (Kap. 9). */
  confirm: z.boolean().optional(),
});
export type ParametersRequest = z.infer<typeof ParametersRequestSchema>;

export const ParameterResultSchema = z.object({
  name: z.string(),
  ok: z.boolean(),
  /** Rücklesewert (Kap. 8.4); bei Abweichung ok=false */
  readBack: z.number().nullable(),
  error: z.string().optional(),
});
export type ParameterResult = z.infer<typeof ParameterResultSchema>;

export const ParametersResponseSchema = z.object({ results: z.array(ParameterResultSchema) });
export type ParametersResponse = z.infer<typeof ParametersResponseSchema>;

/** Live-Wert je Ladepunkt (`live.update`, GET /api/projects/:id/live). */
export const LiveChargePointSchema = z.object({
  label: z.string(),
  status: z.string().nullable(),
  setpointA: z.number().nullable(),
  currentA: z.tuple([z.number().nullable(), z.number().nullable(), z.number().nullable()]),
  powerKw: z.number().nullable(),
  fault: z.boolean(),
});
export type LiveChargePoint = z.infer<typeof LiveChargePointSchema>;

export const LiveSnapshotSchema = z.object({
  updatedAt: z.iso.datetime().nullable(),
  chargePoints: z.array(LiveChargePointSchema),
});
export type LiveSnapshot = z.infer<typeof LiveSnapshotSchema>;
