import { z } from 'zod';

/** Änderungsprotokoll (Kap. 8.1, 9): wer, wann, alt, neu. Enthält nie Geheimnisse. */
export const ChangelogActionSchema = z.enum([
  'pairing.success',
  'token.refresh',
  'miniserver.configure',
  // Reserviert für Meilenstein 9:
  'parameter.write',
  'parameter.revert',
]);
export type ChangelogAction = z.infer<typeof ChangelogActionSchema>;

export const ChangelogEntrySchema = z.object({
  id: z.number().int().positive(),
  at: z.iso.datetime(),
  /** Pseudonym der gekoppelten Sitzung (kein Klarname; Nutzerverwaltung gibt es nicht). */
  actor: z.string().nullable(),
  action: ChangelogActionSchema,
  projectId: z.string().nullable(),
  target: z.string().nullable(),
  before: z.unknown().nullable(),
  after: z.unknown().nullable(),
});
export type ChangelogEntry = z.infer<typeof ChangelogEntrySchema>;

export const ChangelogQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  beforeId: z.coerce.number().int().positive().optional(),
});
export type ChangelogQuery = z.infer<typeof ChangelogQuerySchema>;

export const ChangelogResponseSchema = z.object({ entries: z.array(ChangelogEntrySchema) });
export type ChangelogResponse = z.infer<typeof ChangelogResponseSchema>;

/** POST /api/projects/:id/changelog/:entryId/revert – folgt mit Meilenstein 9. */
export const ChangelogRevertResponseSchema = z.object({ entry: ChangelogEntrySchema });
export type ChangelogRevertResponse = z.infer<typeof ChangelogRevertResponseSchema>;

export const ProjectIdSchema = z.uuid();
