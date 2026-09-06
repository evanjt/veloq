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
      'src/features/maps/assets/*.generated.ts',
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
      // Off because every report it made here was wrong. It cannot follow a
      // prop through `forwardRef`, through a `memo` comparator that reads it,
      // or into a `renderItem` callback, and it reads any inline destructured
      // object type as a props type.
      'react/no-unused-prop-types': 'off',
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
    // CLI tools under the native module. Console output is their product.
    // `scripts/**` above resolves from this directory and never reaches them.
    files: ['modules/veloqrs/scripts/**'],
    rules: { 'no-console': 'off' },
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
  {
    // A `jest.mock` factory may not reference anything outside its own scope,
    // so pulling the real module in with `require` inside it is jest's own
    // documented shape and there is no import form that works. Ninety test
    // files were carrying a per-line disable saying so, which is the same
    // decision written ninety times.
    files: ['**/*.test.{js,jsx,ts,tsx}', 'src/__tests__/**'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    // The native binding and the native-only libraries, pulled in from inside a
    // function so a missing or failed module is caught where it is used rather
    // than thrown at import. A static import would take the whole screen down
    // on a build where the module is absent, which is what `getNativeModule`
    // and every `try` around these exists to prevent. `DevSettings` is
    // dev-only and AsyncStorage is deferred so a sign-out path does not pull
    // storage into every bundle that touches it.
    files: [
      'src/shared/native/engine.ts',
      'src/shared/storage/gpsStorage.ts',
      'src/shared/ui/GlobalErrorBoundary.tsx',
      'src/app/debug.tsx',
      'src/features/insights/lib/activityNotificationBody.ts',
      'src/features/routes/stores/RouteSettingsStore.ts',
      'src/features/sensors/lib/sensorManager.ts',
      'src/features/settings/components/DetectionIllustration.tsx',
      'src/features/settings/lib/autobackup/backends/icloudBackend.ts',
      'src/features/settings/stores/DebugStore.ts',
    ],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    // The store ring and the What's New slides. Each of these reaches a module
    // that reaches back, and the lazy call is what keeps the cycle out of the
    // module graph. `importCycles.test.ts` is what holds that, and it passes
    // because of these, not despite them.
    files: [
      'src/app/_layout.tsx',
      'src/shared/app/AuthStore.ts',
      'src/features/recording/lib/backgroundLocation.ts',
      'src/features/settings/components/whatsNew/slides.ts',
      'src/features/settings/stores/NotificationPreferencesStore.ts',
    ],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    // Demo fixtures. A live-mode session must never pay for them, and a static
    // import puts them in the bundle whether or not demo mode is ever entered.
    files: [
      'src/shared/app/seedDemoEngine.ts',
      'src/features/activity/lib/engineStreams.ts',
      'src/features/routes/hooks/useGpsDataFetcher.ts',
    ],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    // The headless background task. It runs with no React tree and no app
    // start behind it, so every module it needs is pulled in at the point of
    // use: an import at module scope would load the binding, i18n and the
    // widget bridge on every wake, including the wakes that do nothing.
    files: ['src/features/insights/backgroundInsightTask.ts'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    // i18next's default export is the singleton instance, and `use`,
    // `changeLanguage` and the rest are that instance's methods as well as
    // named exports bound to it. Calling them on the instance is the library's
    // own documented shape, so the caution has nothing to catch here.
    files: ['src/i18n/index.ts'],
    rules: { 'import/no-named-as-default-member': 'off' },
  },
  {
    // The console's home. `debug` wraps it and `renderTimer` is the dev
    // instrument that prints frame and heap numbers, so neither can route
    // through a logger built on top of itself.
    files: ['src/shared/debug/**'],
    rules: { 'no-console': 'off' },
  },
  {
    // A Cloudflare Worker. `console.log` is its log stream, there is no
    // `__DEV__` to guard on and no bundle to keep the lines out of.
    files: ['oauth-proxy/**'],
    rules: { 'no-console': 'off' },
  },
  {
    // The FFI timing line is the one place a `debug` logger cannot go: this
    // module is what `debug` would be measuring, and it already guards on
    // `__DEV__` itself.
    files: ['modules/veloqrs/src/EngineClient.ts'],
    rules: { 'no-console': 'off' },
  },
];
