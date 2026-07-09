import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist', 'coverage', 'playwright-report', 'test-results', 'node_modules'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['tests/**', '**/*.test.ts'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    files: ['*.config.ts', '*.config.js', 'scripts/**'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    files: ['api/**'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
);
