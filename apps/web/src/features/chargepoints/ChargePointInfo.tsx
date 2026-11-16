import type { ChargePoint, Finding } from '@lastplan/core';
import { SEVERITY_LABEL } from '@lastplan/core';
import { StatusBadge } from '@lastplan/ui';
import { DeviceTestSection } from '../../gateway/DeviceTest';
import { describeModel, ROLE_LABEL, type InfoValue, type LibraryIndex } from './libraryInfo';

export interface ChargePointInfoProps {
  cps: readonly ChargePoint[];
  index: LibraryIndex;
  /** Alle Prüfmeldungen des Projekts; angezeigt werden die zu den ausgewählten Ladepunkten. */
  findings: readonly Finding[];
  /** Prüfung läuft noch (Entprellung). */
  pending?: boolean;
}

/** Wert oder Lücke: Lücken stehen als Warnsymbol plus Text, nie nur in Farbe (Kap. 10.3). */
export function Value({ v }: { v: InfoValue }) {
  if (!v.todo) return <>{v.text}</>;
  return (
    <span className="cp-todo">
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
        <path
          d="M7 1.5 13 12H1z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
        <path d="M7 5.5v3M7 10v.01" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
      fehlt (TODO)
    </span>
  );
}

/** Infos-Spalte (Kap. 11.2, 360 px): Verbindungstest, Bibliotheksdaten, Prüfmeldungen. */
export function ChargePointInfo({ cps, index, findings, pending }: ChargePointInfoProps) {
  const modelIds = [...new Set(cps.map((c) => c.libraryModelId))];
  const ids = new Set(cps.map((c) => c.id));
  const related = findings.filter((f) => f.targetIds.some((id) => ids.has(id)));

  return (
    <aside className="cp-info" aria-label="Infos">
      <section className="cp-info__section" aria-labelledby="cp-info-test">
        <h3 id="cp-info-test" className="lp-group__title">
          Verbindungstest
        </h3>
        <DeviceTestSection cps={cps} />
      </section>

      <section className="cp-info__section" aria-labelledby="cp-info-lib">
        <h3 id="cp-info-lib" className="lp-group__title">
          Aus der Bibliothek
        </h3>
        {modelIds.length === 0 ? (
          <p className="cp-info__note">Kein Ladepunkt ausgewählt.</p>
        ) : modelIds.length > 1 ? (
          <p className="cp-info__note">
            Die Auswahl enthält {modelIds.length} verschiedene Modelle. Für die Bibliotheksdaten
            einen einzelnen Ladepunkt wählen.
          </p>
        ) : (
          modelIds.map((id) => <ModelBlock key={id} index={index} modelId={id} />)
        )}
      </section>

      <section className="cp-info__section" aria-labelledby="cp-info-checks">
        <h3 id="cp-info-checks" className="lp-group__title">
          Prüfmeldungen
        </h3>
        {related.length === 0 ? (
          <p className="cp-info__note">
            {pending ? 'Prüfung läuft …' : 'Keine Meldungen zu diesem Ladepunkt.'}
          </p>
        ) : (
          <ul className="cp-info__findings">
            {related.map((f, i) => (
              <li key={`${f.ruleId}-${i}`} className={`cp-finding cp-finding--${f.severity}`}>
                <strong>{SEVERITY_LABEL[f.severity]}</strong>
                <span className="cp-finding__rule"> · {f.ruleId}</span>
                <p>{f.message}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </aside>
  );
}

function ModelBlock({ index, modelId }: { index: LibraryIndex; modelId: string }) {
  const info = describeModel(index, modelId);
  if (!info.inLibrary) {
    return (
      <div className="cp-info__block">
        <p>
          <strong>{info.displayName}</strong>
        </p>
        <StatusBadge status="warning">unvollständig</StatusBadge>
        <p className="cp-info__note">
          Dieses Modell steht nicht in der Bibliothek. Export gesperrt, bis die Herstellerdoku
          eingetragen ist.
        </p>
      </div>
    );
  }
  return (
    <div className="cp-info__block">
      <dl className="cp-info__facts">
        <dt>Modell-ID</dt>
        <dd>{info.modelId}</dd>
        <dt>Modell</dt>
        <dd>{info.displayName}</dd>
        <dt>Firmware ab</dt>
        <dd>
          <Value v={info.firmware.min} />
        </dd>
        <dt>Firmware bis</dt>
        <dd>
          <Value v={info.firmware.max} />
        </dd>
        <dt>Modbus-Port</dt>
        <dd>
          <Value v={info.port} />
        </dd>
        <dt>Unit-ID</dt>
        <dd>
          <Value v={info.unitId} />
        </dd>
      </dl>

      <p className="cp-info__status">
        {info.complete ? (
          <StatusBadge status="active">vollständig</StatusBadge>
        ) : (
          <StatusBadge status="warning">
            unvollständig (
            {info.missingCount === 1 ? '1 Angabe fehlt' : `${info.missingCount} Angaben fehlen`})
          </StatusBadge>
        )}
      </p>
      {info.complete ? null : (
        <p className="cp-info__note">Export gesperrt, bis die Herstellerdoku eingetragen ist.</p>
      )}

      <h4 className="cp-info__subtitle">Register</h4>
      <ul className="cp-regs">
        {info.registers.map((r) => (
          <li key={r.role} className="cp-reg">
            <strong>{ROLE_LABEL[r.role] ?? r.role}</strong>
            <dl>
              <dt>Adresse</dt>
              <dd>
                <Value v={r.address} />
              </dd>
              <dt>Funktion</dt>
              <dd>
                <Value v={r.fn} />
              </dd>
              <dt>Typ</dt>
              <dd>
                <Value v={r.type} />
              </dd>
              <dt>Skalierung</dt>
              <dd>
                <Value v={r.scale} />
              </dd>
              <dt>Quelle</dt>
              <dd>
                <Value v={r.source} />
              </dd>
            </dl>
          </li>
        ))}
      </ul>
    </div>
  );
}
