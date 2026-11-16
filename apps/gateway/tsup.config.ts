import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/main.ts'],
  format: ['esm'],
  target: 'node22',
  // node:sqlite ist in Node eingebaut und bleibt ein Laufzeit-Import.
  external: ['node:sqlite'],
  // tsup entfernt sonst „node:“; node:sqlite gibt es nur mit Präfix.
  removeNodeProtocol: false,
  clean: true,
  splitting: false,
  // Workspace-Pakete liegen als TypeScript-Quelltext vor und werden mitgebündelt.
  noExternal: [/^@lastplan\//],
});
