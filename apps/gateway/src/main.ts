import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ConfigError, loadConfig } from './config';
import { openDb } from './db';
import { Changelog } from './changelog';
import { ModbusTcpClient } from './clients/modbus-tcp';
import { defaultLibraryDir, loadLibraryDir } from './library';
import { CredentialStore } from './credential-store';
import { PairingService } from './pairing';
import { buildServer, GATEWAY_VERSION } from './server';
import { createConfigMcpClient } from './config-mcp/client';

try {
  const config = loadConfig();
  mkdirSync(config.dataDir, { recursive: true });
  const db = openDb(join(config.dataDir, 'gateway.sqlite'));
  const pairing = new PairingService(db, {
    codeTtlMs: config.pairingCodeTtlMs,
    tokenTtlMs: config.tokenTtlMs,
  });
  const libraryDir = process.env['GATEWAY_LIBRARY_DIR'] ?? defaultLibraryDir();
  const library = loadLibraryDir(libraryDir);
  const app = await buildServer({
    allowedOrigins: config.allowedOrigins,
    modbus: new ModbusTcpClient(),
    library,
    pairing,
    credentials: new CredentialStore(db, config.secretKey),
    changelog: new Changelog(db),
    configMcp: config.configMcpUrl
      ? createConfigMcpClient(config.configMcpUrl, GATEWAY_VERSION)
      : undefined,
  });
  const address = await app.listen({ host: config.host, port: config.port });
  const { code, expiresAt } = pairing.issueCode();
  console.log(`LastPlan-Gateway (${config.profile}) läuft auf ${address}`);
  console.log(
    config.configMcpUrl
      ? `Loxone Config (MCP): ${config.configMcpUrl.href}`
      : 'Loxone Config (MCP): abgeschaltet (CONFIG_MCP_URL=off)',
  );
  console.log(`Wallbox-Bibliothek: ${library.size} Modell(e) aus ${libraryDir}`);
  console.log(
    `Kopplungscode: ${code}  (gültig bis ${expiresAt.toLocaleTimeString('de-DE')}, einmalig)`,
  );
} catch (error) {
  console.error(error instanceof ConfigError ? `Konfigurationsfehler: ${error.message}` : error);
  process.exit(1);
}
