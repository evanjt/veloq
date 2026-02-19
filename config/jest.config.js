module.exports = {
  preset: "jest-expo",
  testEnvironment: "node",
  silent: true,
  rootDir: "..",
  testMatch: ["**/__tests__/**/*.test.ts", "**/__tests__/**/*.test.tsx"],
  testPathIgnorePatterns: ["/node_modules/", "/__tests__/e2e/"],
  moduleNameMapper: {
    "^@/theme$": "<rootDir>/src/__tests__/__mocks__/theme.js",
    "^@/(.*)$": "<rootDir>/src/$1",
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
      branches: 70,
      functions: 70,
      lines: 70,
      statements: 70,
    },
  },
};
