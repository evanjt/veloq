module.exports = {
  preset: "jest-expo",
  testEnvironment: "node",
  silent: true,
  rootDir: "..",
  testMatch: ["**/__tests__/**/*.test.ts", "**/__tests__/**/*.test.tsx"],
  testPathIgnorePatterns: ["/node_modules/", "/__tests__/e2e/", "/.claude/worktrees/"],
  modulePathIgnorePatterns: ["/.claude/worktrees/"],
  moduleNameMapper: {
    "^@/theme$": "<rootDir>/src/__tests__/__mocks__/theme.js",
    "^@/(.*)$": "<rootDir>/src/$1",
    // Block expo's ReadableStream polyfill — its cancel() throws when axios
    // probes stream support. Node already provides native ReadableStream.
    "expo/virtual/streams": "<rootDir>/config/jest.emptyModule.js",
  },
  transformIgnorePatterns: [
    "node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/react-native|native-base|react-native-svg|react-native-paper|@shopify/react-native-skia)",
  ],
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
  ],
  coverageThreshold: {
    global: {
      branches: 50,
      functions: 50,
      lines: 50,
      statements: 50,
    },
  },
};
