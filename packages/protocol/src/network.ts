import { z } from 'zod';

/** Strikte Eingabevalidierung (Kap. 12): IP, Port 1–65535, Unit-ID 0–247. */
export const IpSchema = z.ipv4('Ungültige IPv4-Adresse (z. B. 192.168.1.50)');
export const PortSchema = z.number().int().min(1).max(65535);
export const UnitIdSchema = z.number().int().min(0).max(247);

export const NetworkEndpointSchema = z.object({
  ip: IpSchema,
  port: PortSchema,
  unitId: UnitIdSchema.optional(),
});
export type NetworkEndpoint = z.infer<typeof NetworkEndpointSchema>;

/** Hostname (RFC 1123) oder IPv4 – für den Miniserver auch Cloud-DNS-Namen. */
export const HostSchema = z
  .string()
  .trim()
  .max(253)
  .regex(
    /^(?=.{1,253}$)([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/,
    'Ungültiger Host (Hostname oder IPv4-Adresse, ohne Schema und Port)',
  );

/** Referenz in die Wallbox-Bibliothek, z. B. „abl/em4-twin@1“. */
export const LibraryModelIdSchema = z.string().regex(/^[a-z0-9-]+\/[a-z0-9-]+@\d+$/);
