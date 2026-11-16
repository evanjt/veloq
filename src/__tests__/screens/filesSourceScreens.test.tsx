/**
 * Scenario: an athlete with no account opens the app. The sign-in screen offers
 * to fill the library from files or to link a browser, and Settings > Account
 * offers the ways to add an account later.
 *
 * Expected behaviour: each sign-in entry starts the files source and names the
 * screen to open over the tabs, a files library has no sign-out of its own,
 * and the connect rows leave the files source for the sign-in screen.
 */

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import LoginScreen from '@/app/login';
import AccountScreen from '@/app/account';
import { useAuthStore } from '@/shared/app/AuthStore';
import { takePostEntryRoute } from '@/shared/app/postEntryRoute';
import { useDebugStore } from '@/features/settings/stores/DebugStore';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-i18next', () => require('../__shared__/i18nMock').fallbackOrKey());
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
jest.mock('@/features/settings/hooks/exportIndex', () => ({
  useImportDatabaseBackup: () => ({ importDatabaseBackup: jest.fn(), importing: false }),
}));
jest.mock('@/shared/native/engine', () => ({
  getEngine: () => null,
  isEngineReady: () => false,
}));
jest.mock('@/shared/app/useAthlete', () => ({ useAthlete: () => ({ data: null }) }));

beforeEach(() => {
  takePostEntryRoute();
  useDebugStore.setState({ experimentalFeatures: {} });
  useAuthStore.setState({
    isLoading: false,
    isAuthenticated: false,
    isDemoMode: false,
    authMethod: null,
    athleteId: null,
  });
});

describe('the sign-in screen', () => {
  it('starts the files source and asks for the import screen', async () => {
    await render(<LoginScreen />);

    await act(async () => {
      fireEvent.press(screen.getByTestId('login-files-button'));
    });

    expect(useAuthStore.getState()).toMatchObject({
      isAuthenticated: true,
      authMethod: 'files',
      athleteId: null,
    });
    expect(takePostEntryRoute()).toBe('/import-collection');
  });

  it('offers the linked browser only while its switch is on, and asks for its screen', async () => {
    const off = await render(<LoginScreen />);
    expect(off.queryByTestId('login-link-browser-button')).toBeNull();
    off.unmount();

    useDebugStore.setState({ experimentalFeatures: { remoteLink: true } });
    await render(<LoginScreen />);
    await act(async () => {
      fireEvent.press(screen.getByTestId('login-link-browser-button'));
    });

    expect(useAuthStore.getState().authMethod).toBe('files');
    expect(takePostEntryRoute()).toBe('/linked-devices');
  });
});

describe('Settings > Account in a files library', () => {
  beforeEach(() => {
    useAuthStore.getState().enterFilesMode();
  });

  it('offers no sign-out of a session that does not exist', async () => {
    await render(<AccountScreen />);

    expect(screen.queryByTestId('settings-logout-button')).toBeNull();
    expect(screen.getByTestId('settings-logout-clear-button')).toBeTruthy();
  });

  it('leaves the files source for the sign-in screen from Connect intervals.icu', async () => {
    await render(<AccountScreen />);

    await act(async () => {
      fireEvent.press(screen.getByTestId('settings-connect-intervals'));
    });

    expect(useAuthStore.getState()).toMatchObject({ isAuthenticated: false, authMethod: null });
  });

  it('offers Connect Garmin only while Garmin is switched on', async () => {
    const off = await render(<AccountScreen />);
    expect(off.queryByTestId('settings-connect-garmin')).toBeNull();
    off.unmount();

    useDebugStore.setState({ experimentalFeatures: { garminUpdate: true } });
    await render(<AccountScreen />);
    expect(screen.getByTestId('settings-connect-garmin')).toBeTruthy();
  });

  it('keeps every other account its plain sign-out', async () => {
    useAuthStore.setState({ authMethod: 'apiKey', isAuthenticated: true, athleteId: 'i1' });
    await render(<AccountScreen />);

    expect(screen.getByTestId('settings-logout-button')).toBeTruthy();
    expect(screen.queryByTestId('settings-connect-intervals')).toBeNull();
  });
});
