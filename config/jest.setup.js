// `waitFor` waits for a render that has not happened yet, and a second of
// patience is a statement about the machine rather than about the code. Several
// agents build on this one at once, and at a load average above twenty a render
// that normally settles in milliseconds has missed the library's 1,000 ms
// default twice, in unrelated suites, on trees whose diffs could not explain it.
// Four seconds is still short enough that a wait which will never settle fails
// inside the test timeout, with the library's message rather than Jest's.
const { configure: configureTestingLibrary } = require("@testing-library/react-native");

configureTestingLibrary({ asyncUtilTimeout: 4000 });

// Jest setup file

require("./jest.nativeMocks");

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

// The engine binding registers a TurboModule the moment it is imported, which
// throws outside a native runtime. A feature barrel re-exports every module the
// outside tree takes from it, so any test that touches one consumer of a
// feature loads all of them, and one of them always reaches the binding. Each
// suite stubbing it for itself is a mock for an import it never asked for, so
// the stub is the default here and a suite that wants different behaviour still
// calls `jest.mock('veloqrs', ...)` of its own, which wins.
jest.mock("veloqrs", () =>
  require("../src/__tests__/__shared__/veloqrsStub").withOverrides(),
);

// `react-native-iap` reaches a nitro TurboModule the same way, through
// `shared/app`, which the same barrels pull in.
jest.mock("react-native-iap", () => ({ useIAP: () => ({}), ErrorCode: {} }));

// Mock expo-localization for device locale simulation
// Note: i18next is NOT mocked - we test real integration
jest.mock("expo-localization", () => ({
  getLocales: jest.fn(() => [
    { languageTag: "en-US", languageCode: "en", regionCode: "US" },
  ]),
}));

// Silence console warnings during tests
global.console = {
  ...console,
  warn: jest.fn(),
  error: jest.fn(),
};
