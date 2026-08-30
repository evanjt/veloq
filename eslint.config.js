const expo = require('eslint-config-expo/flat');
const prettier = require('eslint-config-prettier');
const jest = require('eslint-plugin-jest');
const tseslint = require('typescript-eslint');
const globals = require('globals');

// Type-aware rules (@typescript-eslint/no-unsafe-*) are deliberately absent: they
// need full project type information, which costs minutes on this tree. `tsc
// --noEmit` already runs in pre-commit and in CI.
module.exports = [
  {
    ignores: [
      'android/**',
      'ios/**',
      'node_modules/**',
      'modules/veloqrs/src/generated/**',
      'modules/veloqrs/rust/**',
      'src/__tests__/bindings/ffi-exports.generated.ts',
      'coverage/**',
      'dist/**',
      '.expo/**',
      // Agent worktrees are whole checkouts of this repo living inside it.
      // Linting them reports another branch's problems as this one's.
      '.claude/**',
      'src/features/maps/components/styles/liberty/**',
    ],
  },
  ...expo,
  prettier,
  {
    files: ['**/*.{js,jsx,ts,tsx}'],
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-non-null-assertion': 'warn',

      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'no-debugger': 'error',
      'no-redeclare': 'off',
      '@typescript-eslint/no-redeclare': 'error',
      'no-self-assign': 'error',
      'no-empty': 'warn',
      'no-useless-escape': 'warn',
      'consistent-return': 'warn',

      // React Compiler readiness rules, on by default in the SDK 56 config.
      // Real signal, but a separate workstream from dead code: warn, do not block.
      'react-hooks/refs': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/use-memo': 'warn',

      'react/jsx-key': 'error',
      'react/no-unused-prop-types': 'warn',
      'react/no-direct-mutation-state': 'error',
    },
  },
  {
    // Colour lives in src/theme. A raw hex in a component is a token that was
    // never named, and it is invisible to a theme change.
    files: ['src/**/*.tsx'],
    ignores: ['src/__tests__/**', 'src/features/maps/styles/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Literal[value=/^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/]',
          message: 'Raw hex colour. Use a token from src/theme, or add one there.',
        },
      ],
    },
  },
  {
    // Node scripts and Jest setup run outside the app bundle.
    files: [
      'config/**/*.js',
      'scripts/**',
      'src/plugins/**',
      '*.config.js',
      'react-native.config.js',
    ],
    languageOptions: {
      globals: { ...globals.node, ...globals.jest },
      sourceType: 'commonjs',
    },
    rules: { '@typescript-eslint/no-require-imports': 'off', 'no-console': 'off' },
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: { sourceType: 'module' },
  },
  {
    files: ['**/*.test.{js,jsx,ts,tsx}', 'src/__tests__/**'],
    plugins: { jest },
    rules: {
      'no-console': 'off',
      'jest/no-disabled-tests': 'warn',
      'jest/no-focused-tests': 'error',
      'jest/valid-describe-callback': 'error',
    },
  },
];
