/**
 * ESLint Configuration
 *
 * Enforces code quality standards with stricter rules for:
 * - Type safety
 * - Error handling
 * - Documentation requirements
 */

module.exports = {
  extends: ['expo', 'prettier'],
  plugins: ['jest', '@typescript-eslint'],

  rules: {
    // ============================================================
    // Type Safety Rules
    // ============================================================

    /** Prevent using `any` type - loses type safety */
    '@typescript-eslint/no-explicit-any': 'warn',

    /** Prevent unsafe argument types */
    '@typescript-eslint/no-unsafe-argument': 'warn',

    /** Prevent unsafe assignments */
    '@typescript-eslint/no-unsafe-assignment': 'warn',

    /** Prevent unsafe member access */
    '@typescript-eslint/no-unsafe-member-access': 'warn',

    /** Prevent unsafe return types */
    '@typescript-eslint/no-unsafe-return': 'warn',

    /** Prevent unsafe calls */
    '@typescript-eslint/no-unsafe-call': 'warn',

    // ============================================================
    // Code Quality Rules
    // ============================================================

    /** Prevent unused variables */
    'no-unused-vars': 'off', // Use TypeScript version instead
    '@typescript-eslint/no-unused-vars': [
      'error',
      {
        argsIgnorePattern: '^_', // Allow _prefix for intentionally unused
        varsIgnorePattern: '^_',
      },
    ],

    /** Prevent console methods in production code */
    'no-console': [
      'warn',
      {
        allow: ['warn', 'error'], // Allow warnings and errors
      },
    ],

    /** Prevent debugger statements */
    'no-debugger': 'error',

    // ============================================================
    // React/React Native Rules
    // ============================================================

    /** Prevent missing keys in lists */
    'react/jsx-key': 'error',

    /** Prevent unused prop types */
    'react/no-unused-prop-types': 'warn',

    /** Prevent direct state mutation */
    'react/no-direct-mutation-state': 'error',

    // ============================================================
    // Best Practices
    // ============================================================

    /** Require consistent returns */
    'consistent-return': 'warn',

    /** Prevent empty blocks */
    'no-empty': 'warn',

    /** Prevent variable redeclaration */
    'no-redeclare': 'error',

    /** Prevent self-assignment */
    'no-self-assign': 'error',

    /** Prevent unnecessary escaping */
    'no-useless-escape': 'warn',

    // ============================================================
    // Jest/Testing Rules
    // ============================================================

    /** Require test descriptions */
    'jest/valid-describe': 'error',

    /** Prevent disabled tests */
    'jest/no-disabled-tests': 'warn',

    /** Prevent focused tests */
    'jest/no-focused-tests': 'error',

    /** Prevent skipping tests */
    'jest/no-skipped-tests': 'warn',
  },

  // Type-specific overrides
  overrides: [
    {
      // Stricter rules for TypeScript files
      files: ['*.ts', '*.tsx'],
      rules: {
        '@typescript-eslint/explicit-function-return-type': 'off',
        '@typescript-eslint/explicit-module-boundary-types': 'off',
        '@typescript-eslint/no-non-null-assertion': 'warn',
      },
    },
    {
      // Relaxed rules for test files
      files: ['*.test.ts', '*.test.tsx', '*.test.js', '*.test.jsx'],
      env: {
        jest: true,
      },
      rules: {
        'no-console': 'off', // Allow console.log in tests
      },
    },
  ],
};
