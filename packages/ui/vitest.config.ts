import { defineProject } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineProject({
  plugins: [react()],
  test: {
    name: 'ui',
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
  },
});
