import { PHASE_ROTATIONS, type ChargePointProtocol, type PhaseRotation } from '../model';

/**
 * Wertumwandlung für den CSV-Import. Alle Funktionen liefern `undefined`, wenn der Text nicht
 * eindeutig lesbar ist – dann meldet die Validierung einen Fehler, statt zu raten.
 */

/**
 * Liest eine Zahl in deutscher oder englischer Schreibweise, optional mit Einheit:
 * „16“, „16,0“, „16 A“, „16.5“, „6,5A“. Tausendertrennzeichen werden nicht akzeptiert
 * (bei Strömen, Ports und IDs mehrdeutig).
 */
export function parseDecimal(text: string, unit?: string): number | undefined {
  let t = text.trim().replace(/\s+/g, ' ');
  if (unit !== undefined) {
    const u = unit.toLowerCase();
    if (t.toLowerCase().endsWith(u)) t = t.slice(0, -u.length).trim();
  }
  if (!/^[+-]?\d+([.,]\d+)?$/.test(t)) return undefined;
  return Number(t.replace(',', '.'));
}

/** Ganze Zahl; „502,0“ ist erlaubt, „502,5“ nicht. */
export function parseInteger(text: string): number | undefined {
  const n = parseDecimal(text);
  return n !== undefined && Number.isInteger(n) ? n : undefined;
}

/**
 * Strenge IPv4-Prüfung: vier Blöcke 0–255, keine führenden Nullen (würden von manchen Geräten
 * oktal gelesen) und keine Leerzeichen im Inneren.
 */
export function parseIpv4(text: string): string | undefined {
  const t = text.trim();
  const parts = t.split('.');
  if (parts.length !== 4) return undefined;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p) || (p.length > 1 && p.startsWith('0')) || Number(p) > 255)
      return undefined;
  }
  return t;
}

/**
 * Phasenlage: „L1-L2-L3“, „L2 L3 L1“, „l3/l1/l2“, „231“. Nur die drei zyklischen Rotationen sind
 * gültig (Kap. 4.2); „L1-L3-L2“ würde das Drehfeld umkehren und wird abgelehnt.
 */
export function parsePhaseRotation(text: string): PhaseRotation | undefined {
  const compact = text
    .trim()
    .toUpperCase()
    .replace(/[\s\-/,;.>|]+/g, '');
  const m = /^L?([123])L?([123])L?([123])$/.exec(compact);
  if (!m) return undefined;
  const candidate = `L${m[1]}-L${m[2]}-L${m[3]}`;
  return PHASE_ROTATIONS.find((r) => r === candidate);
}

/** Anschluss: 1 oder 3 Phasen („3“, „3-phasig“, „1p“, „einphasig“, „dreiphasig“). */
export function parsePhases(text: string): 1 | 3 | undefined {
  const t = text.trim().toLowerCase();
  if (/^(1|1p|1ph|1-phasig|1 phasig|einphasig|1-phase|single)$/.test(t)) return 1;
  if (/^(3|3p|3ph|3-phasig|3 phasig|dreiphasig|3-phase|three)$/.test(t)) return 3;
  const n = parseDecimal(t);
  return n === 1 || n === 3 ? n : undefined;
}

const TRUE_WORDS = new Set(['ja', 'j', 'yes', 'y', 'true', 'wahr', '1', 'x', 'an', 'ein', 'on']);
const FALSE_WORDS = new Set(['nein', 'n', 'no', 'false', 'falsch', '0', 'aus', 'off', '-']);

export function parseBoolean(text: string): boolean | undefined {
  const t = text.trim().toLowerCase();
  if (TRUE_WORDS.has(t)) return true;
  if (FALSE_WORDS.has(t)) return false;
  return undefined;
}

export function parseProtocol(text: string): ChargePointProtocol | undefined {
  const t = text
    .trim()
    .toLowerCase()
    .replace(/[\s_/-]+/g, '');
  if (t === 'modbustcp' || t === 'modbus') return 'modbus-tcp';
  if (t === 'http') return 'http';
  if (t === 'ocppbridge' || t === 'ocpp') return 'ocpp-bridge';
  return undefined;
}
