import { useId, type InputHTMLAttributes } from 'react';

export interface SearchFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  /** Zugänglicher Name, z. B. „Projekte durchsuchen“. */
  label: string;
  onClear?: () => void;
}

export function SearchField({ label, onClear, value, className, ...rest }: SearchFieldProps) {
  const id = useId();
  return (
    <div className={`lp-search${className ? ` ${className}` : ''}`} role="search">
      <label className="lp-visually-hidden" htmlFor={id}>
        {label}
      </label>
      <svg
        className="lp-search__icon"
        width="16"
        height="16"
        viewBox="0 0 16 16"
        aria-hidden="true"
      >
        <circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path d="m11 11 3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
      <input id={id} type="search" className="lp-search__input" value={value} {...rest} />
      {onClear && value ? (
        <button
          type="button"
          className="lp-search__clear"
          onClick={onClear}
          aria-label="Suche leeren"
        >
          ×
        </button>
      ) : null}
    </div>
  );
}
