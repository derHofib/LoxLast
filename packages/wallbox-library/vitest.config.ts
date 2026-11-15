import { defineProject } from 'vitest/config';

export default defineProject({
  test: { name: 'wallbox-library', environment: 'node', passWithNoTests: true },
});
