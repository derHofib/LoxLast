import { describe, expect, it } from 'vitest';
import { PHASE_ROTATIONS } from '../model';
import {
  PHASES,
  gridPhaseOf,
  loadedPhases,
  phaseValues,
  rotationForPhase1,
  spread,
} from './phases';

describe('Phasenzuordnung (Kap. 4.2)', () => {
  it.each([
    ['L1-L2-L3', ['L1', 'L2', 'L3']],
    ['L2-L3-L1', ['L2', 'L3', 'L1']],
    ['L3-L1-L2', ['L3', 'L1', 'L2']],
  ] as const)('%s', (rotation, expected) => {
    expect([1, 2, 3].map((v) => gridPhaseOf(rotation, v as 1 | 2 | 3))).toEqual(expected);
  });

  it('rotationForPhase1 ist die Umkehrung für Fahrzeugphase 1', () => {
    for (const phase of PHASES) expect(gridPhaseOf(rotationForPhase1(phase), 1)).toBe(phase);
    for (const rotation of PHASE_ROTATIONS)
      expect(rotationForPhase1(gridPhaseOf(rotation, 1))).toBe(rotation);
  });

  it('belastete Phasen', () => {
    expect(loadedPhases({ phases: 3, phaseRotation: 'L2-L3-L1' })).toEqual(['L1', 'L2', 'L3']);
    expect(loadedPhases({ phases: 3, phaseRotation: 'L2-L3-L1' }, 1)).toEqual(['L2']);
    expect(loadedPhases({ phases: 1, phaseRotation: 'L3-L1-L2' }, 3)).toEqual(['L3']);
  });

  it('Schieflast', () => expect(spread(phaseValues(48, 32, 20))).toBe(28));
});
