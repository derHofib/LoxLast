/**
 * Gemeinsame Schemas für Gateway ↔ Browser (Kap. 8).
 * Meilenstein 8 (ohne Hardware): Health, Pairing, Credentials, Änderungsprotokoll, WebSocket-Handshake.
 * Geräte-Test, Miniserver-Status und Live-Werte folgen, sobald Hardware zur Verfügung steht.
 */
export * from './health';
export * from './errors';
export * from './pairing';
export * from './credentials';
export * from './changelog';
export * from './live';
