/** @type {import('jest').Config} */
module.exports = {
  rootDir: '../../..',
  testMatch: ['<rootDir>/src/__tests__/e2e/**/*.test.ts'],
  // Increased timeout to handle TanStack Query background timers
  // that keep the app busy and slow down launch/sync
  testTimeout: 300000, // 5 minutes
  maxWorkers: 1,
  globalSetup: 'detox/runners/jest/globalSetup',
  globalTeardown: 'detox/runners/jest/globalTeardown',
  reporters: ['detox/runners/jest/reporter'],
  testEnvironment: 'detox/runners/jest/testEnvironment',
  verbose: true,
};
