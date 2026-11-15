import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { ServerMessageSchema, type ServerMessage } from '@lastplan/protocol';
import { makeServer, pairedToken } from './test-helpers';

type Ctx = Awaited<ReturnType<typeof makeServer>>;
let ctx: Ctx;
afterEach(async () => ctx.app.close());

async function connect(): Promise<{
  ws: WebSocket;
  next: () => Promise<ServerMessage>;
  closed: Promise<number>;
}> {
  const address = await ctx.app.listen({ port: 0, host: '127.0.0.1' });
  const ws = new WebSocket(address.replace('http', 'ws') + '/ws');
  const queue: ServerMessage[] = [];
  const waiters: ((m: ServerMessage) => void)[] = [];
  ws.on('message', (d) => {
    const m = ServerMessageSchema.parse(JSON.parse(d.toString()));
    const w = waiters.shift();
    if (w) w(m);
    else queue.push(m);
  });
  const closed = new Promise<number>((res) => ws.on('close', (code) => res(code)));
  await new Promise((res) => ws.on('open', res));
  return {
    ws,
    closed,
    next: () =>
      new Promise((res) => {
        const m = queue.shift();
        if (m) res(m);
        else waiters.push(res);
      }),
  };
}

describe('WebSocket /ws', () => {
  it('auth → ready → ping/pong', async () => {
    ctx = await makeServer();
    const token = await pairedToken(ctx);
    const c = await connect();
    c.ws.send(JSON.stringify({ type: 'auth', token }));
    expect((await c.next()).type).toBe('ready');
    c.ws.send(JSON.stringify({ type: 'ping', nonce: 'n1' }));
    expect(await c.next()).toEqual({ type: 'pong', nonce: 'n1' });
    c.ws.send(JSON.stringify({ type: 'ping' }));
    expect(await c.next()).toEqual({ type: 'pong' });
    c.ws.send('kein json');
    expect((await c.next()).type).toBe('error');
    c.ws.close();
  });

  it('falsches Token → Fehler und Schließen (4401)', async () => {
    ctx = await makeServer();
    const c = await connect();
    c.ws.send(JSON.stringify({ type: 'auth', token: 'x'.repeat(40) }));
    expect(await c.next()).toMatchObject({ type: 'error', code: 'unauthorized' });
    expect(await c.closed).toBe(4401);
  });

  it('Nachricht vor auth → Schließen', async () => {
    ctx = await makeServer();
    const c = await connect();
    c.ws.send(JSON.stringify({ type: 'ping' }));
    expect(await c.next()).toMatchObject({ type: 'error', code: 'unauthorized' });
    expect(await c.closed).toBe(4401);
  });

  it('fremde Origin wird nach dem Upgrade mit 4403 geschlossen', async () => {
    ctx = await makeServer();
    const address = await ctx.app.listen({ port: 0, host: '127.0.0.1' });
    const ws = new WebSocket(address.replace('http', 'ws') + '/ws', {
      origin: 'https://evil.example',
    });
    const messages: string[] = [];
    ws.on('message', (d) => messages.push(d.toString()));
    const code = await new Promise<number>((res) => ws.on('close', (c) => res(c)));
    expect(code).toBe(4403);
    expect(messages[0]).toContain('forbidden_origin');
  });

  it('freigegebene Origin darf verbinden', async () => {
    ctx = await makeServer();
    const address = await ctx.app.listen({ port: 0, host: '127.0.0.1' });
    const ws = new WebSocket(address.replace('http', 'ws') + '/ws', {
      origin: 'http://localhost:5173',
    });
    await new Promise((res) => ws.on('open', res));
    ws.close();
  });
});
