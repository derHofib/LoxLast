import { z } from 'zod';

/**
 * Benennungsschema für Loxone-Objekte (Kap. 3, 7.2).
 * Je Feld sind nur bestimmte Platzhalter erlaubt, damit der Export eindeutige Namen erzeugen kann.
 */
export const NAMING_PLACEHOLDERS = {
  siteManager: [],
  clusterManager: ['cluster'],
  groupLimit: ['cluster', 'group', 'groupNo'],
  wallbox: ['label', 'cluster', 'group', 'groupNo'],
  modbusDevice: ['label'],
} as const satisfies Record<string, readonly string[]>;

export type NamingField = keyof typeof NAMING_PLACEHOLDERS;

const PLACEHOLDER_PATTERN = /\{[^{}]*\}/g;

/** Liefert alle Platzhalter-Namen aus einer Vorlage, z. B. „LIM_{cluster}_{group}“ → [cluster, group]. */
export function extractPlaceholders(template: string): string[] {
  return [...template.matchAll(PLACEHOLDER_PATTERN)].map(([match]) => match.slice(1, -1));
}

const templateSchema = (field: NamingField) => {
  const allowed: readonly string[] = NAMING_PLACEHOLDERS[field];
  return z
    .string()
    .trim()
    .min(1, 'Namensvorlage darf nicht leer sein')
    .max(64, 'Namensvorlage ist zu lang (max. 64 Zeichen)')
    .superRefine((value, ctx) => {
      for (const name of extractPlaceholders(value)) {
        if (!allowed.includes(name)) {
          ctx.addIssue({
            code: 'custom',
            message:
              allowed.length === 0
                ? `Platzhalter {${name}} ist hier nicht erlaubt – diese Vorlage hat keine Platzhalter`
                : `Platzhalter {${name}} ist hier nicht erlaubt – erlaubt: ${allowed.map((a) => `{${a}}`).join(', ')}`,
          });
        }
      }
    });
};

export const NamingSchemeSchema = z.object({
  siteManager: templateSchema('siteManager'),
  clusterManager: templateSchema('clusterManager'),
  groupLimit: templateSchema('groupLimit'),
  wallbox: templateSchema('wallbox'),
  modbusDevice: templateSchema('modbusDevice'),
});
export type NamingScheme = z.infer<typeof NamingSchemeSchema>;

/**
 * Standard (Wunsch des Auftraggebers 2026-11-16): Jeder Name beginnt mit dem Namen seines
 * Elternbausteins, damit in den Config-Dialogen eine Suche nach dem Anfang genügt.
 * {groupNo} ist die laufende Nummer der Gruppe im Cluster (1, 2, …).
 */
export const DEFAULT_NAMING_SCHEME: NamingScheme = {
  siteManager: 'LM_Standort',
  clusterManager: 'LM_{cluster}',
  groupLimit: 'WM_{cluster}_G{groupNo}',
  wallbox: 'WB_{cluster}_G{groupNo}_{label}',
  modbusDevice: 'MB_{label}',
};

/** Standard bis Projektformat 1; die Migration auf Format 2 ersetzt unveränderte Vorlagen. */
export const NAMING_SCHEME_V1: NamingScheme = {
  siteManager: 'LM_Standort',
  clusterManager: 'LM_{cluster}',
  groupLimit: 'LIM_{cluster}_{group}',
  wallbox: 'WB_{label}',
  modbusDevice: 'MB_{label}',
};
