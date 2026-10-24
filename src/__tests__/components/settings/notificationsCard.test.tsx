/**
 * Scenario: an athlete with notifications off opens the feed on a launch the
 * notification card may ask on.
 *
 * Expected behaviour: Enable turns notifications on only once the system grants
 * them, and the card goes. A refusal leaves them off and the card up. Never
 * remind me is remembered across a relaunch. The card is absent when
 * notifications are on, where pushes cannot arrive, and after the tour's slide
 * was answered Never.
 */

import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';

import { NotificationsCard } from '@/features/settings/components/NotificationsCard';
import { useNotificationPreferences } from '@/features/settings/stores/NotificationPreferencesStore';
import {
  initialiseNotificationPrompt,
  useNotificationPrompt,
} from '@/features/settings/stores/NotificationPromptStore';
import { useWhatsNewStore } from '@/features/settings/stores/WhatsNewStore';
import { useAuthStore } from '@/shared/app/AuthStore';
import { openLaunchSession } from '../../__shared__/launchSession';

const mockRows = new Map<string, string>();
let mockOutcome = 'granted';

jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysOnly());
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('@/shared/storage', () => ({
  getSetting: jest.fn(async (key: string) => mockRows.get(key) ?? null),
  setSetting: jest.fn(async (key: string, value: string) => {
    mockRows.set(key, value);
  }),
  removeSetting: jest.fn(async (key: string) => {
    mockRows.delete(key);
  }),
}));
jest.mock('@/features/routes', () => ({
  useEngineStatus: (select: (state: { quarantineReport: null }) => unknown) =>
    select({ quarantineReport: null }),
}));
jest.mock('@/features/settings/lib/notificationService', () => ({
  requestNotificationPermission: jest.fn(async () => mockOutcome),
}));

beforeEach(() => {
  mockRows.clear();
  mockOutcome = 'granted';
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
    privacyAccepted: false,
  });
  useNotificationPrompt.setState({ isLoaded: true, dismissed: false, showingSettingsHint: false });
});

describe('NotificationsCard', () => {
  it('turns notifications on and goes when Enable is granted', async () => {
    const tree = await render(<NotificationsCard />);
    await act(async () => fireEvent.press(tree.getByTestId('notifications-card-enable')));
    expect(useNotificationPreferences.getState()).toMatchObject({
      enabled: true,
      privacyAccepted: true,
    });
    expect(tree.queryByTestId('notifications-card')).toBeNull();
  });

  it('leaves notifications off and the card up when the system refuses', async () => {
    mockOutcome = 'denied';
    const tree = await render(<NotificationsCard />);
    await act(async () => fireEvent.press(tree.getByTestId('notifications-card-enable')));
    expect(useNotificationPreferences.getState().enabled).toBe(false);
    expect(tree.getByTestId('notifications-card')).toBeTruthy();
  });

  it('says so when only system settings can turn them on', async () => {
    mockOutcome = 'blocked';
    const tree = await render(<NotificationsCard />);
    await act(async () => fireEvent.press(tree.getByTestId('notifications-card-enable')));
    expect(tree.getByTestId('notifications-card-blocked')).toBeTruthy();
    expect(useNotificationPreferences.getState().enabled).toBe(false);
  });

  it('remembers Never remind me across a relaunch', async () => {
    const tree = await render(<NotificationsCard />);
    await act(async () => fireEvent.press(tree.getByTestId('notifications-card-never')));
    expect(tree.queryByTestId('notifications-card')).toBeNull();
    expect(useNotificationPreferences.getState().enabled).toBe(false);

    useNotificationPrompt.setState({ isLoaded: false, dismissed: false });
    openLaunchSession();
    await initialiseNotificationPrompt();
    const relaunched = await render(<NotificationsCard />);
    expect(relaunched.queryByTestId('notifications-card')).toBeNull();
  });

  it('is absent while notifications are on', async () => {
    useNotificationPreferences.setState({ enabled: true });
    const tree = await render(<NotificationsCard />);
    expect(tree.queryByTestId('notifications-card')).toBeNull();
  });

  it('is absent in demo mode and signed out', async () => {
    useAuthStore.setState({ isDemoMode: true });
    expect((await render(<NotificationsCard />)).queryByTestId('notifications-card')).toBeNull();
    useAuthStore.setState({ isDemoMode: false, isAuthenticated: false });
    expect((await render(<NotificationsCard />)).queryByTestId('notifications-card')).toBeNull();
  });

  it('is absent once the tour’s slide was answered Never', async () => {
    useWhatsNewStore.setState({
      tourOffer: { declines: 0, leftover: null, answers: { notifications: 'never' } },
    });
    const tree = await render(<NotificationsCard />);
    expect(tree.queryByTestId('notifications-card')).toBeNull();
  });

  it('is absent on the first launch', async () => {
    useWhatsNewStore.setState({ launches: 1 });
    const tree = await render(<NotificationsCard />);
    expect(tree.queryByTestId('notifications-card')).toBeNull();
  });
});
