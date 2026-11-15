import { z } from 'zod';

/**
 * Grundbausteine des Domänenmodells.
 * Einheiten: Ströme in Ampere (A), Leistung in kW, Spannung in V.
 */

/** UUID v7 (zeitlich sortierbar), siehe ADR 0003. */
export const IdSchema = z.uuid({ version: 'v7', error: 'Ungültige ID (UUID v7 erwartet)' });
export type Id = z.infer<typeof IdSchema>;

/** Obergrenze für plausible Stromwerte. Schützt vor Tippfehlern wie 2500 statt 250. */
export const MAX_PLAUSIBLE_CURRENT_A = 6300;

/** Mindestladestrom nach IEC 61851-1. */
export const IEC_MIN_CHARGING_CURRENT_A = 6;

export const AmpereSchema = z
  .number({ error: 'Strom muss eine Zahl sein' })
  .min(0, 'Strom darf nicht negativ sein')
  .max(MAX_PLAUSIBLE_CURRENT_A, `Strom über ${MAX_PLAUSIBLE_CURRENT_A} A ist unplausibel`);

/** Strom, der größer als 0 sein muss (Absicherungen, Limits). */
export const PositiveAmpereSchema = AmpereSchema.refine(
  (a) => a > 0,
  'Strom muss größer als 0 A sein',
);

export const PortSchema = z
  .int({ error: 'Port muss eine ganze Zahl sein' })
  .min(1, 'Port muss zwischen 1 und 65535 liegen')
  .max(65535, 'Port muss zwischen 1 und 65535 liegen');

/** Modbus Unit-ID: 0–247 (Kap. 12). */
export const UnitIdSchema = z
  .int({ error: 'Unit-ID muss eine ganze Zahl sein' })
  .min(0, 'Unit-ID muss zwischen 0 und 247 liegen')
  .max(247, 'Unit-ID muss zwischen 0 und 247 liegen');

export const IpV4Schema = z.ipv4({ error: 'Ungültige IPv4-Adresse (Beispiel: 192.168.1.20)' });

export const NetworkEndpointSchema = z.object({
  ip: IpV4Schema,
  port: PortSchema,
  unitId: UnitIdSchema.optional(),
});
export type NetworkEndpoint = z.infer<typeof NetworkEndpointSchema>;

/**
 * Phasenrotation: bildet Fahrzeugphasen auf Netzphasen ab (Kap. 4.2).
 * „L2-L3-L1“ heißt: Fahrzeugphase 1 → L2, 2 → L3, 3 → L1.
 */
export const PHASE_ROTATIONS = ['L1-L2-L3', 'L2-L3-L1', 'L3-L1-L2'] as const;
export const PhaseRotationSchema = z.enum(PHASE_ROTATIONS, {
  error: 'Phasenlage muss L1-L2-L3, L2-L3-L1 oder L3-L1-L2 sein',
});
export type PhaseRotation = z.infer<typeof PhaseRotationSchema>;

export const IsoDateTimeSchema = z.iso.datetime({
  offset: true,
  error: 'Ungültiger Zeitstempel (ISO 8601 erwartet)',
});

/** Pflicht-Text: nach dem Trimmen nicht leer. */
export const requiredText = (field: string) =>
  z
    .string()
    .trim()
    .min(1, `${field} darf nicht leer sein`)
    .max(200, `${field} ist zu lang (max. 200 Zeichen)`);
