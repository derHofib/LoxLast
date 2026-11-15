import { randomBytes } from 'node:crypto';
import { openDb } from './db';
import { Changelog } from './changelog';
import { CredentialStore } from './credential-store';
import { PairingService } from './pairing';
import { buildServer, type ServerDeps } from './server';

export async function makeServer(over: Partial<ServerDeps> = {}) {
  const db = openDb(':memory:');
  const key = randomBytes(32);
  const pairing = new PairingService(db, { codeTtlMs: 600_000, tokenTtlMs: 3_600_000 });
  const credentials = new CredentialStore(db, key);
  const changelog = new Changelog(db);
  const app = await buildServer({
    allowedOrigins: ['http://localhost:5173'],
    pairing,
    credentials,
    changelog,
    ...over,
  });
  return { app, db, key, pairing, credentials, changelog };
}

export async function pairedToken(ctx: Awaited<ReturnType<typeof makeServer>>): Promise<string> {
  const { code } = ctx.pairing.issueCode();
  const res = await ctx.app.inject({ method: 'POST', url: '/api/pair', payload: { code } });
  return (res.json() as { token: string }).token;
}
