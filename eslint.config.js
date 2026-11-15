import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import hooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  { ignores: ['dist', 'tmp', 'node_modules'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { plugins: { 'react-hooks': hooks }, rules: hooks.configs.recommended.rules },
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/sdk/connect.ts'],
    rules: { 'no-restricted-imports': ['error', { paths: ['@owox/plugin-sdk', '@owox/ui'] }] },
  },
);
