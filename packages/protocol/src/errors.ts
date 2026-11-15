import { z } from 'zod';

/** Einheitliche Fehlerantwort: maschinenlesbarer Code + deutscher Text mit Lösungsvorschlag (Kap. 1). */
export const ErrorCodeSchema = z.enum([
  'invalid_request',
  'unauthorized',
  'forbidden_origin',
  'pairing_code_invalid',
  'rate_limited',
  'not_found',
  'not_implemented',
  'internal_error',
]);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const ErrorResponseSchema = z.object({
  error: z.object({
    code: ErrorCodeSchema,
    message: z.string(),
  }),
});
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
