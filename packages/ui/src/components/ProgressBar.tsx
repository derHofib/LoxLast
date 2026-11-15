export interface ProgressBarProps {
  value: number;
  max: number;
  label: string;
  /** Schwellen als Anteil von max; darüber Warn-/Fehlerfarbe. Standard: 0,8 / 1,0 */
  warnAt?: number;
  errorAt?: number;
}

/** Balken (Grün nur als Fläche). Warn-/Fehlerzustand zusätzlich als Text, nicht nur über Farbe. */
export function ProgressBar({ value, max, label, warnAt = 0.8, errorAt = 1 }: ProgressBarProps) {
  const ratio = max > 0 ? Math.max(0, value / max) : 0;
  const state = ratio >= errorAt ? 'error' : ratio >= warnAt ? 'warning' : 'ok';
  const stateText =
    state === 'error' ? 'Limit erreicht' : state === 'warning' ? 'Hohe Auslastung' : '';
  return (
    <div className={`lp-progress lp-progress--${state}`}>
      <div
        className="lp-progress__track"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={Math.min(value, max)}
        aria-valuetext={`${value} von ${max}${stateText ? `, ${stateText}` : ''}`}
      >
        <div className="lp-progress__bar" style={{ width: `${Math.min(ratio, 1) * 100}%` }} />
      </div>
      {stateText ? <span className="lp-progress__text">{stateText}</span> : null}
    </div>
  );
}
