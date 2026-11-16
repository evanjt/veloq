/**
 * Scenario: an athlete signed out on the login screen, before or after turning the Garmin
 * experimental switch on.
 *
 * Expected behaviour: with the switch off the screen names no Garmin and mounts no Garmin form;
 * with it on, the Garmin-only form is there.
 */

import React from 'react';
import { act, render, screen } from '@testing-library/react-native';

import LoginScreen from '@/app/login';
import { useDebugStore } from '@/features/settings/stores/DebugStore';
import { initialiseI18n } from '@/i18n';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));
jest.mock('@/shared/app/NetworkContext', () => ({
  useNetwork: () => ({ isOnline: true }),
  useIsOnline: () => true,
}));
jest.mock('@/shared/app/TopSafeAreaContext', () => ({
  ...jest.requireActual('@/shared/app/TopSafeAreaContext'),
  useTopSafeArea: () => ({ hasTopBanner: false, topInset: 0, screenEdges: [] }),
  useScreenSafeAreaEdges: () => [],
}));
jest.mock('@tanstack/react-query', () => ({
  ...jest.requireActual('@tanstack/react-query'),
  useQueryClient: () => ({ clear: jest.fn() }),
}));
jest.mock('@/features/auth/hooks/useApiKeyLogin', () => ({
  useApiKeyLogin: () => ({ handleApiKeyLogin: jest.fn(), isApiKeyLoading: false }),
}));
// The engine is closed on the login screen, so no record can be placed yet.
jest.mock('@/shared/native/engine', () => ({
  getEngine: () => null,
  isEngineReady: () => false,
  getNativeModule: () => null,
}));
jest.mock('@/features/settings/components/NextcloudQrScanner', () => ({
  NextcloudQrScanner: () => null,
}));
jest.mock('@/shared/storage/cacheFiles', () => ({
  ...jest.requireActual('@/shared/storage/cacheFiles'),
  restoreCopyUri: async (name: string) => `file:///cache/restores/${name}`,
}));

beforeAll(async () => {
  await initialiseI18n('en-GB');
});

describe('the Garmin-only sign-in', () => {
  it('is absent while the Garmin switch is off', async () => {
    useDebugStore.setState({ experimentalFeatures: {} });
    await render(<LoginScreen />);
    expect(screen.queryByTestId('login-garmin-section')).toBeNull();
    expect(screen.queryByText(/garmin/i)).toBeNull();
  });

  it('is present while the Garmin switch is on', async () => {
    await act(async () => {
      useDebugStore.setState({ experimentalFeatures: { garminUpdate: true } });
    });
    await render(<LoginScreen />);
    expect(screen.getByTestId('login-garmin-section')).toBeTruthy();
  });
});
