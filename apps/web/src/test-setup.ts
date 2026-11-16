import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { installDomShims } from './test-dom-shims';

installDomShims();

afterEach(() => cleanup());
