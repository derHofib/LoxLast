import type { Project } from '@lastplan/core';
import type { LiveChargePoint } from '@lastplan/protocol';
import { applyUpdate, useLiveStore } from './liveStore';

/**
 * Demo-Werte aus den Ladepunkten des Projekts. Rein synthetisch und deterministisch: sie
 * stammen nicht vom Miniserver und sagen nichts über echte Statuscodes aus (Status = „Demo“).
 * Jeder dritte Ladepunkt ist als Störung markiert, damit die Darstellung prüfbar ist.
 */
export function demoRows(project: Project): LiveChargePoint[] {
  return project.chargePoints.map((cp, i) => {
    const fault = i % 3 === 2;
    const charging = !fault && i % 3 === 0;
    const setpoint = charging ? Math.min(cp.maxA, 16) : cp.minA;
    const phase = (n: number) => (charging ? setpoint - n : 0);
    return {
      label: cp.label,
      status: 'Demo',
      setpointA: fault ? null : setpoint,
      currentA: fault ? [null, null, null] : [phase(0), phase(0.4), phase(0.2)],
      powerKw: fault ? null : Math.round(phase(0.2) * 0.23 * cp.phases * 10) / 10,
      fault,
    };
  });
}

export function startDemoSource(project: Project): () => void {
  const at = new Date().toISOString();
  useLiveStore.setState({
    demo: true,
    connection: 'connected',
    message: null,
    miniserver: { state: 'connected', lastValuesAt: at },
    rows: {},
  });
  for (const row of demoRows(project)) applyUpdate(at, row);
  return () => undefined;
}
