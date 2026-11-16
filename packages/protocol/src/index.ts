/**
 * Gemeinsame Schemas für Gateway ↔ Browser (Kap. 8.2, 8.3).
 * Spezifiziert sind alle Endpunkte und WebSocket-Nachrichten; das Gateway implementiert in
 * Meilenstein 8 (ohne Hardware) Health, Pairing, Miniserver-Zugang/-Status, Änderungsprotokoll und den
 * WebSocket-Handshake. Geräte-Test, Live-Snapshot, Parameter schreiben und Revert folgen mit Hardware.
 */
export * from './health';
export * from './errors';
export * from './network';
export * from './pairing';
export * from './devices';
export * from './miniserver';
export * from './parameters';
export * from './changelog';
export * from './live';
export * from './config-mcp';
