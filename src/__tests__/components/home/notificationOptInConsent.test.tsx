/**
 * Scenario: the home card's "Enable" is one tap from the feed and registers a
 * push token. Its own copy promises notifications and says nothing about the
 * athlete id and the token reaching a server.
 *
 * Expected behaviour: the same privacy notice the settings toggle shows comes
 * up first, and the token is registered only after it is accepted.
 */

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import { NotificationOptInCard } from '@/features/home/components/NotificationOptInCard';
import { useNotificationPreferences } from '@/features/settings/stores/NotificationPreferencesStore';
import { useNotificationPrompt } from '@/features/settings/stores/NotificationPromptStore';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('@/features/settings/lib/notificationService', () => ({
  requestNotificationPermission: jest.fn().mockResolvedValue(true),
}));
jest.mock('@/shared/app/AuthStore', () => ({
  useAuthStore: (select: (s: unknown) => unknown) =>
    select({ authMethod: 'oauth', isDemoMode: false }),
}));
jest.mock('@/shared/storage', () => ({
  getSetting: jest.fn().mockResolvedValue(null),
  setSetting: jest.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
  useNotificationPreferences.setState({
    enabled: false,
    privacyAccepted: false,
    pendingUnregister: false,
    pendingUnregisterAthleteId: null,
    categories: { sectionPr: true, fitnessMilestone: true },
    isLoaded: true,
  });
  useNotificationPrompt.setState({ isLoaded: true, dismissed: false, showingSettingsHint: false });
});

it('shows the privacy notice before it enables anything', () => {
  const screen = render(<NotificationOptInCard />);

  expect(screen.queryByText('notifications.privacy.brief')).toBeNull();
  fireEvent.press(screen.getByText('notifications.prompt.enable'));

  expect(screen.getByText('notifications.privacy.brief')).toBeTruthy();
  expect(useNotificationPreferences.getState().privacyAccepted).toBe(false);
});

it('records consent when the notice is accepted', () => {
  const screen = render(<NotificationOptInCard />);
  fireEvent.press(screen.getByText('notifications.prompt.enable'));

  fireEvent.press(screen.getByText('notifications.privacy.accept'));

  expect(useNotificationPreferences.getState().privacyAccepted).toBe(true);
});

it('leaves consent unrecorded when the notice is dismissed', () => {
  const screen = render(<NotificationOptInCard />);
  fireEvent.press(screen.getByText('notifications.prompt.enable'));

  fireEvent.press(screen.getByText('common.cancel'));

  expect(useNotificationPreferences.getState().privacyAccepted).toBe(false);
  expect(useNotificationPreferences.getState().enabled).toBe(false);
});
