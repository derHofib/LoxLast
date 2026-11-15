import { describe, expect, it } from 'vitest';
import { HealthResponseSchema } from '@lastplan/protocol';
import { buildServer } from './server';

describe('GET /api/health', () => {
  it('antwortet mit gültigem Health-Schema', async () => {
    const app = buildServer();
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(HealthResponseSchema.parse(res.json())).toEqual({
      status: 'ok',
      service: 'lastplan-gateway',
      version: '0.1.0',
    });
    await app.close();
  });
});
