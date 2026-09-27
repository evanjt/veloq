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

// Test code is not what the number measures. Jest leaves out the suites a run
// selects, but the other project's suites and the shared helpers are only
// files under src/ to it, and counted as untested source they cost fifteen
// points of statements.
const collectCoverageFrom = [
  'src/**/*.{ts,tsx}',
  '!src/**/__tests__/**',
  '!src/**/*.d.ts',
  '!src/**/index.ts',
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
];

const { toolingDirectories, toolingSuites } = require('./jest.tooling.js');

const ignored = ['/node_modules/', '/__tests__/e2e/', ...perfIgnores, ...worktreeIgnores];
const escape = (path) => path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Jest reads these per project, so both projects carry them. The options on
// the exported object are read once per run.
const project = {
  preset: 'jest-expo',
  cacheDirectory,
  testEnvironment: 'node',
  // Absolute: a project's rootDir resolves against the top-level one, so
  // '..' here would name the directory above the repository.
  rootDir: require('path').join(__dirname, '..'),
  collectCoverageFrom,
  // react-native-worklets ships .native.ts entry points that assert the native
  // module is installed. Its resolver strips the native extensions so a
  // component importing reanimated can be rendered under Jest.
  resolver: 'react-native-worklets/jest/resolver',
  modulePathIgnorePatterns: worktreeIgnores,
  moduleNameMapper: {
    '^@/theme$': '<rootDir>/src/__tests__/__mocks__/theme.js',
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  transformIgnorePatterns: [
    // `uuid` resolves its `.` export through the `node` condition to an ESM
    // build, and `xcode` requires it, so a test that touches the iOS config
    // plugins fails to parse rather than to assert.
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/react-native|native-base|react-native-svg|react-native-paper|@shopify/react-native-skia|d3-shape|d3-path|uuid)',
  ],
  transform: {
    '\\.[jt]sx?$': babelTransform,
  },
  setupFilesAfterEnv: ['<rootDir>/config/jest.setup.js'],
  // A suite's own `jest.useFakeTimers()` starts on the same known day as the rest.
  fakeTimers: { now: require('./jest.clock').FIXED_NOW },
};

module.exports = {
  rootDir: '..',
  cacheDirectory,
  maxWorkers,
  // A worker that has grown is recycled rather than held to the end of the run.
  // Sampled workers reached 2.0 GB, so this is the ceiling the fleet
  // multiplies, and it does not govern the main process.
  workerIdleMemoryLimit: '512MB',
  silent: true,
  // A wait that gives up at four seconds needs a test budget above it, or Jest
  // reports its own timeout instead of the library's, which names nothing.
  //
  // The budget covers hooks too, and the runner is the slowest machine the
  // suite meets: two workers on four cores, and weekly with every file
  // instrumented for coverage. Three tests in one suite spent the old 15 s in the library's
  // own cleanup on 2026-09-08 and none of them reproduced here, on a run
  // taking the same flags. Thirty seconds is still short enough that a wait
  // which will never settle fails inside it.
  testTimeout: 30000,
  collectCoverageFrom,
  // Two projects, split in config/jest.tooling.js. `npm test` selects `app`
  // and `npm run test:tooling` selects `tooling`. Anything that selects no
  // project runs both: `test:changed` in the pre-commit hook and the merge
  // gate's `--findRelatedTests`, so neither loses a related suite to the split.
  projects: [
    {
      ...project,
      displayName: 'app',
      testMatch: ['**/__tests__/**/*.test.ts', '**/__tests__/**/*.test.tsx'],
      testPathIgnorePatterns: [
        ...ignored,
        ...toolingDirectories.map((dir) => `/${escape(dir)}`),
        ...toolingSuites.map((suite) => `/${escape(suite)}$`),
      ],
    },
    {
      ...project,
      displayName: 'tooling',
      testMatch: [
        ...toolingDirectories.map((dir) => `<rootDir>/${dir}**/*.test.{ts,tsx}`),
        ...toolingSuites.map((suite) => `<rootDir>/${suite}`),
      ],
      testPathIgnorePatterns: ignored,
    },
  ],
  // Ratchet policy: thresholds sit a point below what the app project measures,
  // so the gate is real. Raise them as coverage climbs; never lower them. The
  // screens under src/app count: 40 files at a quarter covered are the largest
  // gap in the tree and the number has to be able to show it. Instrumenting
  // every file costs a run about half as much again, so the weekly Jest
  // Coverage workflow holds these rather than every push, and
  // `npm run test:coverage` is the same check by hand. Measured 2026-09-27:
  // statements 72.43, branches 63.19, functions 70.22, lines 73.71.
  coverageThreshold: {
    global: {
      branches: 62,
      functions: 69,
      lines: 72,
      statements: 71,
    },
  },
};
