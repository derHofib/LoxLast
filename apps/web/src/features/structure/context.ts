import type { Finding, ProjectAnalysis } from '@lastplan/core';
import { createContext, useContext } from 'react';

/** Von der Ansicht an die Knoten gereichte Daten (Meldungen je Element, Berechnung, Rückmeldung). */
export interface StructureContextValue {
  findingsByTarget: ReadonlyMap<string, Finding[]>;
  analysis: ProjectAnalysis | null;
  announce: (message: string) => void;
}

export const StructureContext = createContext<StructureContextValue>({
  findingsByTarget: new Map(),
  analysis: null,
  announce: () => undefined,
});

export const useStructureContext = () => useContext(StructureContext);

export function topFinding(findings: readonly Finding[] | undefined): Finding | undefined {
  return findings?.find((f) => f.severity === 'error') ?? findings?.[0];
}
