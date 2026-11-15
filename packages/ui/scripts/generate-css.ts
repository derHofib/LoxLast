import { writeFileSync } from 'node:fs';
import { renderTokensCss } from '../src/tokens.ts';

writeFileSync(new URL('../src/tokens.css', import.meta.url), renderTokensCss());
console.log('tokens.css erzeugt');
