// jest-expo's preset transforms JS/TS with a babel-jest caller of
// { name: 'metro', bundler: 'metro' }, which makes babel-preset-expo preserve
// native ESM (metro handles ESM itself). Jest's CommonJS runtime then chokes on
// `import` from packages like expo-localization. Use a non-metro babel-jest
// caller so babel-preset-expo runs the modules-commonjs transform. The rootDir
// token isn't substituted inside transformer option objects, so extends needs
// an absolute path.
const babelTransform = [
  "babel-jest",
  {
    babelrc: false,
    configFile: false,
    caller: { name: "babel-jest", supportsStaticESM: false },
    presets: ["babel-preset-expo"],
    plugins: [["module-resolver", { root: ["./"], alias: { "@": "./src" } }]],
  },
];

// The main checkout must ignore agent worktrees under .claude/worktrees/, but a
// jest run started INSIDE one of those worktrees would then match nothing at all
// (every file path contains the ignored component). Apply the ignore only when
// running from the main checkout.
const inWorktree = __dirname.includes(`${require("path").sep}.claude${require("path").sep}`);
const worktreeIgnores = inWorktree ? [] : ["/.claude/worktrees/"];

module.exports = {
  preset: "jest-expo",
  testEnvironment: "node",
  silent: true,
  rootDir: "..",
  testMatch: ["**/__tests__/**/*.test.ts", "**/__tests__/**/*.test.tsx"],
  testPathIgnorePatterns: ["/node_modules/", "/__tests__/e2e/", ...worktreeIgnores],
  modulePathIgnorePatterns: worktreeIgnores,
  moduleNameMapper: {
    "^@/theme$": "<rootDir>/src/__tests__/__mocks__/theme.js",
    "^@/(.*)$": "<rootDir>/src/$1",
    // Block expo's ReadableStream polyfill — its cancel() throws when axios
    // probes stream support. Node already provides native ReadableStream.
    "expo/virtual/streams": "<rootDir>/config/jest.emptyModule.js",
  },
  transformIgnorePatterns: [
    "node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/react-native|native-base|react-native-svg|react-native-paper|@shopify/react-native-skia|d3-shape|d3-path)",
  ],
  transform: {
    "\\.[jt]sx?$": babelTransform,
  },
  setupFilesAfterEnv: ["<rootDir>/config/jest.setup.js"],
  collectCoverageFrom: [
    "src/**/*.{ts,tsx}",
    "!src/**/*.d.ts",
    "!src/**/index.ts",
    "!src/app/**",
    "!src/components/**",
    "!src/i18n/**",
    "!src/data/**",
    "!src/styles/**",
    "!src/theme/**",
    "!src/types/**",
    "!src/features/**/components/**",
    "!src/shared/ui/**",
    "!src/features/**/demo/**",
    "!src/features/**/demo.ts",
    "!src/features/**/types.ts",
    "!src/features/**/constants.ts",
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
