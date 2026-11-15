import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/main.ts'],
  format: ['esm'],
  target: 'node22',
  external: ['better-sqlite3'],
  clean: true,
  splitting: false,
  // Workspace-Pakete liegen als TypeScript-Quelltext vor und werden mitgebündelt.
  noExternal: [/^@lastplan\//],
});
