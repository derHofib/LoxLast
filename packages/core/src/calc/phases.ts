import type { ChargePoint, PhaseRotation } from '../model';

/** Netzphasen */
export const PHASES = ['L1', 'L2', 'L3'] as const;
export type Phase = (typeof PHASES)[number];

/** Wert je Netzphase, z. B. Strom in A. */
export type PhaseValues = Record<Phase, number>;

export const phaseValues = (l1: number, l2 = l1, l3 = l1): PhaseValues => ({
  L1: l1,
  L2: l2,
  L3: l3,
});
export const ZERO: Readonly<PhaseValues> = Object.freeze(phaseValues(0));

/**
 * Phasenrotation → Netzphase je Fahrzeugphase (Kap. 4.2).
 * Index 0 = Fahrzeugphase 1.
 */
const ROTATION_MAP: Record<PhaseRotation, readonly [Phase, Phase, Phase]> = {
  'L1-L2-L3': ['L1', 'L2', 'L3'],
  'L2-L3-L1': ['L2', 'L3', 'L1'],
  'L3-L1-L2': ['L3', 'L1', 'L2'],
};

/** Netzphase, auf der Fahrzeugphase `vehiclePhase` liegt. */
export function gridPhaseOf(rotation: PhaseRotation, vehiclePhase: 1 | 2 | 3): Phase {
  return ROTATION_MAP[rotation][vehiclePhase - 1] as Phase;
}

/** Rotation, bei der Fahrzeugphase 1 auf `phase` liegt (Umkehrung für die Optimierung). */
export function rotationForPhase1(phase: Phase): PhaseRotation {
  return phase === 'L1' ? 'L1-L2-L3' : phase === 'L2' ? 'L2-L3-L1' : 'L3-L1-L2';
}

/**
 * Netzphasen, die ein Ladepunkt belastet.
 * - 1-phasig angeschlossen: immer nur die Phase von Fahrzeugphase 1.
 * - 3-phasig angeschlossen, 1-phasig ladendes Fahrzeug: ebenfalls nur diese Phase.
 * - 3-phasig angeschlossen und ladend: alle drei.
 */
export function loadedPhases(
  cp: Pick<ChargePoint, 'phases' | 'phaseRotation'>,
  vehiclePhases: 1 | 3 = 3,
): readonly Phase[] {
  if (cp.phases === 1 || vehiclePhases === 1) return [gridPhaseOf(cp.phaseRotation, 1)];
  return PHASES;
}

export function maxPhase(values: PhaseValues): number {
  return Math.max(values.L1, values.L2, values.L3);
}

export function minPhase(values: PhaseValues): number {
  return Math.min(values.L1, values.L2, values.L3);
}

/** Schieflast: größte Differenz zwischen zwei Phasen. */
export function spread(values: PhaseValues): number {
  return maxPhase(values) - minPhase(values);
}
