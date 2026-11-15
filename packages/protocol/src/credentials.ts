import { z } from 'zod';

/**
 * Zugangsdaten für Miniserver und Geräte. Geheimnisse werden nur geschrieben,
 * nie zurückgegeben: Die API liefert ausschließlich Metadaten.
 */
export const CredentialKindSchema = z.enum(['miniserver', 'device']);
export type CredentialKind = z.infer<typeof CredentialKindSchema>;

export const CredentialIdSchema = z
  .string()
  .regex(
    /^[a-z0-9][a-z0-9_-]{0,63}$/,
    'Nur Kleinbuchstaben, Ziffern, „-“ und „_“ (max. 64 Zeichen)',
  );

export const CredentialWriteSchema = z.object({
  kind: CredentialKindSchema,
  label: z.string().trim().min(1).max(120),
  username: z.string().max(200).optional(),
  password: z.string().min(1).max(500),
});
export type CredentialWrite = z.infer<typeof CredentialWriteSchema>;

export const CredentialMetaSchema = z.object({
  id: CredentialIdSchema,
  kind: CredentialKindSchema,
  label: z.string(),
  hasUsername: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type CredentialMeta = z.infer<typeof CredentialMetaSchema>;

export const CredentialListResponseSchema = z.object({
  credentials: z.array(CredentialMetaSchema),
});
export type CredentialListResponse = z.infer<typeof CredentialListResponseSchema>;
