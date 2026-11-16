import { describe, expect, it } from 'vitest';
import { DEFAULT_NAMING_SCHEME, NamingSchemeSchema, extractPlaceholders } from './naming';

describe('NamingScheme', () => {
  it('Standardschema ist gültig', () =>
    expect(NamingSchemeSchema.parse(DEFAULT_NAMING_SCHEME)).toEqual(DEFAULT_NAMING_SCHEME));

  it('extrahiert Platzhalter', () => {
    expect(extractPlaceholders('LIM_{cluster}_{group}')).toEqual(['cluster', 'group']);
    expect(extractPlaceholders('LM_Standort')).toEqual([]);
    expect(extractPlaceholders('X_{}')).toEqual(['']);
  });

  it('meldet unzulässige Platzhalter mit erlaubter Auswahl', () => {
    const r = NamingSchemeSchema.safeParse({
      ...DEFAULT_NAMING_SCHEME,
      modbusDevice: 'MB_{cluster}_{label}',
    });
    expect(r.success).toBe(false);
    expect(r.error?.issues).toMatchObject([
      {
        path: ['modbusDevice'],
        message: 'Platzhalter {cluster} ist hier nicht erlaubt – erlaubt: {label}',
      },
    ]);
  });

  it('meldet Platzhalter in Vorlage ohne Platzhalter', () => {
    const r = NamingSchemeSchema.safeParse({ ...DEFAULT_NAMING_SCHEME, siteManager: 'LM_{label}' });
    expect(r.error?.issues[0]?.message).toBe(
      'Platzhalter {label} ist hier nicht erlaubt – diese Vorlage hat keine Platzhalter',
    );
  });

  it('lehnt leere und zu lange Vorlagen ab', () => {
    expect(NamingSchemeSchema.safeParse({ ...DEFAULT_NAMING_SCHEME, wallbox: ' ' }).success).toBe(
      false,
    );
    expect(
      NamingSchemeSchema.safeParse({ ...DEFAULT_NAMING_SCHEME, wallbox: 'W'.repeat(65) }).success,
    ).toBe(false);
  });
});
