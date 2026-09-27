// Default mocks for third-party modules that dozens of suites stubbed by hand,
// each with its own copy of the same factory. Every one spreads the real
// module, so an export a suite never thought about is still there, and a suite
// that asserts on something overrides only that with a `jest.mock` of its own,
// which replaces this one for that file.
//
// Defaults that return a value are plain functions rather than `jest.fn`, so a
// suite calling `jest.resetAllMocks()` does not turn them into `undefined`.
// The ones a suite asserts calls on are `jest.fn`.

// The package's own Jest mock: zero insets, a 320 by 640 frame, and a provider
// that passes its children through.
jest.mock("react-native-safe-area-context", () => ({
  ...jest.requireActual("react-native-safe-area-context"),
  ...require("react-native-safe-area-context/jest/mock").default,
}));

// Navigation needs a navigator mounted above the component, which no render
// test has. `router` and `useRouter()` are the same object, so a suite reads
// the calls off whichever its component uses.
jest.mock("expo-router", () => {
  const router = {
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    navigate: jest.fn(),
    dismiss: jest.fn(),
    dismissAll: jest.fn(),
    setParams: jest.fn(),
    canGoBack: () => false,
  };
  function Stack() {
    return null;
  }
  Stack.Screen = function Screen() {
    return null;
  };
  return {
    ...jest.requireActual("expo-router"),
    router,
    useRouter: () => router,
    useLocalSearchParams: () => ({}),
    useGlobalSearchParams: () => ({}),
    usePathname: () => "/",
    useSegments: () => [],
    useFocusEffect: () => undefined,
    useIsFocused: () => true,
    Stack,
  };
});

// The native module behind this answers `undefined` under jest-expo, and the
// real directories are `null`, so a path built from them reads "null/...".
// Nothing exists until a suite says it does.
jest.mock("expo-file-system/legacy", () => ({
  ...jest.requireActual("expo-file-system/legacy"),
  documentDirectory: "file:///docs/",
  cacheDirectory: "file:///cache/",
  getInfoAsync: jest.fn(async () => ({ exists: false, isDirectory: false })),
  makeDirectoryAsync: jest.fn(async () => undefined),
  writeAsStringAsync: jest.fn(async () => undefined),
  readAsStringAsync: jest.fn(async () => ""),
  readDirectoryAsync: jest.fn(async () => []),
  deleteAsync: jest.fn(async () => undefined),
  copyAsync: jest.fn(async () => undefined),
  moveAsync: jest.fn(async () => undefined),
  downloadAsync: jest.fn(),
  uploadAsync: jest.fn(),
}));
