// Jest setup file

// Mock AsyncStorage
jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

// Mock expo-secure-store
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
  // Keychain accessibility constants (must match expo-secure-store)
  WHEN_UNLOCKED: 0,
  AFTER_FIRST_UNLOCK: 1,
  ALWAYS: 2,
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 3,
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 4,
  ALWAYS_THIS_DEVICE_ONLY: 5,
}));

// Silence console warnings during tests
global.console = {
  ...console,
  warn: jest.fn(),
  error: jest.fn(),
};
