import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import {
  ChangelogQuerySchema,
  ClientMessageSchema,
  CredentialIdSchema,
  CredentialWriteSchema,
  PairRequestSchema,
  WS_AUTH_TIMEOUT_MS,
  type ChangelogResponse,
  type CredentialListResponse,
  type ErrorCode,
  type ErrorResponse,
  type HealthResponse,
  type ServerMessage,
  type TokenResponse,
} from '@lastplan/protocol';
import type { Changelog } from './changelog';
import type { CredentialStore } from './credential-store';
import type { PairingService } from './pairing';
import { type IssuedToken } from './pairing';

export const GATEWAY_VERSION = '0.1.0';

export interface ServerDeps {
  allowedOrigins: string[];
  pairing: PairingService;
  credentials: CredentialStore;
  changelog: Changelog;
  /** Anfragen pro Minute und IP (global). Standard 120. */
  rateLimitPerMinute?: number;
  /** Pairing-Versuche pro Minute und IP. Standard 5. */
  pairingAttemptsPerMinute?: number;
}

const err = (code: ErrorCode, message: string): ErrorResponse => ({ error: { code, message } });
const toTokenResponse = (t: IssuedToken): TokenResponse => ({
  token: t.token,
  expiresAt: t.expiresAt.toISOString(),
});

function bearer(req: FastifyRequest): string | undefined {
  const h = req.headers.authorization;
  return h?.startsWith('Bearer ') ? h.slice(7) : undefined;
}

export async function buildServer(deps: ServerDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const allowed = new Set(deps.allowedOrigins);

  // CORS: nur exakt freigegebene Origins. Anfragen ohne Origin (curl, gleiche Herkunft) bleiben möglich;
  // geschützte Routen verlangen trotzdem ein Token.
  await app.register(cors, {
    origin: (origin, cb) => cb(null, origin === undefined || allowed.has(origin)),
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Authorization', 'Content-Type'],
    maxAge: 600,
  });
  app.addHook('onRequest', async (req, reply) => {
    const origin = req.headers.origin;
    if (origin !== undefined && !allowed.has(origin)) {
      return reply
        .code(403)
        .send(
          err(
            'forbidden_origin',
            `Origin „${origin}“ ist nicht freigegeben. In GATEWAY_ALLOWED_ORIGINS eintragen.`,
          ),
        );
    }
    return undefined;
  });

  await app.register(rateLimit, {
    max: deps.rateLimitPerMinute ?? 120,
    timeWindow: '1 minute',
    errorResponseBuilder: () => Object.assign(new Error('rate_limited'), { statusCode: 429 }),
  });
  app.setErrorHandler((error: { statusCode?: number; message: string }, _req, reply) => {
    if (error.statusCode === 429) {
      return reply
        .code(429)
        .send(err('rate_limited', 'Zu viele Anfragen. Bitte kurz warten und erneut versuchen.'));
    }
    if (error.statusCode !== undefined && error.statusCode < 500) {
      return reply.code(error.statusCode).send(err('invalid_request', 'Anfrage ungültig.'));
    }
    return reply.code(500).send(err('internal_error', 'Interner Fehler im Gateway.'));
  });
  await app.register(websocket, { options: { maxPayload: 16 * 1024 } });

  const requireAuth = async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const token = bearer(req);
    if (!token || !deps.pairing.verify(token)) {
      await reply
        .code(401)
        .send(
          err(
            'unauthorized',
            'Nicht angemeldet oder Token abgelaufen. Gateway neu koppeln (Einmalcode).',
          ),
        );
    }
  };

  app.get('/api/health', async (): Promise<HealthResponse> => ({
    status: 'ok',
    service: 'lastplan-gateway',
    version: GATEWAY_VERSION,
  }));

  app.post(
    '/api/pair',
    { config: { rateLimit: { max: deps.pairingAttemptsPerMinute ?? 5, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const body = PairRequestSchema.safeParse(req.body);
      if (!body.success) {
        return reply
          .code(400)
          .send(err('invalid_request', 'Code muss das Format XXXX-XXXX haben.'));
      }
      const issued = deps.pairing.redeem(body.data.code);
      if (!issued) {
        return reply
          .code(401)
          .send(
            err(
              'pairing_code_invalid',
              'Code ungültig oder abgelaufen. Gateway neu starten, um einen neuen Code zu erhalten.',
            ),
          );
      }
      deps.changelog.record('pairing.success', null, { ip: req.ip });
      return toTokenResponse(issued);
    },
  );

  app.post('/api/token/refresh', { preHandler: requireAuth }, async (req, reply) => {
    const issued = deps.pairing.refresh(bearer(req) as string);
    if (!issued)
      return reply.code(401).send(err('unauthorized', 'Token abgelaufen. Gateway neu koppeln.'));
    deps.changelog.record('token.refresh');
    return toTokenResponse(issued);
  });

  app.get(
    '/api/credentials',
    { preHandler: requireAuth },
    async (): Promise<CredentialListResponse> => ({
      credentials: deps.credentials.list(),
    }),
  );

  app.put<{ Params: { id: string } }>(
    '/api/credentials/:id',
    { preHandler: requireAuth },
    async (req, reply) => {
      const id = CredentialIdSchema.safeParse(req.params.id);
      const body = CredentialWriteSchema.safeParse(req.body);
      if (!id.success || !body.success) {
        return reply.code(400).send(err('invalid_request', 'ID oder Zugangsdaten ungültig.'));
      }
      const { meta, created } = deps.credentials.set(id.data, body.data);
      // Nur Metadaten ins Protokoll – nie das Passwort.
      deps.changelog.record('credential.set', id.data, { kind: meta.kind, created });
      return reply.code(created ? 201 : 200).send(meta);
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/credentials/:id',
    { preHandler: requireAuth },
    async (req, reply) => {
      const id = CredentialIdSchema.safeParse(req.params.id);
      if (!id.success) return reply.code(400).send(err('invalid_request', 'ID ungültig.'));
      if (!deps.credentials.delete(id.data)) {
        return reply.code(404).send(err('not_found', 'Zugangsdaten nicht gefunden.'));
      }
      deps.changelog.record('credential.delete', id.data);
      return reply.code(204).send();
    },
  );

  app.get(
    '/api/changelog',
    { preHandler: requireAuth },
    async (req, reply): Promise<ChangelogResponse | undefined> => {
      const q = ChangelogQuerySchema.safeParse(req.query);
      if (!q.success) {
        await reply.code(400).send(err('invalid_request', 'Ungültige Abfrage (limit 1–500).'));
        return undefined;
      }
      return { entries: deps.changelog.list(q.data.limit, q.data.beforeId) };
    },
  );

  // WebSocket: erste Nachricht muss `auth` sein (Token nie in der URL).
  app.get('/api/live', { websocket: true }, (socket) => {
    let authed = false;
    const send = (m: ServerMessage): void => socket.send(JSON.stringify(m));
    const timer = setTimeout(() => {
      if (!authed) {
        send({
          type: 'error',
          code: 'unauthorized',
          message: 'Keine Anmeldung innerhalb von 5 s.',
        });
        socket.close(4401, 'unauthorized');
      }
    }, WS_AUTH_TIMEOUT_MS);
    socket.on('close', () => clearTimeout(timer));
    socket.on('message', (raw: Buffer) => {
      let parsed;
      try {
        parsed = ClientMessageSchema.safeParse(JSON.parse(raw.toString()));
      } catch {
        parsed = undefined;
      }
      if (!parsed?.success) {
        send({ type: 'error', code: 'invalid_message', message: 'Nachricht ungültig.' });
        return;
      }
      const msg = parsed.data;
      if (!authed) {
        if (msg.type === 'auth' && deps.pairing.verify(msg.token)) {
          authed = true;
          clearTimeout(timer);
          send({ type: 'ready', serverTime: new Date().toISOString() });
        } else {
          send({ type: 'error', code: 'unauthorized', message: 'Zuerst anmelden (auth).' });
          socket.close(4401, 'unauthorized');
        }
        return;
      }
      if (msg.type === 'ping')
        send(msg.nonce === undefined ? { type: 'pong' } : { type: 'pong', nonce: msg.nonce });
    });
  });

  return app;
}
