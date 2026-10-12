/**
 * Scenario: notifications are on in Veloq and off for the app in system
 * settings, then turned back on there while Veloq is in the background.
 *
 * Expected behaviour: the settings switch keeps the athlete's choice and a
 * notice says the system setting is off; on the return after the re-grant the
 * notice goes and the switch was never moved.
 */

import React from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { act, render } from '@testing-library/react-native';

import { NotificationSection } from '@/features/settings/components/NotificationSection';
import { useNotificationPreferences } from '@/features/settings/stores/NotificationPreferencesStore';

jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysOnly());
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('@/shared/app/AuthStore', () => ({
  useAuthStore: Object.assign(
    (select: (s: unknown) => unknown) =>
      select({ authMethod: 'oauth', isDemoMode: false, athleteId: null }),
    { getState: () => ({ athleteId: null }) }
  ),
}));

const mockGetPermissions = jest.fn();
const mockRequestPermissions = jest.fn();
jest.mock('expo-notifications', () => ({
  ...jest.requireActual('expo-notifications'),
  getPermissionsAsync: () => mockGetPermissions(),
  requestPermissionsAsync: () => mockRequestPermissions(),
}));

const changeListeners: ((state: AppStateStatus) => void)[] = [];

async function flush() {
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  changeListeners.length = 0;
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((
    event: string,
    listener: (state: AppStateStatus) => void
  ) => {
    if (event === 'change') changeListeners.push(listener);
    return { remove: () => undefined };
  }) as never);
  useNotificationPreferences.setState({
    enabled: true,
    privacyAccepted: true,
    pendingUnregister: false,
    pendingUnregisterAthleteId: null,
    categories: { sectionPr: true, fitnessMilestone: true },
  });
});

it('keeps the switch on and names the system setting while it is off', async () => {
  mockGetPermissions.mockResolvedValue({ status: 'denied', canAskAgain: false });
  const { getByTestId } = await render(<NotificationSection />);
  await flush();

  expect(useNotificationPreferences.getState().enabled).toBe(true);
  expect(getByTestId('settings-notifications-toggle')).toBeChecked();
  expect(getByTestId('settings-notifications-blocked')).toBeTruthy();
  expect(getByTestId('settings-notifications-blocked-settings')).toBeTruthy();
});

it('offers the dialog while the system will still show it', async () => {
  mockGetPermissions.mockResolvedValue({ status: 'denied', canAskAgain: true });
  const { getByTestId } = await render(<NotificationSection />);
  await flush();

  expect(useNotificationPreferences.getState().enabled).toBe(true);
  expect(getByTestId('settings-notifications-blocked-allow')).toBeTruthy();
});

it('drops the notice on the return after a re-grant', async () => {
  mockGetPermissions.mockResolvedValue({ status: 'denied', canAskAgain: false });
  const { getByTestId, queryByTestId } = await render(<NotificationSection />);
  await flush();
  expect(getByTestId('settings-notifications-blocked')).toBeTruthy();

  mockGetPermissions.mockResolvedValue({ status: 'granted', canAskAgain: true });
  for (const listener of changeListeners) listener('active');
  await flush();

  expect(queryByTestId('settings-notifications-blocked')).toBeNull();
  expect(getByTestId('settings-notifications-toggle')).toBeChecked();
  expect(useNotificationPreferences.getState().enabled).toBe(true);
});

it('shows no notice while both are on', async () => {
  mockGetPermissions.mockResolvedValue({ status: 'granted', canAskAgain: true });
  const { queryByTestId } = await render(<NotificationSection />);
  await flush();

  expect(queryByTestId('settings-notifications-blocked')).toBeNull();
});

it('shows no notice before the athlete has asked when notifications are off', async () => {
  useNotificationPreferences.setState({ enabled: false });
  mockGetPermissions.mockResolvedValue({ status: 'denied', canAskAgain: false });
  const { queryByTestId } = await render(<NotificationSection />);
  await flush();

  expect(queryByTestId('settings-notifications-blocked')).toBeNull();
});
