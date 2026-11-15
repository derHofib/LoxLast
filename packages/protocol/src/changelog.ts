import { z } from 'zod';

/** Änderungsprotokoll (Kap. 8.1). Enthält nie Geheimnisse. */
export const ChangelogActionSchema = z.enum([
  'pairing.success',
  'token.refresh',
  'credential.set',
  'credential.delete',
  // Ab Meilenstein 9: 'parameter.write' (Vorher/Nachher-Werte)
]);
export type ChangelogAction = z.infer<typeof ChangelogActionSchema>;

export const ChangelogEntrySchema = z.object({
  id: z.number().int().positive(),
  at: z.iso.datetime(),
  action: ChangelogActionSchema,
  target: z.string().nullable(),
  detail: z.record(z.string(), z.unknown()).nullable(),
});
export type ChangelogEntry = z.infer<typeof ChangelogEntrySchema>;

export const ChangelogQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  beforeId: z.coerce.number().int().positive().optional(),
});
export type ChangelogQuery = z.infer<typeof ChangelogQuerySchema>;

export const ChangelogResponseSchema = z.object({ entries: z.array(ChangelogEntrySchema) });
export type ChangelogResponse = z.infer<typeof ChangelogResponseSchema>;
