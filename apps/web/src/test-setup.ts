import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { installDomShims } from './test-dom-shims';

installDomShims();

// Ab Node 25 bringt Node eigene, ohne --localstorage-file unbrauchbare Web-Storage-Globals mit,
// die die von jsdom überdecken. In Tests immer den Speicher von jsdom verwenden.
const dom = (globalThis as { jsdom?: { window: Window } }).jsdom;
if (dom) {
  for (const name of ['localStorage', 'sessionStorage'] as const) {
    Object.defineProperty(globalThis, name, {
      configurable: true,
      enumerable: true,
      get: () => dom.window[name],
    });
  }
}

afterEach(() => cleanup());
