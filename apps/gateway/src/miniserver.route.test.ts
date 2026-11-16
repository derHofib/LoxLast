import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { ServerMessageSchema, type ServerMessage } from '@lastplan/protocol';
import { MiniserverWsClient, credentialsFromSecret } from './clients/miniserver';
import { MiniserverSimulator } from './clients/miniserver-simulator';
import { MINISERVER_CREDENTIAL_ID } from './server';
import { makeServer, pairedToken } from './test-helpers';

const UUID = '0f86a2fe-0378-3e08-ffff112233445566';

type Ctx = Awaited<ReturnType<typeof makeServer>>;
let ctx: Ctx | undefined;
let sim: MiniserverSimulator | undefined;
let client: MiniserverWsClient | undefined;

afterEach(async () => {
  await client?.disconnect();
  await ctx?.app.close();
  await sim?.stop();
  ctx = client = sim = undefined;
});

const until = async (cond: () => boolean, ms = 3000): Promise<void> => {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('Bedingung nicht erfüllt');
    await new Promise((r) => setTimeout(r, 10));
  }
};

describe('Miniserver im Gateway (Simulator)', () => {
  it('verbindet nach dem Speichern des Zugangs und meldet den Status per API und WebSocket', async () => {
    sim = new MiniserverSimulator({ values: { [UUID]: 4 } });
    const port = await sim.start();
    const holder: { store?: Ctx['credentials'] } = {};
    client = new MiniserverWsClient({
      credentials: () => credentialsFromSecret(holder.store?.getSecret(MINISERVER_CREDENTIAL_ID)),
      commandTimeoutMs: 1000,
    });
    ctx = await makeServer({ miniserver: client, live: client });
    holder.store = ctx.credentials;
    const headers = { authorization: `Bearer ${await pairedToken(ctx)}` };

    const s0 = await ctx.app.inject({ method: 'GET', url: '/api/miniserver/status', headers });
    expect(s0.json()).toMatchObject({ state: 'disconnected', configured: false });

    // WebSocket-Client der Web-App: erhält nach `ready` den aktuellen Status und jede Änderung.
    const address = await ctx.app.listen({ port: 0, host: '127.0.0.1' });
    const ws = new WebSocket(address.replace('http', 'ws') + '/ws');
    const msgs: ServerMessage[] = [];
    ws.on('message', (d) => msgs.push(ServerMessageSchema.parse(JSON.parse(d.toString()))));
    await new Promise((r) => ws.on('open', r));
    ws.send(JSON.stringify({ type: 'auth', token: headers.authorization.slice(7) }));
    await until(() => msgs.some((m) => m.type === 'miniserver.state'));

    const put = await ctx.app.inject({
      method: 'POST',
      url: '/api/miniserver',
      headers,
      payload: { host: '127.0.0.1', port, user: sim.user, password: sim.password },
    });
    expect(put.statusCode).toBe(201);
    expect(ctx.credentials.getSecret(MINISERVER_CREDENTIAL_ID)).toMatchObject({ port });

    await until(() => client?.state === 'connected');
    await until(() => client?.latest(UUID) === 4);
    const s1 = await ctx.app.inject({ method: 'GET', url: '/api/miniserver/status', headers });
    expect(s1.json()).toMatchObject({ state: 'connected', configured: true });
    expect(s1.json().lastValuesAt).not.toBeNull();
    await until(() =>
      msgs.some((m) => m.type === 'miniserver.state' && m.status.state === 'connected'),
    );
    expect(JSON.stringify(msgs)).not.toContain(sim.password);
    ws.close();
  });

  it('Zugangsdaten aus dem Credential-Store übernehmen', () => {
    expect(credentialsFromSecret(undefined)).toBeUndefined();
    expect(credentialsFromSecret({ password: 'x' })).toBeUndefined();
    expect(
      credentialsFromSecret({ host: 'h', username: 'u', password: 'p', port: 8080, tls: true }),
    ).toEqual({ host: 'h', user: 'u', password: 'p', port: 8080, tls: true });
    expect(credentialsFromSecret({ host: 'h', username: 'u', password: 'p' })).toEqual({
      host: 'h',
      user: 'u',
      password: 'p',
    });
  });
});
