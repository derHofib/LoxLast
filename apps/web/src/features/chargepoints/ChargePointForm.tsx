import type { ChargePoint, ChargePointDataField, ChargePointPatch, Project } from '@lastplan/core';
import { CP_DATA_FIELDS, suggestNextIp } from '@lastplan/core';
import {
  Button,
  NumberField,
  Notice,
  PropertyAdvanced,
  PropertyGroup,
  PropertyPanel,
  SelectField,
  TextField,
} from '@lastplan/ui';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { DeviceTestButton } from '../../gateway/DeviceTest';
import { confirmChargePointFieldsCommand, updateChargePointsCommand } from '../../state/commands';
import { useProjectStore } from '../../state/projectStore';
import {
  ADVANCED_FIELDS,
  COMMON_FIELDS,
  FIELD_LABEL,
  UNIQUE_FIELDS,
  commonValue,
  groupPath,
  parseField,
  softWarnings,
  type FieldKey,
} from './form';
import { modelDefaults, modelDisplayName, type LibraryIndex } from './libraryInfo';

export interface ChargePointFormProps {
  project: Project;
  /** Ausgewählte Ladepunkte (mindestens einer). */
  cps: readonly ChargePoint[];
  index: LibraryIndex;
  /** Springt zum nächsten Ladepunkt; false, wenn es keinen gibt. */
  onNext: () => boolean;
  /** Erhöht sich, wenn die IP-Adresse fokussiert werden soll (neuer Ladepunkt). */
  focusNonce: number;
}

const MIXED = 'verschieden';

/**
 * Eigenschaften-Formular (Kap. 11.2 und 10.2). Textfelder werden beim Verlassen übernommen,
 * Auswahlfelder sofort. Jede Übernahme ist EIN Undo-Schritt für alle ausgewählten Ladepunkte.
 * Ungültige Eingaben bleiben im Feld stehen und zeigen die Meldung am Feld.
 */
export function ChargePointForm({ project, cps, index, onNext, focusNonce }: ChargePointFormProps) {
  const execute = useProjectStore((s) => s.execute);
  const [filter, setFilter] = useState('');
  const [drafts, setDrafts] = useState<Partial<Record<FieldKey, string>>>({});
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [notice, setNotice] = useState<string>('');
  const [vendor, setVendor] = useState<string | undefined>(undefined);
  const root = useRef<HTMLDivElement>(null);

  const multi = cps.length > 1;
  const ids = cps.map((c) => c.id);
  const first = cps[0];
  const warnings = softWarnings(project, cps);

  useEffect(() => {
    if (focusNonce > 0) root.current?.querySelector<HTMLInputElement>('input[name="ip"]')?.focus();
  }, [focusNonce]);

  if (!first) return null;

  const modelCommon = commonValue(cps, 'libraryModelId');
  const currentVendor = modelCommon.mixed
    ? ''
    : (index.get(modelCommon.value)?.model?.vendor ?? '');
  const vendorValue = vendor ?? currentVendor;
  const vendorMixed = vendor === undefined && modelCommon.mixed;
  const vendors = [...new Set(index.models.flatMap((m) => (m.model ? [m.model.vendor] : [])))];

  const apply = (patch: ChargePointPatch) => execute(updateChargePointsCommand(ids, patch));

  const clearDraft = (key: FieldKey) => {
    const without = <T,>(o: Partial<Record<FieldKey, T>>) =>
      Object.fromEntries(Object.entries(o).filter(([k]) => k !== key)) as Partial<
        Record<FieldKey, T>
      >;
    setDrafts(without);
    setErrors(without);
  };

  /** Übernimmt einen Wert; liefert false bei ungültiger Eingabe (Meldung steht am Feld). */
  const commit = (key: Exclude<FieldKey, 'vendor'>, raw: string): boolean => {
    const common = commonValue(cps, key);
    if (common.mixed && raw === '' && key !== 'room' && key !== 'category' && key !== 'notes') {
      clearDraft(key);
      return true;
    }
    if (!common.mixed && raw === common.value) {
      clearDraft(key);
      return true;
    }
    const taken = project.chargePoints.filter((c) => !ids.includes(c.id)).map((c) => c.label);
    const result = parseField(key, raw, taken);
    if (!result.ok) {
      setErrors((e) => ({ ...e, [key]: result.error }));
      return false;
    }
    let patch = result.patch;
    if (key === 'libraryModelId') {
      const defaults = modelDefaults(index.get(raw));
      const network: NonNullable<ChargePointPatch['network']> = {};
      if (defaults.port !== undefined) network.port = defaults.port;
      if (defaults.unitId !== undefined) network.unitId = defaults.unitId;
      patch = {
        ...patch,
        ...(defaults.minA !== undefined ? { minA: defaults.minA } : {}),
        ...(defaults.maxA !== undefined ? { maxA: defaults.maxA } : {}),
        ...(Object.keys(network).length > 0 ? { network } : {}),
      };
      const set = [
        defaults.port !== undefined ? `Port ${defaults.port}` : '',
        defaults.unitId !== undefined ? `Unit-ID ${defaults.unitId}` : '',
        defaults.minA !== undefined ? `Mindeststrom ${defaults.minA} A` : '',
        defaults.maxA !== undefined ? `Maximalstrom ${defaults.maxA} A` : '',
      ].filter(Boolean);
      const name = modelDisplayName(index, raw);
      setNotice(
        !index.get(raw)
          ? `${name} steht nicht in der Bibliothek, es wurden keine Standardwerte gesetzt.`
          : set.length === 0
            ? `${name}: Die Bibliothek enthält noch keine Standardwerte (TODO). Port, Unit-ID und Strom bleiben unverändert.`
            : `Standardwerte aus der Bibliothek übernommen: ${set.join(', ')}.` +
              (defaults.missing.length > 0
                ? ` Nicht in der Bibliothek (TODO) und unverändert: ${defaults.missing.join(', ')}.`
                : ''),
      );
    }
    apply(patch);
    clearDraft(key);
    return true;
  };

  /** „Speichern & nächster LP“: offene Eingaben übernehmen, dann weiter. */
  const saveAndNext = () => {
    for (const key of Object.keys(drafts) as FieldKey[]) {
      if (key === 'vendor') continue;
      const raw = drafts[key];
      if (raw === undefined) continue;
      if (!commit(key, raw)) {
        root.current?.querySelector<HTMLElement>(`[name="${key}"]`)?.focus();
        setNotice('Bitte die markierten Felder korrigieren.');
        return;
      }
    }
    if (onNext()) setNotice('');
    else setNotice('Gespeichert. Das war der letzte Ladepunkt.');
  };

  const shown = (label: string) =>
    !filter.trim() ||
    label.toLocaleLowerCase('de-DE').includes(filter.trim().toLocaleLowerCase('de-DE'));

  const lockedHint = multi ? 'Bei Mehrfachauswahl gesperrt (je Ladepunkt eindeutig)' : undefined;

  /** Vermerk für Angaben, die beim Import fehlten (Wert ist nur Platzhalter). */
  const missingNote = (key: FieldKey): ReactNode => {
    if (!(CP_DATA_FIELDS as readonly string[]).includes(key)) return null;
    const field = key as ChargePointDataField;
    const affected = cps.filter((c) => c.missingFields?.includes(field));
    if (affected.length === 0) return null;
    return (
      <p className="cp-form__missing">
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
          <path
            d="M7 1.5 13 12H1z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <path
            d="M7 5.5v3M7 10v.01"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
        {multi
          ? `Fehlt bei ${affected.length} von ${cps.length} – Platzhalter, bitte nachtragen`
          : 'Fehlt – Platzhalter, bitte nachtragen'}{' '}
        <Button
          size="sm"
          variant="text"
          onClick={() =>
            execute(
              confirmChargePointFieldsCommand(
                affected.map((c) => c.id),
                [field],
              ),
            )
          }
        >
          Wert bestätigen
        </Button>
      </p>
    );
  };

  const text = (key: Exclude<FieldKey, 'vendor'>, extra?: ReactNode) => {
    const common = commonValue(cps, key);
    const locked = multi && UNIQUE_FIELDS.includes(key);
    const value = drafts[key] ?? common.value;
    const props = {
      name: key,
      label: FIELD_LABEL[key],
      value,
      disabled: locked,
      placeholder: common.mixed ? MIXED : undefined,
      error: errors[key],
      hint: locked ? lockedHint : warnings[key],
      onChange: (e: { target: { value: string } }) =>
        setDrafts((d) => ({ ...d, [key]: e.target.value })),
      onBlur: () => {
        const raw = drafts[key];
        if (raw !== undefined) commit(key, raw);
      },
      onKeyDown: (e: KeyboardEvent) => {
        if (e.key === 'Enter' && key !== 'notes') {
          const raw = drafts[key];
          if (raw !== undefined) commit(key, raw);
        }
      },
    };
    const numeric = key === 'minA' || key === 'maxA' || key === 'fuseA';
    return (
      <div key={key} className="cp-form__field">
        {numeric ? (
          <NumberField {...props} unit="A" step="any" />
        ) : key === 'port' || key === 'unitId' ? (
          <NumberField {...props} step="1" />
        ) : key === 'notes' ? (
          <Notes {...props} />
        ) : (
          <TextField {...props} />
        )}
        {extra}
        {missingNote(key)}
      </div>
    );
  };

  const select = (
    key: Exclude<FieldKey, 'vendor'>,
    options: ReadonlyArray<{ value: string; label: string }>,
    placeholder?: string,
  ) => {
    const common = commonValue(cps, key);
    const known = options.some((o) => o.value === common.value);
    const unknown =
      key === 'libraryModelId' ? !index.get(common.value) : !known && common.value !== '';
    // Steht der Wert nicht in der Liste (z. B. Modell eines anderen Herstellers), zeigt die
    // Auswahl den Platzhalter. Sonst zeigt der Browser die erste Option an, ohne dass sie gilt,
    // und ein Klick darauf löst keine Änderung aus.
    const shownValue = common.mixed || (!known && !unknown) ? '' : common.value;
    return (
      <div key={key} className="cp-form__field">
        <SelectField
          name={key}
          label={FIELD_LABEL[key]}
          value={shownValue}
          error={errors[key]}
          hint={warnings[key]}
          onChange={(e) => commit(key, e.target.value)}
        >
          {common.mixed ? (
            <option value="" disabled>
              {MIXED}
            </option>
          ) : !known && (placeholder || !unknown) ? (
            <option value="" disabled>
              {placeholder ?? 'Bitte wählen'}
            </option>
          ) : null}
          {unknown && !common.mixed ? (
            <option value={common.value}>{common.value} (nicht in der Bibliothek)</option>
          ) : null}
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </SelectField>
        {missingNote(key)}
      </div>
    );
  };

  const suggestion = multi ? undefined : suggestNextIp(project, first.network.ip);

  const modelOptions = index.models
    .filter((m) => m.model && (!vendorValue || m.model.vendor === vendorValue))
    .map((m) => ({ value: m.expectedId, label: m.model?.model ?? m.expectedId }));

  const renderField = (key: FieldKey): ReactNode => {
    if (!shown(FIELD_LABEL[key])) return null;
    switch (key) {
      case 'vendor':
        return (
          <div key={key} className="cp-form__field">
            <SelectField
              name="vendor"
              label={FIELD_LABEL.vendor}
              value={vendorMixed ? '' : vendorValue}
              onChange={(e) => {
                const next = e.target.value;
                setVendor(next);
                // Hat der Hersteller nur ein Modell, gilt es sofort.
                const only = index.models.filter((m) => m.model && m.model.vendor === next);
                if (next && only.length === 1 && only[0]) commit('libraryModelId', only[0].expectedId);
              }}
            >
              {vendorMixed ? (
                <option value="" disabled>
                  {MIXED}
                </option>
              ) : vendorValue ? null : (
                <option value="">Alle Hersteller</option>
              )}
              {vendors.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </SelectField>
          </div>
        );
      case 'libraryModelId':
        return select(key, modelOptions, 'Modell wählen');
      case 'groupId':
        return select(
          key,
          project.groups.map((g) => ({ value: g.id, label: groupPath(project, g.id) })),
        );
      case 'phaseRotation':
        return select(key, [
          { value: 'L1-L2-L3', label: 'L1-L2-L3' },
          { value: 'L2-L3-L1', label: 'L2-L3-L1' },
          { value: 'L3-L1-L2', label: 'L3-L1-L2' },
        ]);
      case 'protocol':
        return select(key, [
          { value: 'modbus-tcp', label: 'Modbus TCP' },
          { value: 'http', label: 'HTTP' },
          { value: 'ocpp-bridge', label: 'OCPP-Bridge' },
        ]);
      case 'phases':
        return select(key, [
          { value: '1', label: '1-phasig' },
          { value: '3', label: '3-phasig' },
        ]);
      case 'phaseSwitching':
        return select(key, [
          { value: 'nein', label: 'Nein' },
          { value: 'ja', label: 'Ja' },
        ]);
      case 'ip':
        return text(
          key,
          suggestion && suggestion !== (drafts.ip ?? first.network.ip) ? (
            <p className="cp-form__suggest">
              Nächste freie IP:{' '}
              <Button
                size="sm"
                variant="text"
                onClick={() => {
                  setDrafts((d) => ({ ...d, ip: suggestion }));
                  commit('ip', suggestion);
                }}
              >
                {suggestion} übernehmen
              </Button>
            </p>
          ) : null,
        );
      default:
        return text(key);
    }
  };

  const common = COMMON_FIELDS.map(renderField).filter(Boolean);
  const advanced = ADVANCED_FIELDS.map(renderField).filter(Boolean);
  const title = multi
    ? `${cps.length} Ladepunkte ausgewählt`
    : `${first.label} · ${modelDisplayName(index, first.libraryModelId)}`;
  const paths = [...new Set(cps.map((c) => groupPath(project, c.groupId)))];
  const subtitle = paths.length === 1 ? paths[0] : `${paths.length} Gruppen`;

  return (
    <div ref={root} className="cp-form">
      <PropertyPanel
        title={title}
        {...(subtitle ? { subtitle } : {})}
        filter={{ value: filter, onChange: setFilter }}
        footer={
          <div className="cp-form__footer">
            <div className="cp-form__buttons">
              <Button variant="primary" onClick={saveAndNext}>
                Speichern &amp; nächster LP
              </Button>
              <DeviceTestButton
                cp={multi ? undefined : first}
                model={index.get(first.libraryModelId)?.model}
              />
            </div>
          </div>
        }
      >
        {notice ? <Notice kind="info" title={notice} /> : null}
        {multi ? (
          <p className="cp-form__note">
            Änderungen gelten für alle {cps.length} ausgewählten Ladepunkte. Abweichende Werte
            stehen als „{MIXED}“ da, die Bezeichnung und die IP-Adresse sind gesperrt.
          </p>
        ) : null}
        {common.length > 0 ? (
          <PropertyGroup title="Häufig benötigt">
            <div className="cp-form__grid cp-form__grid--2">{common}</div>
          </PropertyGroup>
        ) : null}
        {advanced.length > 0 ? (
          <PropertyAdvanced
            key={filter.trim() ? 'gefiltert' : 'alle'}
            defaultOpen={!!filter.trim()}
          >
            <div className="cp-form__grid cp-form__grid--3">{advanced}</div>
          </PropertyAdvanced>
        ) : null}
        {common.length === 0 && advanced.length === 0 ? (
          <p className="cp-form__note">Kein Feld passt zu „{filter}“.</p>
        ) : null}
      </PropertyPanel>
    </div>
  );
}

function Notes(props: {
  name: string;
  label: string;
  value: string;
  disabled: boolean;
  error: string | undefined;
  hint: string | undefined;
  onChange: (e: { target: { value: string } }) => void;
  onBlur: () => void;
}) {
  const id = useId();
  const msg = props.error ?? props.hint;
  return (
    <div className={`lp-field${props.error ? ' lp-field--error' : ''}`}>
      <label className="lp-field__label" htmlFor={id}>
        {props.label}
      </label>
      <textarea
        id={id}
        name={props.name}
        className="lp-input cp-form__textarea"
        rows={3}
        value={props.value}
        disabled={props.disabled}
        aria-invalid={props.error ? true : undefined}
        aria-describedby={msg ? `${id}-msg` : undefined}
        onChange={props.onChange}
        onBlur={props.onBlur}
      />
      {msg ? (
        <p className={props.error ? 'lp-field__error' : 'lp-field__hint'} id={`${id}-msg`}>
          {msg}
        </p>
      ) : null}
    </div>
  );
}
