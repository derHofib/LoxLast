import { Button, Card, KpiTile, Notice, SearchField, SelectField, StatusBadge } from '@lastplan/ui';
import type { Status } from '@lastplan/ui';
import { useEffect, useMemo, useState } from 'react';
import { GatewayPairForm } from '../../gateway/DeviceTest';
import { useGatewayStore } from '../../gateway/gatewayStore';
import { useProjectStore } from '../../state/projectStore';
import { startDemoSource } from './demoSource';
import { startGatewaySource } from './gatewaySource';
import { resetLive, useLiveStore, type LiveState } from './liveStore';
import { arrange, kpis, type RowFilter, type SortDir, type SortKey } from './table';
import './live.css';

const time = new Intl.DateTimeFormat('de-DE', { timeStyle: 'medium' });
const num = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });
const fmt = (v: number | null, unit: string) => (v === null ? '–' : `${num.format(v)} ${unit}`);

export function pillOf(s: LiveState): { status: Status; text: string } {
  if (s.demo) return { status: 'warning', text: 'Demo-Daten' };
  switch (s.connection) {
    case 'unpaired':
      return { status: 'ready', text: 'Gateway nicht gekoppelt' };
    case 'connecting':
      return { status: 'ready', text: 'Verbindet …' };
    case 'offline':
      return { status: 'warning', text: 'Getrennt' };
    case 'error':
      return { status: 'error', text: 'Verbindungsfehler' };
    case 'connected':
      if (!s.miniserver)
        return { status: 'ready', text: 'Gateway verbunden, Miniserver unbekannt' };
      if (s.miniserver.state === 'connected') return { status: 'active', text: 'Verbunden' };
      if (s.miniserver.state === 'connecting')
        return { status: 'ready', text: 'Miniserver verbindet …' };
      return { status: 'warning', text: 'Miniserver getrennt' };
  }
}

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'label', label: 'Ladepunkt' },
  { key: 'status', label: 'Status' },
  { key: 'setpointA', label: 'Sollwert' },
  { key: 'powerKw', label: 'Leistung' },
  { key: 'fault', label: 'Störung' },
];

function EmptyState({ onDemo }: { onDemo: () => void }) {
  const paired = useGatewayStore((s) => s.session !== null);
  const [pairing, setPairing] = useState(false);
  return (
    <Card title="Noch keine Live-Werte">
      <p>
        Live-Werte liefert das LastPlan-Gateway im Anlagennetz. Es verbindet sich mit dem Miniserver
        und reicht die Werte an diese Ansicht weiter.
      </p>
      <ol className="live-steps">
        <li>Gateway im Anlagennetz starten (siehe Gateway-Dokumentation).</li>
        <li>Mit dem Einmalcode aus der Gateway-Konsole koppeln.</li>
        <li>Miniserver im Gateway hinterlegen; danach erscheinen die Werte hier.</li>
      </ol>
      {!paired ? (
        pairing ? (
          <GatewayPairForm onDone={() => setPairing(false)} />
        ) : (
          <Button variant="primary" onClick={() => setPairing(true)}>
            Gateway koppeln
          </Button>
        )
      ) : (
        <p>Das Gateway ist gekoppelt, es sind aber noch keine Werte eingetroffen.</p>
      )}{' '}
      <Button onClick={onDemo}>Demo-Daten anzeigen</Button>
    </Card>
  );
}

/** Tab „Live“ (Plan 9.1/9.2): Verbindungs-Pill, Kennzahlen, Ladepunkt-Tabelle. Nur lesend. */
export function LiveView() {
  const project = useProjectStore((s) => s.project);
  const state = useLiveStore();
  const session = useGatewayStore((s) => s.session);
  const [filter, setFilter] = useState<RowFilter>('all');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'label', dir: 'asc' });
  const projectId = project?.id ?? '';

  useEffect(() => {
    if (state.demo) return;
    return startGatewaySource(projectId);
  }, [projectId, session, state.demo]);
  useEffect(() => () => resetLive(), [projectId]);

  const all = useMemo(() => Object.values(state.rows), [state.rows]);
  const shown = useMemo(
    () => arrange(all, filter, search, sort.key, sort.dir),
    [all, filter, search, sort],
  );
  const k = kpis(all);
  const pill = pillOf(state);
  const stale = !state.demo && state.connection !== 'connected';
  const last = state.lastValuesAt ? time.format(new Date(state.lastValuesAt)) : null;
  const msConnected = state.miniserver?.state === 'connected';

  const toggle = (key: SortKey) =>
    setSort((s) => ({ key, dir: s.key === key && s.dir === 'asc' ? 'desc' : 'asc' }));

  return (
    <div className="live-view">
      <div className="live-head">
        <h2 className="live-title">Live</h2>
        <StatusBadge status={pill.status}>{pill.text}</StatusBadge>
        {last ? <span className="live-muted">Letzte Werte von {last}</span> : null}
        {state.demo ? <Button onClick={() => resetLive()}>Demo beenden</Button> : null}
      </div>

      {state.demo ? (
        <Notice kind="warning" banner title="Demo – keine echten Werte">
          Diese Zahlen sind synthetisch und stammen nicht vom Miniserver.
        </Notice>
      ) : null}
      {stale && all.length > 0 ? (
        <Notice
          kind="warning"
          banner
          title={`Keine Verbindung – Werte${last ? ` von ${last}` : ''} sind nicht aktuell`}
        >
          {state.message ?? 'Die Verbindung wird automatisch neu aufgebaut.'}
        </Notice>
      ) : null}
      {!state.demo && state.connection === 'error' && all.length === 0 ? (
        <Notice
          kind="error"
          title="Verbindung zum Gateway fehlgeschlagen"
          solution="Gateway-Adresse und Kopplung prüfen, bei Bedarf neu koppeln."
        >
          {state.message}
        </Notice>
      ) : null}
      {!state.demo && state.connection === 'connected' && state.miniserver && !msConnected ? (
        <Notice kind="warning" banner title="Miniserver getrennt">
          {state.miniserver.message ?? 'Das Gateway erreicht den Miniserver nicht.'}
        </Notice>
      ) : null}

      {all.length === 0 && !state.demo ? (
        <EmptyState onDemo={() => project && startDemoSource(project)} />
      ) : (
        <>
          <div className="live-kpis" aria-label="Kennzahlen">
            <KpiTile label="Ladepunkte" value={k.total} />
            <KpiTile label="Ladend" value={k.charging} />
            <KpiTile label="Gesamtleistung" value={num.format(k.powerKw)} unit="kW" />
            <KpiTile label="Störungen" value={k.faults} tone={k.faults > 0 ? 'warning' : 'ok'} />
          </div>
          <Card>
            <div className="live-toolbar">
              <SearchField
                label="Ladepunkt suchen"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <SelectField
                label="Anzeige"
                value={filter}
                onChange={(e) => setFilter(e.target.value as RowFilter)}
              >
                <option value="all">Alle</option>
                <option value="charging">Nur ladende</option>
                <option value="fault">Nur Störungen</option>
              </SelectField>
            </div>
            <table className={`live-table${stale ? ' live-table--stale' : ''}`}>
              <caption className="live-sr">
                Ladepunkte mit Live-Werten{stale ? ' (nicht aktuell)' : ''}
              </caption>
              <thead>
                <tr>
                  {COLUMNS.map((c) => (
                    <th
                      key={c.key}
                      scope="col"
                      aria-sort={
                        sort.key === c.key
                          ? sort.dir === 'asc'
                            ? 'ascending'
                            : 'descending'
                          : 'none'
                      }
                    >
                      <button type="button" className="live-sort" onClick={() => toggle(c.key)}>
                        {c.label}
                        {sort.key === c.key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                      </button>
                    </th>
                  ))}
                  <th scope="col">Strom L1 / L2 / L3</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.label} className={r.fault ? 'live-row--fault' : undefined}>
                    <th scope="row">{r.label}</th>
                    <td>{r.status ?? '–'}</td>
                    <td className="live-num">{fmt(r.setpointA, 'A')}</td>
                    <td className="live-num">{fmt(r.powerKw, 'kW')}</td>
                    <td>
                      {r.fault ? (
                        <StatusBadge status="warning">Störung</StatusBadge>
                      ) : (
                        <span className="live-muted">keine</span>
                      )}
                    </td>
                    <td className="live-num">
                      {r.currentA.map((a) => (a === null ? '–' : num.format(a))).join(' / ')} A
                    </td>
                  </tr>
                ))}
                {shown.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="live-muted">
                      Kein Ladepunkt entspricht dem Filter.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  );
}
