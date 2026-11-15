import { describe, expect, it } from 'vitest';
import { HealthResponseSchema } from './index';

describe('HealthResponseSchema', () => {
  it('akzeptiert gültige Antwort', () =>
    expect(
      HealthResponseSchema.safeParse({
        status: 'ok',
        service: 'lastplan-gateway',
        version: '0.1.0',
      }).success,
    ).toBe(true));
  it('lehnt fremde Dienste ab', () =>
    expect(
      HealthResponseSchema.safeParse({ status: 'ok', service: 'x', version: '0.1.0' }).success,
    ).toBe(false));
});
