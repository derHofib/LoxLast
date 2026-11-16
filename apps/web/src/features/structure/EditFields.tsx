import { formatNumber } from '@lastplan/core';
import { NumberField, TextField } from '@lastplan/ui';
import { useEffect, useState } from 'react';

/**
 * Felder mit „Geändert“-Zustand (Kap. 10.2): Eingaben werden beim Verlassen des Feldes oder mit Enter
 * übernommen (ein Undo-Schritt je Änderung, ADR 0010). Bis dahin zeigt das Feld „Geändert: alt → neu“.
 * Escape verwirft die Eingabe.
 */

const fmt = (v: number | undefined) => (v === undefined ? '–' : formatNumber(v));

export function CommitNumber({
  label,
  unit,
  value,
  onCommit,
  allowZero = false,
  max,
  optional = false,
  hint,
}: {
  label: string;
  unit: string;
  value: number | undefined;
  onCommit: (value: number | undefined) => void;
  /** 0 ist zulässig (z. B. Gebäudereserve), sonst muss der Wert größer als 0 sein. */
  allowZero?: boolean;
  max?: number;
  /** Leeres Feld = Wert entfernen (z. B. kein Gruppen-Limit). */
  optional?: boolean;
  hint?: string;
}) {
  const text = value === undefined ? '' : String(value);
  const [draft, setDraft] = useState(text);
  useEffect(() => setDraft(text), [text]);

  const trimmed = draft.trim().replace(',', '.');
  let parsed: number | undefined;
  let error: string | undefined;
  if (trimmed === '') {
    if (!optional) error = `${label}: bitte einen Wert eingeben`;
  } else {
    parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) error = `${label}: bitte eine Zahl eingeben`;
    else if (allowZero ? parsed < 0 : parsed <= 0)
      error = allowZero
        ? `${label} darf nicht negativ sein`
        : `${label} muss größer als 0 ${unit} sein`;
    else if (max !== undefined && parsed > max)
      error = `${label} darf höchstens ${formatNumber(max)} ${unit} betragen`;
  }
  const changed = !error && parsed !== value;

  function commit() {
    if (error) return;
    if (parsed !== value) onCommit(parsed);
  }

  return (
    <NumberField
      label={label}
      unit={unit}
      value={draft}
      step="any"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
        } else if (e.key === 'Escape') {
          setDraft(text);
        }
      }}
      {...(error ? { error } : {})}
      {...(hint && !error ? { hint } : {})}
      {...(changed ? { change: { from: fmt(value), to: fmt(parsed) } } : {})}
    />
  );
}

export function CommitText({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: string;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const trimmed = draft.trim();
  const error = trimmed === '' ? `${label}: bitte einen Namen eingeben` : undefined;
  const changed = !error && trimmed !== value;

  function commit() {
    if (!error && trimmed !== value) onCommit(trimmed);
  }

  return (
    <TextField
      label={label}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
        } else if (e.key === 'Escape') {
          setDraft(value);
        }
      }}
      {...(error ? { error } : {})}
      {...(changed ? { change: { from: value, to: trimmed } } : {})}
    />
  );
}
