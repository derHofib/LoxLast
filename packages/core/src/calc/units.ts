/**
 * Einheiten und Anzeigeformat (Kap. 4.6).
 * Anzeige: deutsches Zahlenformat (Komma), höchstens eine Nachkommastelle, Einheit immer sichtbar.
 */

const numberFormat = new Intl.NumberFormat('de-DE', {
  maximumFractionDigits: 1,
  useGrouping: true,
});

/** Leistung in kW aus Strom je Phase: P = I · U · Phasen / 1000 (Wirkleistung, cos φ = 1). */
export function kwFromA(currentA: number, phases: 1 | 3, voltageV: number): number {
  return (currentA * voltageV * phases) / 1000;
}

/** Strom je Phase in A aus Leistung in kW (Umkehrung von kwFromA). */
export function aFromKw(powerKw: number, phases: 1 | 3, voltageV: number): number {
  return (powerKw * 1000) / (voltageV * phases);
}

/** Rundet für die Anzeige auf eine Nachkommastelle (kaufmännisch, symmetrisch um 0). */
export function roundForDisplay(value: number): number {
  const rounded = (Math.sign(value) * Math.round(Math.abs(value) * 10)) / 10;
  return Object.is(rounded, -0) ? 0 : rounded;
}

/** „1.234,5“ – deutsches Format, max. eine Nachkommastelle. */
export function formatNumber(value: number): string {
  return numberFormat.format(roundForDisplay(value));
}

/** „7,5 A“ (geschütztes Leerzeichen zwischen Zahl und Einheit). */
export function formatA(value: number): string {
  return `${formatNumber(value)}\u00a0A`;
}

/** „22 kW“ */
export function formatKw(value: number): string {
  return `${formatNumber(value)}\u00a0kW`;
}
