import { Socket } from 'node:net';
import { ModbusConnectionError, ModbusTimeoutError } from './modbus-errors';

/**
 * Reiner TCP-Verbindungsaufbau ohne Modbus-Anfrage (für „nicht prüfbar“: Erreichbarkeit zeigen,
 * ohne mit geratenen Registern zu lesen). Liefert die Aufbauzeit in ms.
 */
export function tcpProbe(host: string, port: number, timeoutMs = 2000): Promise<number> {
  const start = performance.now();
  return new Promise<number>((resolve, reject) => {
    const socket = new Socket();
    const done = (fn: () => void) => {
      clearTimeout(timer);
      socket.destroy();
      fn();
    };
    const timer = setTimeout(
      () =>
        done(() =>
          reject(
            new ModbusTimeoutError(
              `Keine Verbindung zu ${host}:${port} innerhalb von ${timeoutMs} ms. IP-Adresse und Port prüfen.`,
              false,
            ),
          ),
        ),
      timeoutMs,
    );
    socket.once('connect', () => done(() => resolve(performance.now() - start)));
    socket.once('error', (error: NodeJS.ErrnoException) =>
      done(() =>
        reject(
          new ModbusConnectionError(
            error.code === 'ECONNREFUSED'
              ? `Verbindung zu ${host}:${port} abgelehnt. Läuft Modbus TCP am Gerät und stimmt der Port?`
              : `Verbindung zu ${host}:${port} fehlgeschlagen${error.code ? ` (${error.code})` : ''}.`,
            false,
            error.code,
          ),
        ),
      ),
    );
    socket.connect({ host, port });
  });
}
