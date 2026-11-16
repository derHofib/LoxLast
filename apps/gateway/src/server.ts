import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import {
  ChangelogQuerySchema,
  ClientMessageSchema,
  DeviceTestRequestSchema,
  MiniserverConfigRequestSchema,
  PairRequestSchema,
  ProjectIdSchema,
  WS_AUTH_TIMEOUT_MS,
  WS_PATH,
  type ChangelogResponse,
  type ErrorCode,
  type ErrorResponse,
  type HealthResponse,
  type MiniserverConfigResponse,
  type MiniserverStatus,
  type ServerMessage,
  type TokenResponse,
} from '@lastplan/protocol';
import { checkModel, type WallboxModel } from '@lastplan/wallbox-library';
import type { Changelog } from './changelog';
import { tcpProbe } from './clients/tcp-probe';
import type { MiniserverClient, ModbusClient } from './clients/types';
import { runDeviceTest } from './device-test';
import type { ModelLibrary } from './library';
import type { CredentialStore } from './credential-store';
import type { IssuedToken, PairingService } from './pairing';

export const GATEWAY_VERSION = '0.1.0';
export const MINISERVER_CREDENTIAL_ID = 'miniserver';

export interface ServerDeps {
  allowedOrigins: string[];
  pairing: PairingService;
  credentials: CredentialStore;
  changelog: Changelog;
  /** Fehlt der Client (noch keine echte Implementierung), meldet die API „getrennt“. */
  miniserver?: MiniserverClient;
  /** Modbus-Client für den Geräte-Test. Fehlt er, antwortet `/api/devices/test` mit 501. */
  modbus?: ModbusClient;
  /** Wallbox-Bibliothek des Gateways (Quelle der Register, ADR 0012). */
  library?: ModelLibrary;
  /** TCP-Erreichbarkeit ohne Modbus-Anfrage; Standard: `tcpProbe`. */
  probe?: (host: string, port: number) => Promise<number>;
  /** Geräte-Tests pro Minute und IP. Standard 30. */
  deviceTestsPerMinute?: number;
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
  const app = Fastify({ logger: false, forceCloseConnections: true });
  const allowed = new Set(deps.allowedOrigins);

  // CORS: nur exakt freigegebene Origins. Anfragen ohne Origin (curl, gleiche Herkunft) bleiben möglich;
  // geschützte Routen verlangen trotzdem ein Token. Der Hook gilt auch für den WebSocket-Upgrade.
  await app.register(cors, {
    origin: (origin, cb) => cb(null, origin === undefined || allowed.has(origin)),
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Authorization', 'Content-Type'],
    maxAge: 600,
  });
  app.addHook('onRequest', async (req, reply) => {
    const origin = req.headers.origin;
    // WebSocket-Upgrades prüft der Handler selbst (sauberer Close-Code statt hängender Upgrade-Antwort).
    if (req.headers.upgrade?.toLowerCase() === 'websocket') return undefined;
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
  const actor = (req: FastifyRequest): string | undefined => {
    const token = bearer(req);
    return token ? deps.pairing.actorOf(token) : undefined;
  };

  app.get('/api/health', async (): Promise<HealthResponse> => ({
    status: 'ok',
    service: 'lastplan-gateway',
    version: GATEWAY_VERSION,
  }));

  app.post(
    '/api/auth/pair',
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
      deps.changelog.record({
        action: 'pairing.success',
        actor: deps.pairing.actorOf(issued.token),
      });
      return toTokenResponse(issued);
    },
  );

  app.post('/api/auth/refresh', { preHandler: requireAuth }, async (req, reply) => {
    const old = bearer(req) as string;
    const issued = deps.pairing.refresh(old);
    if (!issued)
      return reply.code(401).send(err('unauthorized', 'Token abgelaufen. Gateway neu koppeln.'));
    deps.changelog.record({ action: 'token.refresh', actor: deps.pairing.actorOf(issued.token) });
    return toTokenResponse(issued);
  });

  // Miniserver-Zugang: Passwort wird nur geschrieben, nie zurückgegeben (Kap. 12).
  app.post('/api/miniserver', { preHandler: requireAuth }, async (req, reply) => {
    const body = MiniserverConfigRequestSchema.safeParse(req.body);
    if (!body.success) {
      return reply
        .code(400)
        .send(err('invalid_request', body.error.issues[0]?.message ?? 'Eingabe ungültig.'));
    }
    const { host, user, password } = body.data;
    const { created } = deps.credentials.set(MINISERVER_CREDENTIAL_ID, 'miniserver', host, {
      host,
      username: user,
      password,
    });
    deps.changelog.record({
      action: 'miniserver.configure',
      actor: actor(req),
      target: MINISERVER_CREDENTIAL_ID,
      after: { host, user, created },
    });
    const res: MiniserverConfigResponse = { configured: true, host, user };
    return reply.code(created ? 201 : 200).send(res);
  });

  app.get(
    '/api/miniserver/status',
    { preHandler: requireAuth },
    async (): Promise<MiniserverStatus & { configured: boolean }> => {
      const configured = deps.credentials.getMeta(MINISERVER_CREDENTIAL_ID) !== undefined;
      const state = deps.miniserver?.state ?? 'disconnected';
      // Zeitstempel letzter Werte und Fehlerzustand kommen mit der echten Implementierung (Meilenstein 9).
      return { state, lastValuesAt: null, configured };
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/projects/:id/changelog',
    { preHandler: requireAuth },
    async (req, reply): Promise<ChangelogResponse | undefined> => {
      const id = ProjectIdSchema.safeParse(req.params.id);
      const q = ChangelogQuerySchema.safeParse(req.query);
      if (!id.success || !q.success) {
        await reply
          .code(400)
          .send(err('invalid_request', 'Projekt-ID oder Abfrage ungültig (limit 1–500).'));
        return undefined;
      }
      return {
        entries: deps.changelog.list({
          limit: q.data.limit,
          beforeId: q.data.beforeId,
          projectId: id.data,
        }),
      };
    },
  );

  // Spezifiziert (packages/protocol), aber erst mit Hardware bzw. Meilenstein 9 umsetzbar.
  const notImplemented = async (_req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    await reply
      .code(501)
      .send(
        err('not_implemented', 'Noch nicht verfügbar: benötigt Test-Wallbox bzw. Test-Miniserver.'),
      );
  };
  // Geräte-Test (Kap. 8.1/8.2, ADR 0012): nur lesen, Register nur aus der Bibliothek.
  const modbus = deps.modbus;
  if (modbus) {
    if (modbus.close) app.addHook('onClose', async () => modbus.close?.());
    app.post(
      '/api/devices/test',
      {
        preHandler: requireAuth,
        config: { rateLimit: { max: deps.deviceTestsPerMinute ?? 30, timeWindow: '1 minute' } },
      },
      async (req, reply) => {
        const body = DeviceTestRequestSchema.safeParse(req.body);
        if (!body.success) {
          const issue = body.error.issues[0];
          return reply
            .code(400)
            .send(
              err(
                'invalid_request',
                `Eingabe ungültig${issue ? ` (${issue.path.join('.')}: ${issue.message})` : ''}.`,
              ),
            );
        }
        const { endpoint, libraryModelId } = body.data;
        let model: WallboxModel | undefined;
        let modelSource: 'request' | 'gateway' | null = null;
        if (body.data.model) {
          const check = checkModel(body.data.model);
          if (check.status === 'invalid' || !check.model) {
            const first = check.issues[0];
            return reply
              .code(400)
              .send(
                err(
                  'invalid_request',
                  `Mitgeschickte Modelldatei ist ungültig${first ? ` (${first.path} ${first.message})` : ''}.`,
                ),
              );
          }
          if (check.model.id !== libraryModelId) {
            return reply
              .code(400)
              .send(
                err(
                  'invalid_request',
                  `Modelldatei „${check.model.id}“ passt nicht zu „${libraryModelId}“.`,
                ),
              );
          }
          model = check.model;
          modelSource = 'request';
        } else {
          model = deps.library?.get(libraryModelId);
          if (model) modelSource = 'gateway';
        }
        return runDeviceTest(
          { endpoint, modelId: libraryModelId, model, modelSource },
          { modbus, probe: deps.probe ?? ((host, port) => tcpProbe(host, port)) },
        );
      },
    );
  } else {
    app.post('/api/devices/test', { preHandler: requireAuth }, notImplemented);
  }
  app.get('/api/projects/:id/live', { preHandler: requireAuth }, notImplemented);
  app.post('/api/projects/:id/parameters', { preHandler: requireAuth }, notImplemented);
  app.post(
    '/api/projects/:id/changelog/:entryId/revert',
    { preHandler: requireAuth },
    notImplemented,
  );

  // WebSocket: erste Nachricht muss `auth` sein (Token nie in der URL).
  app.get(WS_PATH, { websocket: true }, (socket, req) => {
    const origin = req.headers.origin;
    if (origin !== undefined && !allowed.has(origin)) {
      socket.send(
        JSON.stringify({
          type: 'error',
          code: 'forbidden_origin',
          message: `Origin „${origin}“ ist nicht freigegeben.`,
        } satisfies ServerMessage),
      );
      socket.close(4403, 'forbidden_origin');
      return;
    }
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
