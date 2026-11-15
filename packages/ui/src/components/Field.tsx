import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';

interface FieldShellProps {
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
  /** Wert weicht vom gespeicherten/Referenzwert ab → „Geändert“-Zustand (Kap. 10.2). */
  changed?: boolean | undefined;
  unit?: string | undefined;
  id: string;
  children: ReactNode;
}

function FieldShell({ label, hint, error, changed, unit, id, children }: FieldShellProps) {
  return (
    <div
      className={`lp-field${changed ? ' lp-field--changed' : ''}${error ? ' lp-field--error' : ''}`}
    >
      <label className="lp-field__label" htmlFor={id}>
        {label}
        {changed ? <span className="lp-field__badge">Geändert</span> : null}
      </label>
      <div className="lp-field__control">
        {children}
        {unit ? (
          <span className="lp-field__unit" aria-hidden="true">
            {unit}
          </span>
        ) : null}
      </div>
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
  changed?: boolean;
}

export type TextFieldProps = FieldBase & Omit<InputHTMLAttributes<HTMLInputElement>, 'size'>;

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, hint, error, changed, id, ...rest },
  ref,
) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <FieldShell id={fid} label={label} hint={hint} error={error} changed={changed}>
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
  { label, hint, error, changed, unit, id, ...rest },
  ref,
) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <FieldShell id={fid} label={label} hint={hint} error={error} changed={changed} unit={unit}>
      <input
        ref={ref}
        id={fid}
        type="number"
        inputMode="decimal"
        className={`lp-input lp-input--number${unit ? ' lp-input--unit' : ''}`}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? `${fid}-msg` : undefined}
        {...rest}
      />
    </FieldShell>
  );
});

export type SelectFieldProps = FieldBase & SelectHTMLAttributes<HTMLSelectElement>;

export const SelectField = forwardRef<HTMLSelectElement, SelectFieldProps>(function SelectField(
  { label, hint, error, changed, id, children, ...rest },
  ref,
) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <FieldShell id={fid} label={label} hint={hint} error={error} changed={changed}>
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
