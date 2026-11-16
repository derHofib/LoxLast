import type { ConfigMcpStatus, ConfigMcpStatusResponse } from '@lastplan/protocol';
import { Button, StatusBadge, type Status } from '@lastplan/ui';
import { useState } from 'react';
import { GatewayPairForm } from './DeviceTest';
import { GatewayError, requestConfigStatus, useGatewayStore } from './gatewayStore';
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

/**
 * Verbindung zu Loxone Config über das Gateway (ADR 0013, Plan 6.2). Prüft nur lesend; die
 * eigentliche Übergabe folgt mit 6.4/6.5.
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
    </>
  );
}
