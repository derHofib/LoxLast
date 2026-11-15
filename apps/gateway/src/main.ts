import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ConfigError, loadConfig } from './config';
import { openDb } from './db';
import { Changelog } from './changelog';
import { CredentialStore } from './credential-store';
import { PairingService } from './pairing';
import { buildServer } from './server';

try {
  const config = loadConfig();
  mkdirSync(config.dataDir, { recursive: true });
  const db = openDb(join(config.dataDir, 'gateway.sqlite'));
  const pairing = new PairingService(db, {
    codeTtlMs: config.pairingCodeTtlMs,
    tokenTtlMs: config.tokenTtlMs,
  });
  const app = await buildServer({
    allowedOrigins: config.allowedOrigins,
    pairing,
    credentials: new CredentialStore(db, config.secretKey),
    changelog: new Changelog(db),
  });
  const address = await app.listen({ host: config.host, port: config.port });
  const { code, expiresAt } = pairing.issueCode();
  console.log(`LastPlan-Gateway (${config.profile}) läuft auf ${address}`);
  console.log(
    `Kopplungscode: ${code}  (gültig bis ${expiresAt.toLocaleTimeString('de-DE')}, einmalig)`,
  );
} catch (error) {
  console.error(error instanceof ConfigError ? `Konfigurationsfehler: ${error.message}` : error);
  process.exit(1);
}
