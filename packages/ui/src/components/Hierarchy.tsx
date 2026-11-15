import type { ReactNode } from 'react';

/** Netzanschluss: 4 px grüne Oberkante. */
export function GridNode({ label, children }: { label: string; children?: ReactNode }) {
  return (
    <div className="lp-node lp-node--grid">
      <strong>{label}</strong>
      {children}
    </div>
  );
}

/** Cluster: 4 px linker Rand, grün bzw. orange bei Fehler. */
export function ClusterNode({
  name,
  error,
  children,
}: {
  name: string;
  error?: boolean;
  children?: ReactNode;
}) {
  return (
    <section
      className={`lp-node lp-node--cluster${error ? ' lp-node--error' : ''}`}
      aria-label={name}
    >
      <h3 className="lp-node__title">{name}</h3>
      {children}
    </section>
  );
}

/** Gruppe: weiße Karte. */
export function GroupNode({ name, children }: { name: string; children?: ReactNode }) {
  return (
    <section className="lp-node lp-node--group" aria-label={name}>
      <h4 className="lp-node__title">{name}</h4>
      {children}
    </section>
  );
}

/** Ladepunkt-Chip: grau, Label + Modell + Phase rechts. */
export function ChargePointChip({
  label,
  model,
  phase,
  selected,
  onClick,
}: {
  label: string;
  model: string;
  phase: string;
  selected?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      className={`lp-chip${selected ? ' lp-chip--selected' : ''}`}
      aria-pressed={selected ?? false}
      onClick={onClick}
    >
      <span className="lp-chip__label">{label}</span>
      <span className="lp-chip__model">{model}</span>
      <span className="lp-chip__phase">{phase}</span>
    </button>
  );
}
