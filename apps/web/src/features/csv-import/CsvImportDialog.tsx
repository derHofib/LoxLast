import {
  CsvParseError,
  IMPORT_FIELDS,
  checkMapping,
  csvTemplate,
  fieldHeader,
  formatA,
  parseCsv,
  suggestMapping,
  validateImport,
  type ColumnMapping,
  type CsvData,
  type ImportFieldKey,
  type ImportRowResult,
  type ImportValidation,
  type ModelCatalog,
} from '@lastplan/core';
import { Button, Notice, SelectField, StatusBadge, type Status } from '@lastplan/ui';
import { useEffect, useId, useMemo, useRef, useState, type DragEvent } from 'react';
import { bundledCatalog } from '../../library/catalog';
import { importChargePointsCommand } from '../../state/commands';
import { useEditorStore } from '../../state/editorStore';
import { useProjectStore } from '../../state/projectStore';
import { downloadText, readCsvFile } from './readFile';
import './csv-import.css';

export interface CsvImportDialogProps {
  open: boolean;
  onClose: () => void;
  /** Nach erfolgreichem Import, mit den IDs der neuen Ladepunkte (sind bereits ausgewählt). */
  onImported?: (ids: string[]) => void;
  /** Wallbox-Bibliothek für die Prüfung der Modell-ID; Standard: mitgelieferte Bibliothek. */
  catalog?: ModelCatalog;
}

/**
 * CSV-Import von Ladepunkten (Kap. 11.2): Datei wählen → Spalten zuordnen → Vorschau mit Prüfung
 * je Zeile → nur fehlerfreie Zeilen übernehmen (ein Undo-Schritt) oder abbrechen.
 * Die Datei wird ausschließlich lokal im Browser gelesen.
 */
export function CsvImportDialog(props: CsvImportDialogProps) {
  // Bei jedem Öffnen frisch beginnen: Zustand lebt nur, solange der Dialog offen ist.
  return props.open ? <ImportDialog {...props} /> : null;
}

type Step = 'file' | 'mapping' | 'preview';

const STEPS: { key: Step; label: string }[] = [
  { key: 'file', label: 'Datei wählen' },
  { key: 'mapping', label: 'Spalten zuordnen' },
  { key: 'preview', label: 'Vorschau und Import' },
];

const DELIMITER_NAME: Record<CsvData['delimiter'], string> = {
  ';': 'Semikolon',
  ',': 'Komma',
  '\t': 'Tabulator',
};

interface Source {
  name: string;
  encoding: string;
  csv: CsvData;
}

function ImportDialog({ onClose, onImported, catalog = bundledCatalog }: CsvImportDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const titleId = useId();
  const project = useProjectStore((s) => s.project);
  const [step, setStep] = useState<Step>('file');
  const [source, setSource] = useState<Source | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});

  // Modaler Dialog: showModal sperrt den Rest der Seite (Fokusfalle) und schließt mit Escape.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
    return () => {
      if (typeof dialog.close === 'function' && dialog.open) dialog.close();
      previous?.focus();
    };
  }, []);

  // Bei jedem Schritt Fokus auf die Überschrift, damit Screenreader den neuen Inhalt ansagen
  useEffect(() => headingRef.current?.focus(), [step]);

  const goTo = (next: Step) => setStep(next);

  const doImport = (validation: ImportValidation) => {
    if (validation.validRows.length === 0) return;
    const { command, ids } = importChargePointsCommand(validation.validRows);
    useProjectStore.getState().execute(command);
    useEditorStore.getState().select(ids);
    onImported?.(ids);
    onClose();
  };

  const stepIndex = STEPS.findIndex((s) => s.key === step);
  // Neu prüfen, wenn sich das Projekt ändert (z. B. Gruppe umbenannt), damit die Vorschau stimmt
  const validation = useMemo(
    () =>
      step === 'preview' && project && source
        ? validateImport(project, source.csv, mapping, catalog)
        : null,
    [step, project, source, mapping, catalog],
  );

  return (
    <dialog
      ref={dialogRef}
      className="csv-import"
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <header className="csv-import__header">
        <h2 id={titleId} ref={headingRef} tabIndex={-1} className="csv-import__title">
          Ladepunkte aus CSV importieren
        </h2>
        <Button variant="ghost" onClick={onClose}>
          Schließen
        </Button>
      </header>

      <ol className="csv-import__steps" aria-label="Schritte">
        {STEPS.map((s, i) => (
          <li
            key={s.key}
            className={i === stepIndex ? 'is-current' : i < stepIndex ? 'is-done' : undefined}
            aria-current={i === stepIndex ? 'step' : undefined}
          >
            <span className="csv-import__step-no">{i + 1}</span> {s.label}
          </li>
        ))}
      </ol>

      <div className="csv-import__body">
        {!project ? (
          <Notice
            kind="error"
            title="Kein Projekt geöffnet"
            solution="Projekt öffnen und den Import erneut starten."
          />
        ) : step === 'file' ? (
          <FileStep
            onLoaded={(next) => {
              setSource(next);
              setMapping(suggestMapping(next.csv.header));
              goTo('mapping');
            }}
            onCancel={onClose}
          />
        ) : step === 'mapping' && source ? (
          <MappingStep
            source={source}
            mapping={mapping}
            onChange={setMapping}
            onBack={() => goTo('file')}
            onNext={() => goTo('preview')}
            onCancel={onClose}
          />
        ) : source && validation ? (
          <PreviewStep
            source={source}
            mapping={mapping}
            validation={validation}
            onBack={() => goTo('mapping')}
            onImport={doImport}
            onCancel={onClose}
          />
        ) : null}
      </div>
    </dialog>
  );
}

// ---------------------------------------------------------------------------------------------
// Schritt 1: Datei
// ---------------------------------------------------------------------------------------------

function FileStep({ onLoaded, onCancel }: { onLoaded: (s: Source) => void; onCancel: () => void }) {
  const inputId = useId();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const load = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const { text, encoding } = await readCsvFile(file);
      const csv = parseCsv(text);
      if (csv.rows.every((r) => r.every((c) => c.trim() === ''))) {
        throw new Error('Die Datei enthält nur eine Kopfzeile, aber keine Ladepunkte.');
      }
      onLoaded({ name: file.name, encoding, csv });
    } catch (e) {
      setError(
        e instanceof CsvParseError || e instanceof Error
          ? e.message
          : 'Die Datei konnte nicht gelesen werden.',
      );
      setBusy(false);
    }
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    void load(e.dataTransfer.files[0]);
  };

  return (
    <>
      <p className="csv-import__intro">
        Eine Zeile je Ladepunkt. Gruppen müssen im Projekt bereits vorhanden sein. Die Datei bleibt
        auf Ihrem Gerät und wird nicht hochgeladen.
      </p>
      <div
        className={`csv-import__drop${dragOver ? ' is-over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        data-testid="csv-drop-zone"
      >
        <label htmlFor={inputId} className="csv-import__drop-label">
          CSV-Datei wählen
        </label>
        <input
          id={inputId}
          type="file"
          accept=".csv,.txt,text/csv,text/plain"
          disabled={busy}
          aria-describedby={`${inputId}-hint`}
          onChange={(e) => void load(e.target.files?.[0])}
        />
        <p id={`${inputId}-hint`} className="csv-import__hint">
          oder Datei hierher ziehen · Trennzeichen Semikolon, Komma oder Tabulator · UTF-8 oder
          Windows-1252
        </p>
      </div>
      {error ? (
        <Notice
          kind="error"
          title="Datei nicht lesbar"
          solution="Datei prüfen oder die Vorlage verwenden."
        >
          {error}
        </Notice>
      ) : null}
      <div className="csv-import__actions">
        <Button
          variant="text"
          onClick={() => downloadText(csvTemplate(), 'ladepunkte-vorlage.csv')}
        >
          Vorlage herunterladen
        </Button>
        <span className="csv-import__spacer" />
        <Button onClick={onCancel}>Abbrechen</Button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Schritt 2: Spalten zuordnen
// ---------------------------------------------------------------------------------------------

function MappingStep({
  source,
  mapping,
  onChange,
  onBack,
  onNext,
  onCancel,
}: {
  source: Source;
  mapping: ColumnMapping;
  onChange: (m: ColumnMapping) => void;
  onBack: () => void;
  onNext: () => void;
  onCancel: () => void;
}) {
  const { csv } = source;
  const issues = useMemo(() => checkMapping(csv.header, mapping), [csv.header, mapping]);
  const sample = csv.rows.find((r) => r.some((c) => c.trim() !== '')) ?? [];
  const dataRows = csv.rows.filter((r) => r.some((c) => c.trim() !== '')).length;
  const columnLabel = (col: number) =>
    `Spalte ${col + 1}: ${csv.header[col]?.trim() || '(ohne Titel)'}`;

  const set = (key: ImportFieldKey, value: string) => {
    const { [key]: _previous, ...rest } = mapping;
    void _previous;
    onChange(value === '' ? rest : { ...rest, [key]: Number(value) });
  };

  return (
    <>
      <p className="csv-import__intro">
        <strong>{source.name}</strong> · {dataRows} {dataRows === 1 ? 'Zeile' : 'Zeilen'} ·
        Trennzeichen {DELIMITER_NAME[csv.delimiter]} · {source.encoding}. Zuordnung wurde
        vorgeschlagen, bitte prüfen. Pflichtfelder sind mit * markiert.
      </p>
      <div className="csv-import__mapping">
        {IMPORT_FIELDS.map((field) => {
          const col = mapping[field.key];
          const example = col === undefined ? undefined : sample[col]?.trim();
          return (
            <SelectField
              key={field.key}
              label={`${fieldHeader(field)}${field.required ? ' *' : ''}`}
              hint={example ? `${field.hint} · Beispiel aus der Datei: ${example}` : field.hint}
              value={col === undefined ? '' : String(col)}
              required={field.required}
              onChange={(e) => set(field.key, e.target.value)}
            >
              <option value="">
                {field.required ? '– bitte wählen –' : '– nicht importieren –'}
              </option>
              {csv.header.map((_, i) => (
                <option key={i} value={i}>
                  {columnLabel(i)}
                </option>
              ))}
            </SelectField>
          );
        })}
      </div>
      {issues.length > 0 ? (
        <Notice kind="error" title="Zuordnung unvollständig">
          <ul className="csv-import__issues">
            {issues.map((i) => (
              <li key={i.message}>{i.message}</li>
            ))}
          </ul>
        </Notice>
      ) : null}
      <div className="csv-import__actions">
        <Button onClick={onBack}>Zurück</Button>
        <span className="csv-import__spacer" />
        <Button onClick={onCancel}>Abbrechen</Button>
        <Button variant="primary" onClick={onNext} disabled={issues.length > 0}>
          Weiter zur Vorschau
        </Button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Schritt 3: Vorschau
// ---------------------------------------------------------------------------------------------

const STATUS: Record<
  Exclude<ImportRowResult['status'], 'empty'>,
  { badge: Status; text: string }
> = {
  ok: { badge: 'active', text: 'OK' },
  warning: { badge: 'warning', text: 'Hinweis' },
  error: { badge: 'error', text: 'Fehler' },
};

function PreviewStep({
  source,
  mapping,
  validation,
  onBack,
  onImport,
  onCancel,
}: {
  source: Source;
  mapping: ColumnMapping;
  validation: ImportValidation;
  onBack: () => void;
  onImport: (v: ImportValidation) => void;
  onCancel: () => void;
}) {
  const [onlyIssues, setOnlyIssues] = useState(false);
  const filterId = useId();
  const { counts, validRows, mappingIssues } = validation;
  const { csv } = source;
  const importable = validRows.length;
  const checked = counts.ok + counts.warning + counts.error;

  const raw = (row: ImportRowResult, col: number | undefined) =>
    col === undefined ? '' : (csv.rows[row.line - csv.headerLine - 1]?.[col] ?? '').trim();

  const shown = validation.rows.filter(
    (r) => r.status !== 'empty' && (!onlyIssues || r.issues.length > 0),
  );

  return (
    <>
      {mappingIssues.length > 0 ? (
        <Notice kind="error" title="Zuordnung unvollständig" solution="Zurück zur Zuordnung.">
          {mappingIssues.map((i) => i.message).join(' · ')}
        </Notice>
      ) : null}
      <p className="csv-import__summary" role="status">
        {checked} {checked === 1 ? 'Zeile' : 'Zeilen'} geprüft:{' '}
        <strong>{importable} fehlerfrei</strong>
        {counts.warning > 0 ? ` (davon ${counts.warning} mit Hinweis)` : ''}
        {', '}
        <strong>{counts.error} mit Fehlern</strong> – werden nicht importiert.
        {counts.empty > 0
          ? ` ${counts.empty} ${counts.empty === 1 ? 'Leerzeile' : 'Leerzeilen'} übersprungen.`
          : ''}
      </p>
      <div className="csv-import__filter">
        <input
          id={filterId}
          type="checkbox"
          checked={onlyIssues}
          onChange={(e) => setOnlyIssues(e.target.checked)}
        />
        <label htmlFor={filterId}>Nur Zeilen mit Meldungen anzeigen</label>
      </div>
      <div className="csv-import__table-wrap" tabIndex={0} role="region" aria-label="Vorschau">
        <table className="csv-import__table">
          <thead>
            <tr>
              <th scope="col">Zeile</th>
              <th scope="col">Status</th>
              <th scope="col">Bezeichnung</th>
              <th scope="col">Gruppe</th>
              <th scope="col">Modell-ID</th>
              <th scope="col">IP-Adresse</th>
              <th scope="col">Strom</th>
              <th scope="col">Phasen</th>
              <th scope="col">Meldungen</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => {
              const cp = row.chargePoint;
              const status = STATUS[row.status as keyof typeof STATUS];
              return (
                <tr key={row.line} className={`is-${row.status}`} data-testid="preview-row">
                  <td className="num">{row.line}</td>
                  <td>
                    <StatusBadge status={status.badge}>{status.text}</StatusBadge>
                  </td>
                  <td>{cp ? cp.label : raw(row, mapping.label)}</td>
                  <td>{row.groupPath ?? raw(row, mapping.group)}</td>
                  <td>{cp?.libraryModelId ?? ''}</td>
                  <td className="num">
                    {cp
                      ? `${cp.network.ip}:${cp.network.port}${cp.network.unitId !== undefined ? ` · ID ${cp.network.unitId}` : ''}`
                      : raw(row, mapping.ip)}
                  </td>
                  <td className="num">
                    {cp
                      ? `${formatA(cp.minA)} – ${formatA(cp.maxA)} (Abs. ${formatA(cp.fuseA)})`
                      : ''}
                  </td>
                  <td>{cp ? `${cp.phases}-ph. · ${cp.phaseRotation}` : ''}</td>
                  <td>
                    {row.issues.length > 0 ? (
                      <ul className="csv-import__issues">
                        {row.issues.map((i) => (
                          <li key={i.message} className={`is-${i.severity}`}>
                            {i.severity === 'error' ? 'Fehler: ' : 'Hinweis: '}
                            {i.message}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="csv-import__actions">
        <Button onClick={onBack}>Zurück zur Zuordnung</Button>
        <span className="csv-import__spacer" />
        <Button onClick={onCancel}>Abbrechen</Button>
        <Button variant="primary" disabled={importable === 0} onClick={() => onImport(validation)}>
          {importable === 1
            ? '1 fehlerfreie Zeile importieren'
            : `${importable} fehlerfreie Zeilen importieren`}
        </Button>
      </div>
    </>
  );
}
