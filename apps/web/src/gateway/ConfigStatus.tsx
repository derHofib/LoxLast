import type {
  ConfigDiscoveryReport,
  ConfigMcpStatus,
  ConfigMcpStatusResponse,
} from '@lastplan/protocol';
import { Button, StatusBadge, type Status } from '@lastplan/ui';
import { useState } from 'react';
import { ConfigHandover } from './ConfigHandover';
import { GatewayPairForm } from './DeviceTest';
import {
  GatewayError,
  requestConfigDiscovery,
  requestConfigStatus,
  useGatewayStore,
} from './gatewayStore';
import './gateway.css';

const BADGE: Record<ConfigMcpStatus, { status: Status; text: string }> = {
  ok: { status: 'active', text: 'Config verbunden' },
  not_configured: { status: 'ready', text: 'Im Gateway abgeschaltet' },
  unreachable: { status: 'error', text: 'Config nicht erreichbar' },
  no_document: { status: 'warning', text: 'Kein Projekt geöffnet' },
  methods_missing: { status: 'error', text: 'Config-Version passt nicht' },
  error: { status: 'error', text: 'Fehler' },
};

type CheckState =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'done'; result: ConfigMcpStatusResponse }
  | { kind: 'failed'; message: string };

/** Bericht als JSON-Datei speichern (bleibt lokal; der Nutzer entscheidet, ob er ihn weitergibt). */
function download(report: ConfigDiscoveryReport): void {
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `lastplan-config-erkundung-${report.generatedAt.slice(0, 10)}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

type DiscoveryState =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'done'; report: ConfigDiscoveryReport }
  | { kind: 'failed'; message: string };

/** Config-Erkundung (Plan 6.3): liest Bausteintypen und Modbus-Eigenschaften, ändert nichts. */
function ConfigDiscovery() {
  const [state, setState] = useState<DiscoveryState>({ kind: 'idle' });
  const run = async () => {
    setState({ kind: 'running' });
    try {
      const res = await requestConfigDiscovery();
      if (res.report) {
        setState({ kind: 'done', report: res.report });
        download(res.report);
      } else setState({ kind: 'failed', message: res.status.message });
    } catch (e) {
      setState({
        kind: 'failed',
        message: e instanceof GatewayError ? e.message : 'Erkundung fehlgeschlagen.',
      });
    }
  };
  return (
    <div className="config-discovery">
      <p className="export-muted">
        Erkundung: liest im geöffneten Projekt passende Bausteintypen, Modbus-Geräte und deren
        Eigenschaften und speichert einen Bericht als Datei. Er enthält Namen aus dem Projekt.
      </p>
      <div aria-live="polite">
        {state.kind === 'running' ? (
          <StatusBadge status="ready">Erkundung läuft …</StatusBadge>
        ) : state.kind === 'failed' ? (
          <>
            <StatusBadge status="error">Erkundung fehlgeschlagen</StatusBadge>
            <p className="export-muted">{state.message}</p>
          </>
        ) : state.kind === 'done' ? (
          <>
            <StatusBadge status="active">Bericht gespeichert</StatusBadge>
            <p className="export-muted">
              {state.report.summary.blockTypes} passende Bausteintypen,{' '}
              {state.report.summary.modbusObjects} Modbus-Objekte,{' '}
              {state.report.summary.placedBlocks} platzierte Bausteine,{' '}
              {state.report.summary.errors} Fehler beim Lesen.
            </p>
            <Button variant="text" onClick={() => download(state.report)}>
              Bericht erneut speichern
            </Button>
          </>
        ) : null}
      </div>
      <Button onClick={() => void run()} disabled={state.kind === 'running'}>
        Config erkunden
      </Button>
    </div>
  );
}

/**
 * Verbindung zu Loxone Config über das Gateway (ADR 0013, Plan 6.2). Die Prüfung liest nur;
 * danach bietet die Karte die Übergabe (6.5) und die Erkundung (6.3) an.
 */
export function ConfigStatus() {
  const paired = useGatewayStore((s) => s.session !== null);
  const [state, setState] = useState<CheckState>({ kind: 'idle' });
  const [pairing, setPairing] = useState(false);

  if (!paired) {
    return (
      <>
        <StatusBadge status="ready">Gateway nicht gekoppelt</StatusBadge>
        <p className="export-muted">
          Die Übergabe läuft über das LastPlan-Gateway auf dem Rechner, auf dem Loxone Config läuft
          (bei einer VM: in der VM).
        </p>
        {pairing ? (
          <GatewayPairForm onDone={() => setPairing(false)} />
        ) : (
          <Button onClick={() => setPairing(true)}>Gateway koppeln</Button>
        )}
      </>
    );
  }

  const check = async () => {
    setState({ kind: 'running' });
    try {
      setState({ kind: 'done', result: await requestConfigStatus() });
    } catch (e) {
      setState({
        kind: 'failed',
        message: e instanceof GatewayError ? e.message : 'Prüfung fehlgeschlagen.',
      });
    }
  };

  return (
    <>
      <div aria-live="polite">
        {state.kind === 'running' ? (
          <StatusBadge status="ready">Prüfung läuft …</StatusBadge>
        ) : state.kind === 'failed' ? (
          <>
            <StatusBadge status="error">Prüfung fehlgeschlagen</StatusBadge>
            <p className="export-muted">{state.message}</p>
          </>
        ) : state.kind === 'done' ? (
          <>
            <StatusBadge status={BADGE[state.result.status].status}>
              {BADGE[state.result.status].text}
            </StatusBadge>
            <p className="export-muted">{state.result.message}</p>
            {state.result.project ? (
              <dl className="export-summary">
                <dt>Projekt</dt>
                <dd>{state.result.project.title}</dd>
                <dt>Seiten</dt>
                <dd>{state.result.project.pagesCount}</dd>
                <dt>Bausteine</dt>
                <dd>{state.result.project.functionBlocksCount}</dd>
                <dt>Ungespeicherte Änderungen</dt>
                <dd>{state.result.project.modified ? 'ja' : 'nein'}</dd>
              </dl>
            ) : null}
          </>
        ) : (
          <p className="export-muted">Noch nicht geprüft. Es wird nur gelesen, nichts geändert.</p>
        )}
      </div>
      <Button onClick={() => void check()} disabled={state.kind === 'running'}>
        Verbindung prüfen
      </Button>
      {state.kind === 'done' && state.result.status === 'ok' ? (
        <>
          <ConfigHandover serverVersion={state.result.server?.version} />
          <ConfigDiscovery />
        </>
      ) : null}
    </>
  );
}
