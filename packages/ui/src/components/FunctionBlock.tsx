import type { ReactNode } from 'react';

export interface FunctionBlockProps {
  title: string;
  inputs?: readonly string[];
  outputs?: readonly string[];
  params?: readonly string[];
  /** Prüfbedarf: Kopf-Unterkante orange statt grün. */
  needsReview?: boolean;
}

/** Funktionsbaustein der Export-Vorschau: Eingang = blaues Quadrat, Ausgang = grüner Kreis, Parameter = graue Raute. */
export function FunctionBlock({
  title,
  inputs = [],
  outputs = [],
  params = [],
  needsReview,
}: FunctionBlockProps) {
  return (
    <article className={`lp-fb${needsReview ? ' lp-fb--review' : ''}`}>
      <header className="lp-fb__head">{title}</header>
      <div className="lp-fb__body">
        <ul className="lp-fb__col">
          {inputs.map((n) => (
            <li key={n}>
              <span className="lp-io lp-io--input" aria-hidden="true" />
              <span className="lp-visually-hidden">Eingang: </span>
              {n}
            </li>
          ))}
        </ul>
        <ul className="lp-fb__col lp-fb__col--out">
          {outputs.map((n) => (
            <li key={n}>
              {n}
              <span className="lp-visually-hidden"> (Ausgang)</span>
              <span className="lp-io lp-io--output" aria-hidden="true" />
            </li>
          ))}
        </ul>
      </div>
      {params.length > 0 ? (
        <ul className="lp-fb__params">
          {params.map((n) => (
            <li key={n}>
              <span className="lp-io lp-io--param" aria-hidden="true" />
              <span className="lp-visually-hidden">Parameter: </span>
              {n}
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}

export function IoLegend(): ReactNode {
  return (
    <ul className="lp-legend" aria-label="Legende">
      <li>
        <span className="lp-io lp-io--input" aria-hidden="true" /> Eingang
      </li>
      <li>
        <span className="lp-io lp-io--output" aria-hidden="true" /> Ausgang
      </li>
      <li>
        <span className="lp-io lp-io--param" aria-hidden="true" /> Parameter
      </li>
    </ul>
  );
}
