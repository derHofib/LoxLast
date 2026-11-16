import type { ChargePoint } from '@lastplan/core';
import { formatNumber } from '@lastplan/core';
import type { DeviceReading } from '@lastplan/protocol';
import { Button, StatusBadge, TextField, type Status } from '@lastplan/ui';
import type { WallboxModel } from '@lastplan/wallbox-library';
import { useId, useState, type FormEvent } from 'react';
import { testChargePoint, useDeviceTestStore, type DeviceTestState } from './deviceTestStore';
import {
  DEFAULT_GATEWAY_URL,
  GatewayError,
  forgetGateway,
  normalizeGatewayUrl,
  pairGateway,
  useGatewayStore,
} from './gatewayStore';
import './gateway.css';

/**
 * Button „Verbindung testen“ für das Eigenschaften-Formular. Nur aktiv, wenn ein Gateway
 * gekoppelt und genau ein Ladepunkt gewählt ist.
 */
export function DeviceTestButton({
  cp,
  model,
}: {
  /** undefined bei Mehrfachauswahl. */
  cp: ChargePoint | undefined;
  model: WallboxModel | undefined;
}) {
  const paired = useGatewayStore((s) => s.session !== null);
  const running = useDeviceTestStore((s) => (cp ? s.byId[cp.id]?.status === 'running' : false));
  const id = useId();
  const note = !paired
    ? 'Benötigt das Gateway: unter Infos „Gateway koppeln“.'
    : !cp
      ? 'Nur für einen einzelnen Ladepunkt.'
      : 'Liest Ströme, Leistung und Status (nur lesend). Ergebnis unter Infos.';
  return (
    <>
      <Button
        disabled={!paired || !cp || running}
        aria-describedby={id}
        onClick={() => {
          if (cp) void testChargePoint(cp, model);
        }}
      >
        {running ? 'Test läuft …' : 'Verbindung testen'}
      </Button>
      <span id={id} className="cp-form__note gw-note">
        {note}
      </span>
    </>
  );
}

const fmt = (r: DeviceReading): string => {
  if (r.value === null) return '–';
  const text = r.text ? ` (${r.text})` : '';
  return `${formatNumber(r.value)}${r.unit ? `\u00a0${r.unit}` : ''}${text}`;
};

function Pill({ state }: { state: DeviceTestState }) {
  if (state.status === 'running') return <StatusBadge status="ready">Test läuft …</StatusBadge>;
  if (state.status === 'failed')
    return <StatusBadge status="error">Test fehlgeschlagen</StatusBadge>;
  const { outcome, latencyMs, reachable } = state.result;
  const ms = latencyMs === null ? '' : ` · ${latencyMs} ms`;
  const map: Record<typeof outcome, [Status, string]> = {
    ok: ['active', `Erreichbar${ms}`],
    not_testable: ['warning', reachable ? `Nicht prüfbar · Port erreichbar${ms}` : 'Nicht prüfbar'],
    device_error: ['error', `Erreichbar, Gerät meldet Fehler${ms}`],
    unreachable: ['error', 'Nicht erreichbar'],
  };
  const [status, text] = map[outcome];
  return <StatusBadge status={status}>{text}</StatusBadge>;
}

function Result({ state }: { state: DeviceTestState }) {
  const message =
    state.status === 'failed'
      ? state.message
      : state.status === 'done'
        ? state.result.message
        : null;
  const readings = state.status === 'done' ? state.result.readings : [];
  const notTestable = state.status === 'done' && state.result.outcome === 'not_testable';
  return (
    <div className="gw-result" aria-live="polite">
      <p className="cp-info__status">
        <Pill state={state} />
      </p>
      {message ? <p className="cp-info__note">{message}</p> : null}
      {notTestable && state.result.missing.length > 0 ? (
        <p className="cp-info__note">
          Die fehlenden Angaben sind unten unter „Aus der Bibliothek“ als „fehlt (TODO)“ markiert.
        </p>
      ) : null}
      {readings.length > 0 ? (
        <dl className="cp-info__facts">
          {readings.map((r) => (
            <div key={r.role} className="gw-reading">
              <dt>{r.label}</dt>
              <dd>{fmt(r)}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}

/** Formular „Gateway koppeln“: Adresse + Einmalcode → Token (nur in dieser Sitzung). */
export function GatewayPairForm({ onDone }: { onDone?: () => void }) {
  const [url, setUrl] = useState(DEFAULT_GATEWAY_URL);
  const [code, setCode] = useState('');
  const [urlError, setUrlError] = useState<string>();
  const [codeError, setCodeError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const base = normalizeGatewayUrl(url);
    setUrlError(typeof base === 'string' ? undefined : base.error);
    const codeOk = /^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/.test(code.trim());
    setCodeError(
      codeOk ? undefined : 'Einmalcode im Format XXXX-XXXX (steht in der Gateway-Konsole).',
    );
    if (typeof base !== 'string' || !codeOk) return;
    setBusy(true);
    try {
      await pairGateway(base, code);
      onDone?.();
    } catch (error) {
      const msg = error instanceof GatewayError ? error.message : 'Kopplung fehlgeschlagen.';
      if (error instanceof GatewayError && error.status === null) setUrlError(msg);
      else setCodeError(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="gw-pair"
      onSubmit={(e) => void submit(e)}
      noValidate
      aria-label="Gateway koppeln"
    >
      <TextField
        label="Gateway-Adresse"
        name="gatewayUrl"
        value={url}
        error={urlError}
        hint="Wie beim Start des Gateways angezeigt, z. B. http://127.0.0.1:8787"
        onChange={(e) => setUrl(e.target.value)}
      />
      <TextField
        label="Einmalcode"
        name="pairingCode"
        value={code}
        error={codeError}
        placeholder="XXXX-XXXX"
        autoComplete="off"
        onChange={(e) => setCode(e.target.value)}
      />
      <Button type="submit" variant="primary" disabled={busy}>
        {busy ? 'Koppelt …' : 'Koppeln'}
      </Button>
    </form>
  );
}

/** Infos-Abschnitt „Verbindungstest“: Kopplung bzw. Ergebnis des gewählten Ladepunkts. */
export function DeviceTestSection({ cps }: { cps: readonly ChargePoint[] }) {
  const session = useGatewayStore((s) => s.session);
  const single = cps.length === 1 ? cps[0] : undefined;
  const state = useDeviceTestStore((s) => (single ? s.byId[single.id] : undefined));
  const [pairing, setPairing] = useState(false);

  if (!session) {
    return (
      <>
        <StatusBadge status="ready">Gateway nicht gekoppelt</StatusBadge>
        <p className="cp-info__note">
          Für den Verbindungstest das LastPlan-Gateway im Anlagennetz starten und mit dem Einmalcode
          aus der Konsole koppeln.
        </p>
        {pairing ? (
          <GatewayPairForm onDone={() => setPairing(false)} />
        ) : (
          <Button onClick={() => setPairing(true)}>Gateway koppeln</Button>
        )}
      </>
    );
  }
  return (
    <>
      {!single ? (
        <p className="cp-info__note">Für den Verbindungstest einen einzelnen Ladepunkt wählen.</p>
      ) : state ? (
        <Result state={state} />
      ) : (
        <p className="cp-info__note">Noch nicht getestet. „Verbindung testen“ startet den Test.</p>
      )}
      <p className="cp-info__note gw-session">
        Gekoppelt mit {session.baseUrl}{' '}
        <Button variant="text" onClick={forgetGateway}>
          Entkoppeln
        </Button>
      </p>
    </>
  );
}
