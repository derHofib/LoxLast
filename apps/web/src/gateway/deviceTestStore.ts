import type { ChargePoint } from '@lastplan/core';
import type { DeviceTestResponse } from '@lastplan/protocol';
import type { WallboxModel } from '@lastplan/wallbox-library';
import { create } from 'zustand';
import { GatewayError, requestDeviceTest } from './gatewayStore';

/** Ergebnis je Ladepunkt (nur für diese Sitzung, nicht im Projekt). */
export type DeviceTestState =
  | { status: 'running' }
  | { status: 'done'; result: DeviceTestResponse }
  | { status: 'failed'; message: string };

export const useDeviceTestStore = create<{ byId: Record<string, DeviceTestState> }>(() => ({
  byId: {},
}));

const set = (id: string, state: DeviceTestState) =>
  useDeviceTestStore.setState((s) => ({ byId: { ...s.byId, [id]: state } }));

/**
 * Verbindungstest für einen Ladepunkt. Die Modelldatei der aktuell genutzten Bibliothek wird
 * mitgeschickt, damit das Gateway dieselben Register verwendet wie die Anzeige (ADR 0012).
 */
export async function testChargePoint(
  cp: ChargePoint,
  model: WallboxModel | undefined,
): Promise<void> {
  set(cp.id, { status: 'running' });
  try {
    const result = await requestDeviceTest({
      endpoint: cp.network,
      libraryModelId: cp.libraryModelId,
      ...(model ? { model: model as unknown as Record<string, unknown> } : {}),
    });
    set(cp.id, { status: 'done', result });
  } catch (error) {
    set(cp.id, {
      status: 'failed',
      message: error instanceof GatewayError ? error.message : 'Verbindungstest fehlgeschlagen.',
    });
  }
}

export function resetDeviceTests(): void {
  useDeviceTestStore.setState({ byId: {} });
}
