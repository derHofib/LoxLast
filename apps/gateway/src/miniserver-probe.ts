import { createInterface } from 'node:readline';
import { MiniserverWsClient, type MiniserverCredentials } from './clients/miniserver';

/**
 * Live-Test gegen den Test-Miniserver (nur manuell, nie in CI, nie gegen Kundenanlagen).
 *
 *   LOXONE_HOST=192.168.1.77 LOXONE_USER=lastplan pnpm --filter @lastplan/gateway miniserver:probe
 *   … miniserver:probe -- --set <uuid>=<wert> [--state <uuid>] [--watch <sekunden>]
 *
 * Das Passwort wird verdeckt abgefragt (oder aus LOXONE_PASSWORD gelesen) und nie ausgegeben.
 */

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function askHidden(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const out = rl as unknown as { _writeToOutput: (s: string) => void };
  const write = out._writeToOutput.bind(rl);
  let prompted = false;
  out._writeToOutput = (s: string) => {
    if (!prompted) {
      prompted = true;
      write(s);
    }
  };
  return new Promise((resolve) =>
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    }),
  );
}

async function main(): Promise<void> {
  const host = process.env['LOXONE_HOST'];
  const user = process.env['LOXONE_USER'];
  if (!host || !user) {
    console.error('Bitte LOXONE_HOST und LOXONE_USER setzen (optional LOXONE_PORT, LOXONE_TLS=1).');
    process.exit(2);
  }
  const password = process.env['LOXONE_PASSWORD'] ?? (await askHidden(`Passwort für ${user}: `));
  const creds: MiniserverCredentials = { host, user, password };
  if (process.env['LOXONE_PORT']) creds.port = Number(process.env['LOXONE_PORT']);
  if (process.env['LOXONE_TLS'] === '1') creds.tls = true;
  const enc = process.env['LOXONE_ENCRYPTION'];
  const client = new MiniserverWsClient({
    credentials: () => creds,
    clientInfo: 'LastPlan-Gateway Test',
    reconnect: false,
    ...(enc === 'always' || enc === 'never' || enc === 'auto' ? { encryption: enc } : {}),
  });
  client.onStatus((s) => console.log(`Status: ${s.state}${s.message ? ` – ${s.message}` : ''}`));
  let count = 0;
  client.onValues((v) => (count += v.length));

  try {
    await client.connect();
    const watch = Number(arg('watch') ?? '5');
    await new Promise((r) => setTimeout(r, watch * 1000));
    console.log(`Wert-Events in ${watch} s: ${count}; letzte Werte: ${client.status.lastValuesAt}`);

    const set = arg('set');
    if (set) {
      const [uuid, raw] = set.split('=');
      const state = arg('state');
      const result = await client.setVirtualInput(
        uuid ?? '',
        Number(raw),
        state ? { stateUuid: state } : {},
      );
      console.log(
        `Gesetzt ${uuid} = ${raw}: Rücklesewert ${result.readBack}, bestätigt: ${result.confirmed ? 'ja' : 'nein'}`,
      );
    }
  } catch (e) {
    console.error(`Fehler: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  } finally {
    await client.disconnect();
  }
}

await main();
