/**
 * Scenario: the root stack paints every pushed card and sheet container with
 * the navigation theme's background, and the library's default is light grey.
 *
 * Expected behaviour: under a dark scheme the root layout hands its stack the
 * dark ground from the tokens.
 */
import React from 'react';
import { render } from '@testing-library/react-native';
import type { ColorSchemeName } from 'react-native';

import RootLayout from '@/app/_layout';
import { useAuthStore } from '@/shared/app/AuthStore';
import { colors, darkColors } from '@/theme';

const { DefaultTheme, ThemeProvider } = jest.requireActual('expo-router');

/** The root layout as the router mounts it, under the container's default theme. */
function mountRoot() {
  return render(
    <ThemeProvider value={DefaultTheme}>
      <RootLayout />
    </ThemeProvider>
  );
}

let mockSystemScheme: NonNullable<ColorSchemeName> = 'dark';
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  ...jest.requireActual('react-native/Libraries/Utilities/useColorScheme'),
  __esModule: true,
  default: () => mockSystemScheme,
}));

jest.mock('expo-router', () => {
  const actual = jest.requireActual('expo-router');
  const { Text: MockText } = require('react-native');
  function Stack() {
    return <MockText testID="stack-ground">{actual.useTheme().colors.background}</MockText>;
  }
  Stack.Screen = function Screen() {
    return null;
  };
  return { ...actual, useSegments: () => [], Stack };
});

jest.mock('react-native-gesture-handler', () => {
  const { View: MockView } = require('react-native');
  return {
    ...jest.requireActual('react-native-gesture-handler'),
    GestureHandlerRootView: MockView,
  };
});
jest.mock('expo-network', () => ({
  ...jest.requireActual('expo-network'),
  addNetworkStateListener: () => ({ remove: () => undefined }),
  getNetworkStateAsync: jest.fn(() => new Promise(() => {})),
}));
jest.mock('@/shared/app/launch', () => ({ initialiseApp: jest.fn(async () => null) }));
jest.mock('@/shared/app/splash', () => ({ releaseSplash: jest.fn() }));
jest.mock('@/shared/native/engine', () => ({
  getEngine: () => null,
  getRouteDbPath: () => null,
  isEngineReady: () => false,
}));
jest.mock('@/features/recording', () =>
  require('../__shared__/recordingBarrelStub').withRecordingOverrides({
    RecordingTitle: () => null,
    RecordingReturnPill: () => null,
    installRecordingSession: () => () => undefined,
    resumeHeldRecordingForAthlete: jest.fn(async () => null),
    startUploadQueue: jest.fn(async () => undefined),
  })
);
jest.mock('@/features/routes/hooks/useRouteReoptimisation', () => ({
  useRouteReoptimisation: () => undefined,
}));
jest.mock('@/features/insights', () => ({ registerBackgroundNotificationTask: jest.fn() }));
jest.mock('@/features/settings/components/LibraryRebuiltNotice', () => ({
  LibraryRebuiltNotice: () => null,
}));
jest.mock('@/features/settings/components/whatsNew', () => ({
  WhatsNewModal: () => null,
  TourReturnPill: () => null,
}));
jest.mock('@/features/settings/lib/autobackup', () => ({
  onAppForeground: jest.fn(),
  initWebdavConfig: jest.fn(async () => undefined),
}));
jest.mock('@/features/settings/lib/reconcilePushRegistration', () => ({
  reconcilePushRegistrationOnLaunch: jest.fn(),
}));
jest.mock('@/shared/ui/ShaderWarmup', () => ({ ShaderWarmup: () => null }));
jest.mock('@/shared/ui/FloatingPillStack', () => ({ FloatingPillStack: () => null }));
jest.mock('@/shared/ui/SyncErrorBanner', () => ({ SyncErrorBanner: () => null }));
jest.mock('@/shared/ui/TrackFetchNotice', () => ({ TrackFetchNotice: () => null }));
jest.mock('@/shared/ui/BottomTabBar', () => ({ BottomTabBar: () => null }));
jest.mock('@/shared/app/GlobalDataSync', () => ({ GlobalDataSync: () => null }));
jest.mock('@/shared/app/EngineInitBanner', () => ({ EngineInitBanner: () => null }));
jest.mock('@/shared/app/DemoBanner', () => ({ DemoBanner: () => null }));

beforeEach(() => {
  useAuthStore.setState({ isLoading: false, isAuthenticated: false, isDemoMode: false });
});

it('hands the root stack the dark ground under a dark scheme', async () => {
  mockSystemScheme = 'dark';
  const { findByTestId } = mountRoot();
  const ground = await findByTestId('stack-ground');
  expect(ground.props.children).toBe(darkColors.surfacePage);
});

it('hands the root stack the light ground under a light scheme', async () => {
  mockSystemScheme = 'light';
  const { findByTestId } = mountRoot();
  const ground = await findByTestId('stack-ground');
  expect(ground.props.children).toBe(colors.surfacePage);
});
