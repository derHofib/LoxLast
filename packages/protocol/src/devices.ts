import { z } from 'zod';
import { LibraryModelIdSchema, NetworkEndpointSchema } from './network';

/**
 * POST /api/devices/test – Verbindungstest zu einem Ladepunkt (Kap. 8.1/8.2, ADR 0012).
 *
 * Das Gateway liest nur; Registeradressen, Funktionscode, Typ und Skalierung stammen
 * ausschließlich aus der Modelldatei der Wallbox-Bibliothek. Optional schickt der Browser die
 * Modelldatei mit, die er gerade verwendet (gebündelte oder nachgeladene Bibliothek); das Gateway
 * prüft sie mit Schema und Regeln der Bibliothek. Ohne `model` gilt die Bibliothek des Gateways.
 */
export const DeviceTestRequestSchema = z.object({
  endpoint: NetworkEndpointSchema,
  libraryModelId: LibraryModelIdSchema,
  /** Modelldatei (JSON-Objekt) im Format der Wallbox-Bibliothek; `id` muss `libraryModelId` sein. */
  model: z.record(z.string(), z.unknown()).optional(),
});
export type DeviceTestRequest = z.infer<typeof DeviceTestRequestSchema>;

/** Rollen, die der Verbindungstest liest (Ströme, Leistung, Status). */
export const DEVICE_TEST_ROLES = [
  'currentL1',
  'currentL2',
  'currentL3',
  'power',
  'status',
] as const;
export type DeviceTestRole = (typeof DEVICE_TEST_ROLES)[number];

/**
 * Ergebnis:
 * - `ok`: alle Register gelesen.
 * - `not_testable`: Register fehlen in der Bibliothek (TODO) – es wurde kein Register gelesen,
 *   höchstens die TCP-Verbindung geprüft.
 * - `device_error`: Gerät erreichbar, aber Modbus-Fehler (Ausnahme, keine Antwort, ungültige Antwort).
 * - `unreachable`: keine TCP-Verbindung.
 */
export const DeviceTestOutcomeSchema = z.enum([
  'ok',
  'not_testable',
  'device_error',
  'unreachable',
]);
export type DeviceTestOutcome = z.infer<typeof DeviceTestOutcomeSchema>;

export const DeviceReadingSchema = z.object({
  role: z.enum(DEVICE_TEST_ROLES),
  /** Deutsche Bezeichnung, z. B. „Strom L1“. */
  label: z.string(),
  /** Skalierter Wert; null, wenn das Lesen fehlschlug. */
  value: z.number().nullable(),
  /** Einheit aus der Bibliothek, z. B. „A“. */
  unit: z.string(),
  /** Klartext des Status aus der Bibliothek (enum); null, wenn dort keiner steht. */
  text: z.string().nullable(),
  /** Gelesene Rohregister. */
  raw: z.array(z.number().int().min(0).max(65535)),
  /** Deutscher Fehlertext für dieses Register. */
  error: z.string().nullable(),
});
export type DeviceReading = z.infer<typeof DeviceReadingSchema>;

export const DeviceTestResponseSchema = z.object({
  outcome: DeviceTestOutcomeSchema,
  reachable: z.boolean(),
  latencyMs: z.number().nonnegative().nullable(),
  /** Kurzform: Rolle → skalierter Wert (bzw. Statustext). */
  values: z.record(z.string(), z.union([z.number(), z.string()]).nullable()),
  /** Die Bibliothek kennt kein Firmware-Register; bleibt null, bis sie eins beschreibt. */
  firmware: z.string().nullable(),
  readings: z.array(DeviceReadingSchema),
  /** Fehlende Bibliotheksangaben (Feldpfade wie „modbus.registers.power.address“). */
  missing: z.array(z.string()),
  /** Deutscher Hinweis oder Fehlertext; null bei Erfolg. */
  message: z.string().nullable(),
  /** Herkunft der Modelldatei: aus der Anfrage oder aus der Bibliothek des Gateways. */
  modelSource: z.enum(['request', 'gateway']).nullable(),
  testedAt: z.iso.datetime(),
});
export type DeviceTestResponse = z.infer<typeof DeviceTestResponseSchema>;

/** Standard-Polling (Kap. 8.4), je Gerät konfigurierbar. */
export const DEFAULT_POLL_INTERVAL_MS = 2000;
