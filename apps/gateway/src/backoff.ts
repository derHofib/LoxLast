/** Exponentielles Backoff mit Obergrenze (Kap. 8.4). `jitter` ∈ [0,1) streut die Wartezeit nach unten. */
export function backoffDelayMs(
  attempt: number,
  opts: { baseMs?: number; maxMs?: number; jitter?: number } = {},
): number {
  const { baseMs = 1000, maxMs = 30_000, jitter = 0 } = opts;
  if (!Number.isInteger(attempt) || attempt < 0)
    throw new RangeError('attempt muss eine ganze Zahl ≥ 0 sein');
  const raw = Math.min(maxMs, baseMs * 2 ** Math.min(attempt, 30));
  return Math.round(raw * (1 - jitter * 0.5));
}
