import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';

export interface FieldChange {
  from: string | number;
  to: string | number;
}

interface FieldShellProps {
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
  /** Noch nicht übernommene Änderung: grüner Rand und Zeile „Geändert: alt → neu“ (Kap. 10.2). */
  change?: FieldChange | undefined;
  unit?: string | undefined;
  id: string;
  children: ReactNode;
}

function FieldShell({ label, hint, error, change, unit, id, children }: FieldShellProps) {
  return (
    <div
      className={`lp-field${change ? ' lp-field--changed' : ''}${error ? ' lp-field--error' : ''}`}
    >
      <label className="lp-field__label" htmlFor={id}>
        {label}
      </label>
      <div className="lp-field__control">
        {children}
        {unit ? <span className="lp-field__unit">{unit}</span> : null}
      </div>
      {change ? (
        <p className="lp-field__change">
          Geändert: {change.from} → {change.to}
          {unit ? ` ${unit}` : ''}
        </p>
      ) : null}
      {error ? (
        <p className="lp-field__error" id={`${id}-msg`} role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="lp-field__hint" id={`${id}-msg`}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

interface FieldBase {
  label: string;
  hint?: string;
  error?: string;
  change?: FieldChange;
}

export type TextFieldProps = FieldBase & Omit<InputHTMLAttributes<HTMLInputElement>, 'size'>;

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, hint, error, change, id, ...rest },
  ref,
) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <FieldShell id={fid} label={label} hint={hint} error={error} change={change}>
      <input
        ref={ref}
        id={fid}
        className="lp-input"
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? `${fid}-msg` : undefined}
        {...rest}
      />
    </FieldShell>
  );
});

export type NumberFieldProps = FieldBase &
  Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'type'> & { unit?: string };

/** Zahlenfeld mit Einheit (z. B. A, kW, V), tabellarische Ziffern. */
export const NumberField = forwardRef<HTMLInputElement, NumberFieldProps>(function NumberField(
  { label, hint, error, change, unit, id, ...rest },
  ref,
) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <FieldShell id={fid} label={label} hint={hint} error={error} change={change} unit={unit}>
      <input
        ref={ref}
        id={fid}
        type="number"
        inputMode="decimal"
        className="lp-input lp-input--number"
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? `${fid}-msg` : undefined}
        {...rest}
      />
    </FieldShell>
  );
});

export type SelectFieldProps = FieldBase & SelectHTMLAttributes<HTMLSelectElement>;

export const SelectField = forwardRef<HTMLSelectElement, SelectFieldProps>(function SelectField(
  { label, hint, error, change, id, children, ...rest },
  ref,
) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <FieldShell id={fid} label={label} hint={hint} error={error} change={change}>
      <select
        ref={ref}
        id={fid}
        className="lp-input lp-select"
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? `${fid}-msg` : undefined}
        {...rest}
      >
        {children}
      </select>
    </FieldShell>
  );
});
