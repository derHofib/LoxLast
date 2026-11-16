import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/coverage/**', 'fixtures/**'] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      // Kap. 13: kein `any` ohne Begründung → Ausnahme nur per eslint-disable mit Kommentar
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    // Fachlogik bleibt frei von UI- und Node-Abhängigkeiten (Kap. 2.2)
    files: ['packages/core/src/**', 'packages/loxone-export/src/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['node:*', 'fs', 'path', 'os', 'crypto'],
              message: 'core/loxone-export laufen im Browser – keine Node-Module.',
            },
            {
              group: ['react', 'react-dom', '@lastplan/ui'],
              message: 'Keine UI-Abhängigkeiten in der Fachlogik.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}', 'packages/ui/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    // In Tests sind Fixtures bekannt; `!` hält die Erwartungen lesbar.
    files: ['**/*.test.{ts,tsx}'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },
  prettier,
);
