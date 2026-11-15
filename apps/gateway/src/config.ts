import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';

export type Profile = 'local' | 'server';

export interface GatewayConfig {
  profile: Profile;
  host: string;
  port: number;
  /** Exakte Origins (Schema + Host + Port), die die API aufrufen dürfen. */
  allowedOrigins: string[];
  dataDir: string;
  /** 32 Byte für AES-256-GCM */
  secretKey: Buffer;
  tokenTtlMs: number;
  pairingCodeTtlMs: number;
}

export class ConfigError extends Error {}

const LOCAL_DEFAULT_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'];

function parseKey(raw: string): Buffer {
  const trimmed = raw.trim();
  const key = /^[0-9a-fA-F]{64}$/.test(trimmed)
    ? Buffer.from(trimmed, 'hex')
    : Buffer.from(trimmed, 'base64');
  if (key.length !== 32) {
    throw new ConfigError(
      'GATEWAY_SECRET_KEY muss 32 Byte lang sein (64 Hex-Zeichen oder Base64). ' +
        'Erzeugen mit: openssl rand -hex 32',
    );
  }
  return key;
}

/** Lokales Profil ohne Schlüssel: einmalig eine Schlüsseldatei (0600) im Datenverzeichnis anlegen. */
function loadOrCreateKeyFile(dataDir: string): Buffer {
  const path = join(dataDir, 'secret.key');
  if (existsSync(path)) return parseKey(readFileSync(path, 'utf8'));
  mkdirSync(dirname(path), { recursive: true });
  const key = randomBytes(32);
  writeFileSync(path, key.toString('hex'), { mode: 0o600 });
  chmodSync(path, 0o600);
  return key;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): GatewayConfig {
  const profileRaw = env['GATEWAY_PROFILE'] ?? 'local';
  if (profileRaw !== 'local' && profileRaw !== 'server') {
    throw new ConfigError(`GATEWAY_PROFILE „${profileRaw}“ ist ungültig. Erlaubt: local, server.`);
  }
  const profile: Profile = profileRaw;
  const dataDir = env['GATEWAY_DATA_DIR'] ?? './data';

  const origins = (env['GATEWAY_ALLOWED_ORIGINS'] ?? '')
    .split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean);
  for (const origin of origins) {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new ConfigError(`GATEWAY_ALLOWED_ORIGINS: „${origin}“ ist keine gültige Origin.`);
    }
    if (origin === '*' || parsed.origin !== origin) {
      throw new ConfigError(
        `GATEWAY_ALLOWED_ORIGINS: „${origin}“ muss genau Schema, Host und ggf. Port enthalten (z. B. https://lastplan.example.de).`,
      );
    }
  }

  let secretKey: Buffer;
  const rawKey = env['GATEWAY_SECRET_KEY'];
  if (rawKey) secretKey = parseKey(rawKey);
  else if (profile === 'local') secretKey = loadOrCreateKeyFile(dataDir);
  else
    throw new ConfigError(
      'Im Profil „server“ ist GATEWAY_SECRET_KEY Pflicht (openssl rand -hex 32, in .env eintragen).',
    );

  if (profile === 'server' && origins.length === 0) {
    throw new ConfigError(
      'Im Profil „server“ ist GATEWAY_ALLOWED_ORIGINS Pflicht (Origin der Web-App, kommagetrennt).',
    );
  }

  return {
    profile,
    // Lokal nur Loopback (Kap. 8.5); Server-Profil lauscht im Container auf allen Schnittstellen.
    host: env['GATEWAY_HOST'] ?? (profile === 'local' ? '127.0.0.1' : '0.0.0.0'),
    port: Number(env['GATEWAY_PORT'] ?? 8787),
    allowedOrigins: origins.length > 0 ? origins : LOCAL_DEFAULT_ORIGINS,
    dataDir,
    secretKey,
    tokenTtlMs: Number(env['GATEWAY_TOKEN_TTL_MIN'] ?? 60) * 60_000,
    pairingCodeTtlMs: Number(env['GATEWAY_PAIRING_CODE_TTL_MIN'] ?? 10) * 60_000,
  };
}
