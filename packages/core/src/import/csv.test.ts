import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CsvParseError, parseCsv, serializeCsv, type CsvDelimiter } from './csv';

describe('parseCsv', () => {
  it('liest Semikolon-CSV mit BOM und CRLF', () => {
    expect(parseCsv('\uFEFFBezeichnung;IP\r\nLP01;192.168.1.21\r\nLP02;192.168.1.22\r\n')).toEqual({
      delimiter: ';',
      header: ['Bezeichnung', 'IP'],
      rows: [
        ['LP01', '192.168.1.21'],
        ['LP02', '192.168.1.22'],
      ],
      headerLine: 1,
    });
  });

  it.each<[string, CsvDelimiter]>([
    ['a;b;c\n1;2;3', ';'],
    ['a,b,c\n1,2,3', ','],
    ['a\tb\tc\n1\t2\t3', '\t'],
    // Komma in Anführungszeichen zählt nicht
    ['"x,y";b\n1;2', ';'],
    // nur eine Spalte → Standard Semikolon
    ['Bezeichnung\nLP01', ';'],
    // Gleichstand → Semikolon vor Tab vor Komma
    ['a;b,c\n1', ';'],
    ['a\tb,c\n1', '\t'],
  ])('erkennt das Trennzeichen: %j', (text, delimiter) => {
    expect(parseCsv(text).delimiter).toBe(delimiter);
  });

  it('versteht Anführungszeichen, verdoppelte Quotes und Zeilenumbrüche im Feld', () => {
    const csv = parseCsv('A;B\n"mit ; Semikolon";"sagt ""hallo"""\n"zwei\r\nZeilen";"x\ny"\n');
    expect(csv.rows).toEqual([
      ['mit ; Semikolon', 'sagt "hallo"'],
      ['zwei\r\nZeilen', 'x\ny'],
    ]);
  });

  it('akzeptiert LF, CRLF und CR gemischt', () => {
    expect(parseCsv('a;b\r1;2\n3;4\r\n5;6').rows).toEqual([
      ['1', '2'],
      ['3', '4'],
      ['5', '6'],
    ]);
  });

  it('behält leere Zeilen und leere Felder (für Zeilennummern)', () => {
    expect(parseCsv('a;b\n\n1;\n;\n"";x').rows).toEqual([[''], ['1', ''], ['', ''], ['', 'x']]);
  });

  it('Anführungszeichen mitten im Feld bleiben stehen (Zoll-Zeichen)', () => {
    expect(parseCsv('a;b\nKabel 5";x').rows).toEqual([['Kabel 5"', 'x']]);
  });

  it('wertet die Excel-Zeile „sep=“ aus', () => {
    const csv = parseCsv('sep=,\r\nBezeichnung;IP,Port\r\nLP01;x,502');
    expect(csv).toMatchObject({
      delimiter: ',',
      header: ['Bezeichnung;IP', 'Port'],
      headerLine: 2,
    });
    // unbekanntes Trennzeichen in sep= → normale Zeile
    expect(parseCsv('sep=|\na;b').header).toEqual(['sep=|']);
  });

  it('meldet nicht geschlossene Anführungszeichen mit Zeile', () => {
    const run = () => parseCsv('a;b\n1;2\n3;"offen\n4;5');
    expect(run).toThrow(CsvParseError);
    expect(run).toThrow('Zeile 3: Anführungszeichen wird nicht geschlossen');
    try {
      run();
    } catch (e) {
      expect((e as CsvParseError).line).toBe(3);
    }
  });

  it('meldet Text nach schließendem Anführungszeichen', () => {
    expect(() => parseCsv('a;b\n"LP"01;2')).toThrow(
      'Zeile 2: Nach dem schließenden Anführungszeichen folgt „0“',
    );
  });

  it('meldet leere Datei und leere Kopfzeile', () => {
    expect(() => parseCsv('')).toThrow('keine Kopfzeile');
    expect(() => parseCsv('\uFEFF')).toThrow('keine Kopfzeile');
    expect(() => parseCsv(';;\n1;2;3')).toThrow('keine Kopfzeile');
  });

  it('Feld in Anführungszeichen am Dateiende und Trennzeichen am Dateiende', () => {
    expect(parseCsv('a;b\n1;"2"').rows).toEqual([['1', '2']]);
    expect(parseCsv('a;b\n1;').rows).toEqual([['1', '']]);
  });
});

describe('serializeCsv', () => {
  it('setzt Anführungszeichen nur wo nötig', () => {
    expect(serializeCsv([['a', 'b;c', 'd"e', 'f\ng', '1,5']])).toBe('a;"b;c";"d""e";"f\ng";"1,5"');
    expect(serializeCsv([['a'], ['']], ',')).toBe('a\r\n""');
  });
});

describe('Property: parse(serialize(rows)) == rows', () => {
  const field = fc.string({
    unit: fc.constantFrom('a', 'Z', 'ä', ' ', ';', ',', '\t', '"', '\r', '\n', '1', '\uFEFF'),
    maxLength: 8,
  });

  it.each<CsvDelimiter>([';', ',', '\t'])('Trennzeichen %j', (delimiter) => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5 }).chain((width) =>
          fc.tuple(
            fc
              .array(field, { minLength: width, maxLength: width })
              .filter((h) => h.some((x) => x.trim() !== '')),
            // Datenzeilen so breit wie die Kopfzeile (bei nur einer Spalte ist das Trennzeichen sonst nicht erkennbar)
            fc.array(fc.array(field, { minLength: width, maxLength: width }), { maxLength: 6 }),
          ),
        ),
        ([header, rows]) => {
          const csv = parseCsv(serializeCsv([header, ...rows], delimiter));
          expect(csv.header).toEqual(header);
          expect(csv.rows).toEqual(rows);
          if (header.length > 1) expect(csv.delimiter).toBe(delimiter);
        },
      ),
    );
  });
});
