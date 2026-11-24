/**
 * Scenario: notifications were on under an OAuth session, then the athlete
 * signed in with a source that cannot push.
 *
 * Expected behaviour: the switch can be turned off, and no token release is
 * owed because the session never held one.
 */

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import { NotificationSection } from '@/features/settings/components/NotificationSection';
import { useNotificationPreferences } from '@/features/settings/stores/NotificationPreferencesStore';

jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('@/shared/app/AuthStore', () => ({
  useAuthStore: Object.assign(
    (select: (s: unknown) => unknown) =>
      select({ authMethod: 'garmin', isDemoMode: false, athleteId: null }),
    { getState: () => ({ athleteId: null }) }
  ),
}));
jest.mock('expo-notifications', () => ({
  ...jest.requireActual('expo-notifications'),
  getPermissionsAsync: () => Promise.resolve({ status: 'granted', canAskAgain: true }),
}));

it('turns a carried-over switch off without owing an unregister', async () => {
  useNotificationPreferences.setState({
    enabled: true,
    privacyAccepted: true,
    pendingUnregister: false,
    pendingUnregisterAthleteId: null,
  });
  const { getByTestId } = await render(<NotificationSection />);

  fireEvent(getByTestId('settings-notifications-toggle'), 'valueChange', false);

  const state = useNotificationPreferences.getState();
  expect(state.enabled).toBe(false);
  expect(state.pendingUnregister).toBe(false);
});
