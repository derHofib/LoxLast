/**
 * CSV lesen und schreiben nach RFC 4180, mit den Eigenheiten deutscher Tabellenkalkulationen:
 * Semikolon als Standard-Trennzeichen, UTF-8 mit BOM, optionale Excel-Zeile „sep=;“.
 *
 * Bewusst ohne Bibliothek: Der Funktionsumfang ist klein, und Fehlermeldungen sollen deutsch
 * und mit Zeilennummer sein.
 */

export type CsvDelimiter = ';' | ',' | '\t';

/** Reihenfolge = Vorrang bei Gleichstand (Semikolon ist im deutschen Excel Standard). */
export const CSV_DELIMITERS: readonly CsvDelimiter[] = [';', '\t', ','];

export interface CsvData {
  delimiter: CsvDelimiter;
  header: string[];
  /** Datenzeilen ohne Kopfzeile. Leere Zeilen bleiben erhalten, damit Zeilennummern stimmen. */
  rows: string[][];
  /**
   * Nummer der Kopfzeile, wie sie in der Tabellenkalkulation erscheint (1, bzw. 2 nach „sep=;“).
   * Datenzeile i hat die Nummer headerLine + 1 + i.
   */
  headerLine: number;
}

export class CsvParseError extends Error {
  constructor(
    message: string,
    /** Zeile (Datensatz) in der Datei, ab 1. */
    readonly line: number,
  ) {
    super(message);
    this.name = 'CsvParseError';
  }
}

const BOM = '\uFEFF';

/** Zählt Trennzeichen außerhalb von Anführungszeichen in der ersten Zeile. */
function detectDelimiter(text: string): CsvDelimiter {
  const counts = new Map<CsvDelimiter, number>(CSV_DELIMITERS.map((d) => [d, 0]));
  let quoted = false;
  for (const ch of text) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === '\n' || ch === '\r')) break;
    else if (!quoted && counts.has(ch as CsvDelimiter))
      counts.set(ch as CsvDelimiter, (counts.get(ch as CsvDelimiter) ?? 0) + 1);
  }
  let best: CsvDelimiter = ';';
  let bestCount = 0;
  for (const d of CSV_DELIMITERS) {
    const n = counts.get(d) ?? 0;
    if (n > bestCount) {
      best = d;
      bestCount = n;
    }
  }
  return best;
}

/** Liest alle Datensätze. Ein abschließender Zeilenumbruch erzeugt keinen leeren Datensatz. */
function parseRecords(text: string, delimiter: CsvDelimiter, firstLine: number): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let i = 0;
  const line = () => firstLine + records.length;

  const endRecord = () => {
    record.push(field);
    records.push(record);
    record = [];
    field = '';
  };

  while (i < text.length) {
    const ch = text[i];
    if (ch === '"' && field === '') {
      // Feld in Anführungszeichen: läuft bis zum schließenden Anführungszeichen, auch über Zeilen
      const start = line();
      i++;
      for (;;) {
        if (i >= text.length) {
          throw new CsvParseError(
            `Zeile ${start}: Anführungszeichen wird nicht geschlossen. Prüfen Sie, ob in einem Feld ein einzelnes " steht.`,
            start,
          );
        }
        const c = text[i];
        if (c === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i += 2;
            continue;
          }
          i++;
          break;
        }
        field += c;
        i++;
      }
      const next = text[i];
      if (next !== undefined && next !== delimiter && next !== '\r' && next !== '\n') {
        throw new CsvParseError(
          `Zeile ${start}: Nach dem schließenden Anführungszeichen folgt „${next}“ statt eines Trennzeichens. Anführungszeichen innerhalb eines Feldes müssen verdoppelt werden ("").`,
          start,
        );
      }
      // Markiert das Feld als bereits begonnen (auch wenn leer: "")
      if (next === undefined) {
        endRecord();
        return records;
      }
      continue;
    }
    if (ch === delimiter) {
      record.push(field);
      field = '';
      i++;
      if (i === text.length) {
        // Trennzeichen am Dateiende: letztes Feld ist leer
        endRecord();
        return records;
      }
      continue;
    }
    if (ch === '\r' || ch === '\n') {
      endRecord();
      i += ch === '\r' && text[i + 1] === '\n' ? 2 : 1;
      continue;
    }
    field += ch;
    i++;
    if (i === text.length) endRecord();
  }
  return records;
}

/**
 * Liest eine CSV-Datei. Trennzeichen (; , Tab) wird aus der Kopfzeile erkannt.
 * Wirft `CsvParseError` bei kaputten Anführungszeichen oder leerer Datei.
 */
export function parseCsv(input: string): CsvData {
  let text = input.startsWith(BOM) ? input.slice(BOM.length) : input;
  let delimiter: CsvDelimiter | undefined;
  let firstLine = 1;
  // Excel-Erweiterung: erste Zeile „sep=;“ legt das Trennzeichen fest
  const sep = /^sep=(.)(\r\n|\n|\r|$)/i.exec(text);
  if (sep && CSV_DELIMITERS.includes(sep[1] as CsvDelimiter)) {
    delimiter = sep[1] as CsvDelimiter;
    text = text.slice(sep[0].length);
    firstLine = 2;
  }
  delimiter ??= detectDelimiter(text);
  const [header, ...rows] = parseRecords(text, delimiter, firstLine);
  if (!header || header.every((h) => h.trim() === '')) {
    throw new CsvParseError('Die Datei enthält keine Kopfzeile.', firstLine);
  }
  return { delimiter, header, rows, headerLine: firstLine };
}

const NEEDS_QUOTES = /[;,\t"\r\n]|^\uFEFF/;

function quote(field: string): string {
  return NEEDS_QUOTES.test(field) ? `"${field.replaceAll('"', '""')}"` : field;
}

/** Schreibt Datensätze als CSV (CRLF, ohne BOM). Gegenstück zu `parseCsv`. */
export function serializeCsv(
  records: readonly (readonly string[])[],
  delimiter: CsvDelimiter = ';',
): string {
  return records
    .map((record) =>
      // Ein Datensatz aus genau einem leeren Feld muss sichtbar bleiben, sonst wäre er eine Leerzeile
      record.length === 1 && record[0] === '' ? '""' : record.map(quote).join(delimiter),
    )
    .join('\r\n');
}
