import { z } from 'zod';

/**
 * Pairing: Das Gateway zeigt beim Start einen Einmalcode (Konsole/Log). Der Browser tauscht
 * ihn gegen ein kurzlebiges Token, das vor Ablauf erneuert wird. Codes sind einmalig nutzbar.
 */
export const PAIRING_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;

export const PairRequestSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(PAIRING_CODE_PATTERN, 'Format: XXXX-XXXX (ohne 0, 1, I, O)'),
});
export type PairRequest = z.infer<typeof PairRequestSchema>;

export const TokenResponseSchema = z.object({
  token: z.string().min(20),
  /** ISO-8601, UTC */
  expiresAt: z.iso.datetime(),
});
export type TokenResponse = z.infer<typeof TokenResponseSchema>;
