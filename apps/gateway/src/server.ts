import Fastify, { type FastifyInstance } from 'fastify';
import type { HealthResponse } from '@lastplan/protocol';

export const GATEWAY_VERSION = '0.1.0';

/**
 * Gateway-Server. Meilenstein 1: nur Health-Check.
 * Pairing, Geräte-Test, Miniserver-Anbindung und WebSocket folgen mit Meilenstein 8.
 */
export function buildServer(): FastifyInstance {
  const app = Fastify({ logger: false });
  app.get('/api/health', async (): Promise<HealthResponse> => ({
    status: 'ok',
    service: 'lastplan-gateway',
    version: GATEWAY_VERSION,
  }));
  return app;
}
