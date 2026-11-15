import { buildServer } from './server';

// Profil „local“: standardmäßig nur localhost (Kap. 8.5). LAN/Server-Profil folgt mit Meilenstein 8.
const host = process.env['GATEWAY_HOST'] ?? '127.0.0.1';
const port = Number(process.env['GATEWAY_PORT'] ?? 8787);

const app = buildServer();
app
  .listen({ host, port })
  .then((address) => console.log(`LastPlan-Gateway läuft auf ${address}`))
  .catch((error: unknown) => {
    console.error('Gateway konnte nicht starten:', error);
    process.exit(1);
  });
