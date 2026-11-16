// Baut das Bibliothekspaket für GitHub Pages (ADR 0002): dist-bundle/library.json und index.json.
//
// Ohne zusätzliche Abhängigkeit: Die TypeScript-Quellen in src/ werden beim Laden mit dem
// `typescript` des Monorepo-Roots übersetzt. Dieselbe Prüflogik läuft also in CI, im Test und in der App.
// Aufruf: pnpm --filter @lastplan/wallbox-library bundle  (Version: GITHUB_SHA oder Zeitstempel)

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const require = createRequire(import.meta.url);
require.extensions['.ts'] = (module, filename) => {
  const { outputText } = ts.transpileModule(readFileSync(filename, 'utf-8'), {
    fileName: filename,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  });
  module._compile(outputText, filename);
};

const { buildLibraryPackage } = require('../src/index.ts');

const packageDir = fileURLToPath(new URL('..', import.meta.url));
const modelsDir = join(packageDir, 'models');
const outDir = join(packageDir, 'dist-bundle');

function readModelFiles() {
  return readdirSync(modelsDir, { recursive: true })
    .map(String)
    .filter((path) => path.endsWith('.json'))
    .map((path) => path.split(sep).join('/'))
    .sort()
    .map((path) => ({ path, content: readFileSync(join(modelsDir, path), 'utf-8') }));
}

const generatedAt = new Date().toISOString();
const version = process.env['GITHUB_SHA']?.trim() || generatedAt;
const result = buildLibraryPackage(readModelFiles(), { version, generatedAt });

if (!result.ok) {
  for (const error of result.errors) console.error(`Fehler: ${error}`);
  console.error('Bibliothek nicht gebaut. Die Modelldateien müssen gültig sein.');
  process.exitCode = 1;
} else {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'library.json'), `${JSON.stringify(result.library, null, 2)}\n`);
  writeFileSync(join(outDir, 'index.json'), `${JSON.stringify(result.index, null, 2)}\n`);
  console.log(`Bibliothek ${version} gebaut: ${result.index.modelCount} Modell(e) in ${outDir}.`);
}
