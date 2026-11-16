import type { LiveChargePoint, MiniserverStatus } from '@lastplan/protocol';
import { create } from 'zustand';

/**
 * Zustand der Live-Ansicht (Plan 9.1/9.2). Die Daten kommen aus einer `LiveSource`:
 * dem Gateway-WebSocket oder – klar gekennzeichnet – aus Demo-Fixtures.
 */
export type LiveConnection =
  | 'unpaired' // Gateway nicht gekoppelt
  | 'connecting' // WebSocket wird aufgebaut
  | 'connected' // WebSocket steht, Gateway antwortet
  | 'offline' // WebSocket getrennt (Wiederverbindung läuft)
  | 'error'; // Anmeldung abgelehnt o. Ä.

export interface LiveState {
  connection: LiveConnection;
  /** `true` = Werte stammen aus Demo-Fixtures, nicht vom Miniserver. */
  demo: boolean;
  miniserver: MiniserverStatus | null;
  /** Zeitpunkt der letzten empfangenen Werte (ISO). */
  lastValuesAt: string | null;
  /** Letzter Wert je Ladepunkt-Bezeichnung. */
  rows: Record<string, LiveChargePoint>;
  message: string | null;
}

export const initialLiveState: LiveState = {
  connection: 'unpaired',
  demo: false,
  miniserver: null,
  lastValuesAt: null,
  rows: {},
  message: null,
};

export const useLiveStore = create<LiveState>(() => ({ ...initialLiveState }));

export const resetLive = (): void => useLiveStore.setState({ ...initialLiveState });

export function applyUpdate(at: string, cp: LiveChargePoint): void {
  useLiveStore.setState((s) => ({
    rows: { ...s.rows, [cp.label]: cp },
    lastValuesAt: at,
  }));
}

/** Quelle liefert Werte; gibt eine Funktion zum Beenden zurück. */
export type LiveSource = (projectId: string) => () => void;
