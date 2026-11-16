import { formatA } from '../calc/units';
import { addChargePoint, usedIps, type NewChargePointInput } from '../edit/operations';
import { newId } from '../ids';
import {
  CP_DATA_FIELDS,
  CP_DATA_FIELD_LABEL,
  IEC_MIN_CHARGING_CURRENT_A,
  LibraryModelIdSchema,
  MAX_PLAUSIBLE_CURRENT_A,
  type ChargePoint,
  type Cluster,
  type Group,
  type Project,
} from '../model';
import type { ModelCatalog } from '../validation/types';
import type { CsvData } from './csv';
import { IMPORT_FIELDS, importField, type ColumnMapping, type ImportFieldKey } from './fields';
import {
  parseBoolean,
  parseDecimal,
  parseInteger,
  parseIpv4,
  parsePhaseRotation,
  parsePhases,
  parseProtocol,
} from './values';

/**
 * Validierung und Übernahme des CSV-Imports (Kap. 11.2).
 *
 * Grundsatz: Eine Zeile wird nur übernommen, wenn sie eindeutig und fachlich gültig ist. Nichts
 * wird von anderen Ladepunkten übernommen. Fehlende elektrische Angaben (CP_DATA_FIELDS) bekommen
 * neutrale Platzhalter und werden am Ladepunkt als fehlend vermerkt; die Prüfung meldet sie
 * (CP_DATA_MISSING) und sperrt den Export, bis sie nachgetragen sind.
 */

export type ImportSeverity = 'error' | 'warning';

export interface ImportIssue {
  severity: ImportSeverity;
  /** Deutsch, mit Zeile und Spalte, z. B. „Zeile 4, Spalte ‚IP‘: … ist keine gültige IPv4-Adresse“. */
  message: string;
  field?: ImportFieldKey;
}

/** Werte eines Ladepunkts ohne ID – die ID vergibt erst `applyImport`. */
export type ImportedChargePoint = Omit<ChargePoint, 'id'>;

/** ok = importierbar · warning = importierbar mit Hinweis · error = wird nicht importiert · empty = Leerzeile */
export type ImportRowStatus = 'ok' | 'warning' | 'error' | 'empty';

export interface ImportRowResult {
  /** Zeilennummer wie in der Tabellenkalkulation (Kopfzeile = 1). */
  line: number;
  status: ImportRowStatus;
  issues: ImportIssue[];
  /** Nur bei ok/warning: Werte, die übernommen werden. */
  chargePoint?: ImportedChargePoint;
  /** Anzeige der Zielgruppe, z. B. „UV-TG1 › Mieter“. */
  groupPath?: string;
}

export interface ValidImportRow {
  line: number;
  chargePoint: ImportedChargePoint;
}

export interface ImportValidation {
  /** Fehler in der Zuordnung selbst; solange einer davon besteht, wird keine Zeile geprüft. */
  mappingIssues: ImportIssue[];
  rows: ImportRowResult[];
  /** Fehlerfreie Zeilen (auch mit Hinweis) in Dateireihenfolge. */
  validRows: ValidImportRow[];
  counts: Record<ImportRowStatus, number>;
}

const norm = (s: string) => s.trim().toLocaleLowerCase('de-DE');

/** Prüft die Spaltenzuordnung: Pflichtfelder zugeordnet, Spalten vorhanden, keine Doppelbelegung. */
export function checkMapping(header: readonly string[], mapping: ColumnMapping): ImportIssue[] {
  const issues: ImportIssue[] = [];
  const byColumn = new Map<number, ImportFieldKey[]>();
  for (const field of IMPORT_FIELDS) {
    const col = mapping[field.key];
    if (col === undefined) {
      if (field.required) {
        issues.push({
          severity: 'error',
          field: field.key,
          message: `Pflichtfeld ${field.label} ist keiner Spalte zugeordnet`,
        });
      }
      continue;
    }
    if (!Number.isInteger(col) || col < 0 || col >= header.length) {
      issues.push({
        severity: 'error',
        field: field.key,
        message: `${field.label}: Spalte ${col + 1} gibt es in der Datei nicht`,
      });
      continue;
    }
    byColumn.set(col, [...(byColumn.get(col) ?? []), field.key]);
  }
  for (const [col, keys] of byColumn) {
    if (keys.length < 2) continue;
    issues.push({
      severity: 'error',
      field: keys[1] as ImportFieldKey,
      message: `Spalte ‚${columnName(header, col)}‘ ist mehreren Feldern zugeordnet (${keys
        .map((k) => importField(k).label)
        .join(', ')}). Jede Spalte darf nur einem Feld zugeordnet sein.`,
    });
  }
  return issues;
}

function columnName(header: readonly string[], col: number): string {
  return header[col]?.trim() || `Spalte ${col + 1}`;
}

// ---------------------------------------------------------------------------------------------
// Gruppen auflösen: „Mieter“, „UV-TG1 › Mieter“ oder voller Pfad bei verschachtelten Clustern
// ---------------------------------------------------------------------------------------------

const pathKey = (s: string) =>
  norm(s)
    .replace(/\s*[›>]\s*/g, '›')
    .replace(/\s+/g, ' ');

interface GroupEntry {
  group: Group;
  path: string;
  keys: Set<string>;
}

function clusterChain(project: Project, cluster: Cluster): Cluster[] {
  const chain: Cluster[] = [];
  let current: Cluster | undefined = cluster;
  while (current && !chain.includes(current)) {
    chain.unshift(current);
    const parentId: string | undefined = current.parentClusterId;
    current = parentId === undefined ? undefined : project.clusters.find((c) => c.id === parentId);
  }
  return chain;
}

function groupIndex(project: Project): GroupEntry[] {
  return project.groups.map((group) => {
    const cluster = project.clusters.find((c) => c.id === group.clusterId);
    const chain = cluster ? clusterChain(project, cluster).map((c) => c.name) : [];
    const path = [...chain, group.name].join(' › ');
    const short = cluster ? `${cluster.name} › ${group.name}` : group.name;
    return { group, path, keys: new Set([group.name, short, path].map(pathKey)) };
  });
}

type GroupResolution = { entry: GroupEntry } | { error: string };

function resolveGroup(entries: readonly GroupEntry[], text: string): GroupResolution {
  const key = pathKey(text);
  const matches = entries.filter((e) => e.keys.has(key));
  const [first] = matches;
  if (first && matches.length === 1) return { entry: first };
  if (matches.length > 1) {
    return {
      error: `Gruppe „${text}“ ist nicht eindeutig (${matches.map((m) => m.path).join(', ')}). Bitte als „Cluster › Gruppe“ angeben.`,
    };
  }
  if (entries.length === 0) {
    return {
      error: `Gruppe „${text}“ gibt es nicht – das Projekt hat noch keine Gruppen. Bitte zuerst in der Struktur-Ansicht anlegen.`,
    };
  }
  const known = entries.slice(0, 5).map((e) => e.path);
  const more = entries.length > known.length ? ', …' : '';
  return {
    error: `Gruppe „${text}“ gibt es im Projekt nicht (vorhanden: ${known.join(', ')}${more}). Bitte Namen korrigieren oder die Gruppe zuerst in der Struktur-Ansicht anlegen.`,
  };
}

// ---------------------------------------------------------------------------------------------
// Validierung
// ---------------------------------------------------------------------------------------------

const lineList = (lines: readonly number[]) => lines.join(', ');

/**
 * Prüft jede Datenzeile und berechnet die zu übernehmenden Werte.
 * Rein: verändert weder `project` noch `csv`.
 */
export function validateImport(
  project: Project,
  csv: CsvData,
  mapping: ColumnMapping,
  catalog: ModelCatalog,
): ImportValidation {
  const counts: Record<ImportRowStatus, number> = { ok: 0, warning: 0, error: 0, empty: 0 };
  const mappingIssues = checkMapping(csv.header, mapping);
  if (mappingIssues.length > 0) return { mappingIssues, rows: [], validRows: [], counts };

  const lineOf = (index: number) => csv.headerLine + 1 + index;
  const cellText = (row: readonly string[], key: ImportFieldKey): string => {
    const col = mapping[key];
    return col === undefined ? '' : (row[col] ?? '').trim();
  };
  const isEmpty = (row: readonly string[]) => row.every((c) => c.trim() === '');

  // Vorlauf: Dubletten innerhalb der Datei. Beide Zeilen gelten als fehlerhaft – welche gemeint
  // ist, kann nur der Nutzer entscheiden.
  const ipLines = new Map<string, number[]>();
  const labelLines = new Map<string, number[]>();
  csv.rows.forEach((row, i) => {
    if (isEmpty(row)) return;
    const ip = parseIpv4(cellText(row, 'ip'));
    if (ip !== undefined) ipLines.set(ip, [...(ipLines.get(ip) ?? []), lineOf(i)]);
    const label = norm(cellText(row, 'label'));
    if (label !== '') labelLines.set(label, [...(labelLines.get(label) ?? []), lineOf(i)]);
  });

  const takenIps = usedIps(project);
  const groups = groupIndex(project);
  // Arbeitskopie: nimmt die gültigen Zeilen nacheinander auf (für Bezeichnungen und IPs).
  const sim: Project = { ...project, chargePoints: [...project.chargePoints] };

  const rows = csv.rows.map((row, index): ImportRowResult => {
    const line = lineOf(index);
    if (isEmpty(row)) return { line, status: 'empty', issues: [] };

    const issues: ImportIssue[] = [];
    const given = new Set<ImportFieldKey>();
    const prefix = (key: ImportFieldKey | undefined) => {
      const col = key === undefined ? undefined : mapping[key];
      return col === undefined
        ? `Zeile ${line}: `
        : `Zeile ${line}, Spalte ‚${columnName(csv.header, col)}‘: `;
    };
    const report = (severity: ImportSeverity, key: ImportFieldKey | undefined, text: string) =>
      issues.push({
        severity,
        message: prefix(key) + text,
        ...(key !== undefined ? { field: key } : {}),
      });

    /** Liest ein Feld. Leer → undefined (bei Pflichtfeld mit Fehler), unlesbar → Fehler. */
    function read<T>(
      key: ImportFieldKey,
      parse: (text: string) => T | undefined,
      invalid: (text: string) => string,
    ): T | undefined {
      const text = cellText(row, key);
      if (text === '') {
        if (importField(key).required)
          report('error', key, `Pflichtfeld ${importField(key).label} ist leer`);
        return undefined;
      }
      const value = parse(text);
      if (value === undefined) report('error', key, invalid(text));
      else given.add(key);
      return value;
    }

    const current = (key: 'minA' | 'maxA' | 'fuseA', positive: boolean) =>
      read(
        key,
        (t) => {
          const n = parseDecimal(t, 'A');
          if (n === undefined) return undefined;
          const ok = (positive ? n > 0 : n >= 0) && n <= MAX_PLAUSIBLE_CURRENT_A;
          return ok ? n : undefined;
        },
        (t) =>
          parseDecimal(t, 'A') === undefined
            ? `„${t}“ ist keine Zahl (Beispiel: 16 oder 16,5 A)`
            : `${t} liegt außerhalb des zulässigen Bereichs (${positive ? 'größer 0' : '0'} bis ${formatA(MAX_PLAUSIBLE_CURRENT_A)})`,
      );

    const label = read(
      'label',
      (t) => (t.length <= 200 ? t : undefined),
      () => 'Bezeichnung ist zu lang (max. 200 Zeichen)',
    );
    const groupText = read('group', (t) => t, String);
    const modelText = read(
      'libraryModelId',
      (t) => (LibraryModelIdSchema.safeParse(t).success ? t : undefined),
      (t) => `„${t}“ ist keine Modell-ID (Form: hersteller/modell@version)`,
    );
    const ip = read('ip', parseIpv4, (t) => `${t} ist keine gültige IPv4-Adresse`);
    const port = read(
      'port',
      (t) => {
        const n = parseInteger(t);
        return n !== undefined && n >= 1 && n <= 65535 ? n : undefined;
      },
      (t) => `„${t}“ ist kein gültiger Port (ganze Zahl 1–65535)`,
    );
    const unitId = read(
      'unitId',
      (t) => {
        const n = parseInteger(t);
        return n !== undefined && n >= 0 && n <= 247 ? n : undefined;
      },
      (t) => `„${t}“ ist keine gültige Unit-ID (ganze Zahl 0–247)`,
    );
    const minA = current('minA', false);
    const maxA = current('maxA', false);
    const fuseA = current('fuseA', true);
    const phases = read(
      'phases',
      parsePhases,
      (t) => `„${t}“: Anschluss muss 1 oder 3 Phasen haben`,
    );
    const phaseRotation = read(
      'phaseRotation',
      parsePhaseRotation,
      (t) => `„${t}“ ist keine gültige Phasenlage (erlaubt: L1-L2-L3, L2-L3-L1, L3-L1-L2)`,
    );
    const phaseSwitching = read(
      'phaseSwitching',
      parseBoolean,
      (t) => `„${t}“ ist kein Ja/Nein-Wert (erlaubt: ja, nein)`,
    );
    const protocol = read(
      'protocol',
      parseProtocol,
      (t) => `„${t}“ ist kein bekanntes Protokoll (erlaubt: modbus-tcp, http, ocpp-bridge)`,
    );
    const text = (key: 'room' | 'category' | 'notes', max: number) =>
      read(
        key,
        (t) => (t.length <= max ? t : undefined),
        () => `Text ist zu lang (max. ${max} Zeichen)`,
      );
    const room = text('room', 200);
    const category = text('category', 200);
    const notes = text('notes', 5000);

    // Eindeutigkeit
    if (label !== undefined) {
      const lines = labelLines.get(norm(label)) ?? [];
      if (lines.length > 1)
        report(
          'error',
          'label',
          `Bezeichnung „${label}“ kommt in der Datei mehrfach vor (Zeilen ${lineList(lines)})`,
        );
      const existing = project.chargePoints.find((cp) => norm(cp.label) === norm(label));
      if (existing)
        report('error', 'label', `Bezeichnung „${label}“ ist im Projekt bereits vergeben`);
    }
    if (ip !== undefined) {
      const lines = ipLines.get(ip) ?? [];
      if (lines.length > 1)
        report('error', 'ip', `${ip} kommt in der Datei mehrfach vor (Zeilen ${lineList(lines)})`);
      if (takenIps.has(ip)) {
        const owner = project.chargePoints.find((cp) => cp.network.ip === ip);
        report(
          'error',
          'ip',
          `${ip} ist im Projekt bereits vergeben (${owner ? owner.label : 'Zähler'})`,
        );
      }
    }

    let groupEntry: GroupEntry | undefined;
    if (groupText !== undefined) {
      const resolved = resolveGroup(groups, groupText);
      if ('error' in resolved) report('error', 'group', resolved.error);
      else groupEntry = resolved.entry;
    }

    const hasError = () => issues.some((i) => i.severity === 'error');
    if (hasError() || label === undefined || ip === undefined || groupEntry === undefined) {
      return { line, status: 'error', issues };
    }

    // Neutrale Platzhalter aus addChargePoint, ohne Vorlage eines anderen Ladepunkts
    const input: NewChargePointInput = {
      id: '',
      groupId: groupEntry.group.id,
      label,
      ...(modelText !== undefined ? { libraryModelId: modelText } : {}),
      ...(protocol !== undefined ? { protocol } : {}),
      ...(fuseA !== undefined ? { fuseA } : {}),
      ...(minA !== undefined ? { minA } : {}),
      ...(maxA !== undefined ? { maxA } : {}),
      ...(phases !== undefined ? { phases } : {}),
      ...(phaseRotation !== undefined ? { phaseRotation } : {}),
      ...(phaseSwitching !== undefined ? { phaseSwitching } : {}),
      ...(room !== undefined ? { room } : {}),
      ...(category !== undefined ? { category } : {}),
      ...(notes !== undefined ? { notes } : {}),
    };
    const cp = addChargePoint({ ...sim, chargePoints: [] }, input);
    sim.chargePoints.push(cp);
    cp.network.ip = ip;
    const missing = CP_DATA_FIELDS.filter((f) => !given.has(f));
    // Platzhalter passend zu bekannten Modellgrenzen wählen, damit sie keine Folgefehler erzeugen
    const known = catalog.get(cp.libraryModelId)?.electrical;
    if (known) {
      if (!given.has('minA') && known.minA !== null) cp.minA = Math.max(cp.minA, known.minA);
      if (!given.has('maxA') && known.maxA !== null) cp.maxA = known.maxA;
      if (!given.has('fuseA') && cp.fuseA < cp.maxA) cp.fuseA = cp.maxA;
      if (
        !given.has('phases') &&
        known.phases !== null &&
        known.phases.length > 0 &&
        !known.phases.includes(cp.phases)
      )
        cp.phases = known.phases[0] ?? cp.phases;
    }
    if (missing.length > 0) {
      cp.missingFields = missing;
      report(
        'warning',
        undefined,
        `Fehlt in der Datei: ${missing.map((f) => CP_DATA_FIELD_LABEL[f]).join(', ')} – wird als Platzhalter übernommen und am Ladepunkt als fehlend markiert (Export gesperrt, bis nachgetragen)`,
      );
    }
    if (port !== undefined) cp.network.port = port;
    if (unitId !== undefined) cp.network.unitId = unitId;

    // Fachliche Prüfung der endgültigen Werte
    const origin = (key: ImportFieldKey) =>
      given.has(key) ? '' : ' (Platzhalter, in der Datei leer)';
    if (cp.minA < IEC_MIN_CHARGING_CURRENT_A) {
      report(
        'error',
        'minA',
        `Min. Strom ${formatA(cp.minA)}${origin('minA')} liegt unter ${formatA(IEC_MIN_CHARGING_CURRENT_A)} (IEC 61851)`,
      );
    }
    if (cp.minA > cp.maxA) {
      report(
        'error',
        given.has('minA') ? 'minA' : 'maxA',
        `Min. Strom ${formatA(cp.minA)}${origin('minA')} ist größer als Max. Strom ${formatA(cp.maxA)}${origin('maxA')}`,
      );
    }
    if (cp.maxA > cp.fuseA) {
      report(
        'error',
        given.has('maxA') ? 'maxA' : 'fuseA',
        `Max. Strom ${formatA(cp.maxA)}${origin('maxA')} ist größer als die Absicherung ${formatA(cp.fuseA)}${origin('fuseA')}`,
      );
    }

    if (cp.libraryModelId === '') {
      report(
        'error',
        'libraryModelId',
        'Modell-ID fehlt. Ohne Modell lassen sich Register und Grenzen nicht zuordnen.',
      );
    } else {
      const model = catalog.get(cp.libraryModelId);
      if (!model) {
        report(
          'error',
          'libraryModelId',
          `Modell-ID „${cp.libraryModelId}“ ist in der Wallbox-Bibliothek nicht bekannt`,
        );
      } else {
        if (!model.complete) {
          const n = model.missingFields.length;
          report(
            'warning',
            'libraryModelId',
            `Modell ${model.displayName} ist in der Bibliothek unvollständig (${n === 1 ? '1 Angabe fehlt' : `${n} Angaben fehlen`}) – Import möglich, Export erst nach Ergänzung`,
          );
        }
        const el = model.electrical;
        if (el.maxA !== null && cp.maxA > el.maxA) {
          report(
            'error',
            'maxA',
            `Max. Strom ${formatA(cp.maxA)}${origin('maxA')} über dem Höchststrom von ${model.displayName} (${formatA(el.maxA)})`,
          );
        }
        // unter 6 A ist oben schon gemeldet
        if (el.minA !== null && cp.minA < el.minA && cp.minA >= IEC_MIN_CHARGING_CURRENT_A) {
          report(
            'error',
            'minA',
            `Min. Strom ${formatA(cp.minA)}${origin('minA')} unter dem Mindeststrom von ${model.displayName} (${formatA(el.minA)})`,
          );
        }
        if (el.phases !== null && !el.phases.includes(cp.phases)) {
          report(
            'error',
            'phases',
            `${model.displayName} unterstützt keinen ${cp.phases}-phasigen Anschluss`,
          );
        }
        if (cp.phaseSwitching && el.phaseSwitching === false) {
          report(
            'error',
            'phaseSwitching',
            `Phasenumschaltung aktiv, ${model.displayName} unterstützt sie nicht`,
          );
        }
      }
    }

    if (hasError()) {
      sim.chargePoints.pop();
      return { line, status: 'error', issues, groupPath: groupEntry.path };
    }
    const { id, ...chargePoint } = cp;
    void id;
    return {
      line,
      status: issues.length > 0 ? 'warning' : 'ok',
      issues,
      chargePoint,
      groupPath: groupEntry.path,
    };
  });

  const validRows: ValidImportRow[] = [];
  for (const r of rows) {
    counts[r.status]++;
    if (r.chargePoint) validRows.push({ line: r.line, chargePoint: r.chargePoint });
  }
  return { mappingIssues, rows, validRows, counts };
}

// ---------------------------------------------------------------------------------------------
// Übernahme
// ---------------------------------------------------------------------------------------------

/**
 * Übernimmt die geprüften Zeilen ins Projekt (mutierend, für ein Immer-Rezept = ein Undo-Schritt).
 * Übernimmt genau die Werte der Vorschau. Liefert die IDs der neuen Ladepunkte.
 */
export function applyImport(
  draft: Project,
  rows: readonly ValidImportRow[],
  idFactory: () => string = newId,
): string[] {
  return rows.map(({ chargePoint }) => {
    const id = idFactory();
    draft.chargePoints.push({
      ...chargePoint,
      id,
      network: { ...chargePoint.network },
      ...(chargePoint.missingFields ? { missingFields: [...chargePoint.missingFields] } : {}),
    });
    return id;
  });
}
