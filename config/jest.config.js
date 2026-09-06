// jest-expo's preset transforms JS/TS with a babel-jest caller of
// { name: 'metro', bundler: 'metro' }, which makes babel-preset-expo preserve
// native ESM (metro handles ESM itself). Jest's CommonJS runtime then chokes on
// `import` from packages like expo-localization. Use a non-metro babel-jest
// caller so babel-preset-expo runs the modules-commonjs transform. The rootDir
// token isn't substituted inside transformer option objects, so extends needs
// an absolute path.
const babelTransform = [
  'babel-jest',
  {
    babelrc: false,
    configFile: false,
    caller: { name: 'babel-jest', supportsStaticESM: false },
    presets: ['babel-preset-expo'],
    plugins: [['module-resolver', { root: ['./'], alias: { '@': './src' } }]],
  },
];

// The main checkout must ignore agent worktrees under .claude/worktrees/, but a
// jest run started INSIDE one of those worktrees would then match nothing at all
// (every file path contains the ignored component). Apply the ignore only when
// running from the main checkout.
const inWorktree = __dirname.includes(`${require('path').sep}.claude${require('path').sep}`);
const worktreeIgnores = inWorktree ? [] : ['/.claude/worktrees/'];

// Wall-clock assertions measure the machine as much as the code, and several
// agents build on this one at once. `npm run test:perf` sets VELOQ_PERF and is
// the only run that collects them.
const perfIgnores = process.env.VELOQ_PERF === '1' ? [] : ['\\.perf\\.test\\.'];

// Jest's default cache directory is the system temp directory, which on this
// machine is a tmpfs, so every transform cache and haste map was resident
// memory. The path is keyed on the project root, so each worktree gets its own
// and a removed worktree leaves its cache behind: five sessions reached 8.4 GB
// across 354 directories and three of them died with /tmp full. Under the repo
// it is on disk, still per worktree, and `.jest-cache/` is git-ignored.
const cacheDirectory = require('path').join(__dirname, '..', '.jest-cache');

// Jest's default is cores-1, which is 31 on the 16-core box this is developed
// on, and the pre-commit hook runs `npm test` as one of five parallel gates.
// Several agent sessions run the suite at once, so the default multiplies: the
// global OOM on 2026-09-05 killed processes across the machine with 74
// `node-MainThread` workers holding 15.0 GB between them, about 200 MB each,
// against rustc's 1.8 GB. The suspicion that the Rust builds fill the box was
// wrong by an order of magnitude.
//
// The cap is not a trade, which took three attempts to establish. Measured
// warm and repeated, on a quiet machine: 4 workers 34.2, 35.9 and 37.5 s, and
// 31 workers 41.3, 42.6 and 41.0 s. Fewer workers is faster, and 8 sits between
// at 37.4 s. The suite is 358 mostly sub-second suites, so 31 workers spends
// more on process startup and contention than it wins back in parallelism.
//
// An earlier pass measured the reverse, 4 at 51.2 s against 31 at 43.0 s, and
// was wrong because another session was saturating the machine at the time: a
// run that takes more workers takes a larger share of a contended box. That is
// worth knowing when reading any timing in this repo, but it is not the case to
// tune for.
//
// Memory settles it either way. Workers are not the flat 200 MB the OOM task
// dump averaged to. Sampled mid-run at 8 workers they span 106 MB to 2.0 GB and
// the run peaks near 5.7 GB, so six sessions at eight workers is 34 GB against
// 31 GB of RAM with much of it already spoken for. Four halves that and fits.
//
// The Rust side has the same shape and is not fixed here: cargo defaults to one
// job per thread and two concurrent builds put rust-lld at 9.2 GB and rustc at
// 6.3 GB, which killed this session's own background tasks.
//
// An interactive run on an otherwise idle machine can have the cores back with
// JEST_WORKERS, which is also how CI passes its own number.
const maxWorkers = Number(process.env.JEST_WORKERS) || 4;

module.exports = {
  preset: 'jest-expo',
  cacheDirectory,
  maxWorkers,
  // A worker that has grown is recycled rather than held to the end of the run.
  // Sampled workers reached 2.0 GB, so this is the ceiling the fleet
  // multiplies, and it does not govern the main process.
  workerIdleMemoryLimit: '512MB',
  testEnvironment: 'node',
  silent: true,
  rootDir: '..',
  testMatch: ['**/__tests__/**/*.test.ts', '**/__tests__/**/*.test.tsx'],
  // react-native-worklets ships .native.ts entry points that assert the native
  // module is installed. Its resolver strips the native extensions so a
  // component importing reanimated can be rendered under Jest.
  resolver: 'react-native-worklets/jest/resolver',
  testPathIgnorePatterns: ['/node_modules/', '/__tests__/e2e/', ...perfIgnores, ...worktreeIgnores],
  modulePathIgnorePatterns: worktreeIgnores,
  moduleNameMapper: {
    '^@/theme$': '<rootDir>/src/__tests__/__mocks__/theme.js',
    '^@/(.*)$': '<rootDir>/src/$1',
    // Block expo's ReadableStream polyfill, its cancel() throws when axios
    // probes stream support. Node already provides native ReadableStream.
    'expo/virtual/streams': '<rootDir>/config/jest.emptyModule.js',
  },
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/react-native|native-base|react-native-svg|react-native-paper|@shopify/react-native-skia|d3-shape|d3-path)',
  ],
  transform: {
    '\\.[jt]sx?$': babelTransform,
  },
  setupFilesAfterEnv: ['<rootDir>/config/jest.setup.js'],
  // A wait that gives up at four seconds needs a test budget above it, or Jest
  // reports its own timeout instead of the library's, which names nothing.
  testTimeout: 15000,
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/**/index.ts',
    '!src/app/**',
    '!src/components/**',
    '!src/i18n/**',
    '!src/data/**',
    '!src/styles/**',
    '!src/theme/**',
    '!src/types/**',
    '!src/features/**/components/**',
    '!src/shared/ui/**',
    '!src/features/**/demo/**',
    '!src/features/**/demo.ts',
    '!src/features/**/types.ts',
    '!src/features/**/constants.ts',
  ],
  // Ratchet policy: thresholds sit just below current measured coverage so the
  // gate is real and enforced. Raise them as coverage climbs; never lower them.
  coverageThreshold: {
    global: {
      branches: 31,
      functions: 30,
      lines: 32,
      statements: 32,
    },
  },
};
