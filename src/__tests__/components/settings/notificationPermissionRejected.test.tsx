/**
 * Scenario: the athlete turns notifications on and the system permission request
 * rejects instead of answering, from the settings switch or the feed card's
 * Enable button.
 *
 * Expected behaviour: the control is enabled again straight away, the rejection
 * is read as blocked and offers the way to system settings, and nothing escapes
 * as an unhandled rejection.
 */

import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';

import { NotificationSection } from '@/features/settings/components/NotificationSection';
import { NotificationsCard } from '@/features/settings/components/NotificationsCard';
import { useNotificationPreferences } from '@/features/settings/stores/NotificationPreferencesStore';
import { useNotificationPrompt } from '@/features/settings/stores/NotificationPromptStore';
import { useWhatsNewStore } from '@/features/settings/stores/WhatsNewStore';
import { useAuthStore } from '@/shared/app/AuthStore';
import { openLaunchSession } from '../../__shared__/launchSession';

jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysOnly());
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('@/shared/storage', () => ({
  getSetting: jest.fn(async () => null),
  setSetting: jest.fn(async () => undefined),
  removeSetting: jest.fn(async () => undefined),
}));
jest.mock('@/features/routes', () => ({
  useEngineStatus: (select: (state: { quarantineReport: null }) => unknown) =>
    select({ quarantineReport: null }),
}));

const mockGetPermissions = jest.fn();
const mockRequestPermissions = jest.fn();
jest.mock('expo-notifications', () => ({
  ...jest.requireActual('expo-notifications'),
  getPermissionsAsync: () => mockGetPermissions(),
  requestPermissionsAsync: () => mockRequestPermissions(),
}));

const unhandled: unknown[] = [];
const recordUnhandled = (reason: unknown) => {
  unhandled.push(reason);
};

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  unhandled.length = 0;
  process.on('unhandledRejection', recordUnhandled);
  mockGetPermissions.mockReset().mockResolvedValue({ status: 'denied', canAskAgain: true });
  mockRequestPermissions
    .mockReset()
    .mockRejectedValue(new Error('ERR_PERMISSIONS_REQUEST_NOTIFICATIONS'));

  openLaunchSession();
  useWhatsNewStore.setState({
    launches: 2,
    lastSeenVersion: '0.4.0',
    isLoaded: true,
    tourOffer: { declines: 0, leftover: null, answers: {} },
  });
  useAuthStore.setState({ isAuthenticated: true, isDemoMode: false, authMethod: 'oauth' });
  useNotificationPreferences.setState({
    isLoaded: true,
    enabled: false,
    privacyAccepted: true,
  });
  useNotificationPrompt.setState({ isLoaded: true, dismissed: false, showingSettingsHint: false });
});

afterEach(() => {
  process.off('unhandledRejection', recordUnhandled);
});

describe('a rejected notification permission request', () => {
  it('re-enables the settings switch and offers the way to system settings', async () => {
    const tree = await render(<NotificationSection />);
    await act(async () => fireEvent.press(tree.getByTestId('settings-notifications-toggle')));
    await settle();

    expect(
      tree.getByTestId('settings-notifications-toggle').props.accessibilityState
    ).toMatchObject({ disabled: false });
    expect(tree.getByTestId('settings-notifications-blocked')).toBeTruthy();
    expect(useNotificationPreferences.getState().enabled).toBe(false);
    expect(unhandled).toEqual([]);
  });

  it('re-enables the feed card Enable button and keeps the card up', async () => {
    const tree = await render(<NotificationsCard />);
    await act(async () => fireEvent.press(tree.getByTestId('notifications-card-enable')));
    await settle();

    expect(tree.getByTestId('notifications-card-enable').props.accessibilityState).toMatchObject({
      disabled: false,
    });
    expect(tree.getByTestId('notifications-card-blocked')).toBeTruthy();
    expect(useNotificationPreferences.getState().enabled).toBe(false);
    expect(unhandled).toEqual([]);
  });
});
