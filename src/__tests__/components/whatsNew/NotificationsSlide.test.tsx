/**
 * Scenario: the tour is where notifications are asked for. The slide draws
 * example notifications from the sentences a real one is built from, and offers
 * Turn on and Never remind me again where the account can receive pushes.
 *
 * Expected behaviour: Turn on raises the system prompt once and, granted, stores
 * consent, the preference and the slide's answer. Never remind me again stores
 * the answer and asks nothing of the system. An account that cannot receive
 * pushes sees the examples with no buttons and a line saying why.
 */

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { NotificationsSlide } from '@/features/settings/components/whatsNew/NotificationsSlide';
import { NOTIFICATION_TEMPLATE_KEYS } from '@/i18n/notificationTemplates';
import { requestNotificationPermission } from '@/features/settings/lib/notificationService';
import { NO_TOUR_OFFER } from '@/features/settings/lib/tourOffer';
import { useNotificationPreferences } from '@/features/settings/stores/NotificationPreferencesStore';
import { useWhatsNewStore } from '@/features/settings/stores/WhatsNewStore';
import { useAuthStore } from '@/shared/app/AuthStore';

jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysWithValues());
jest.mock('@/features/settings/lib/notificationService', () => ({
  requestNotificationPermission: jest.fn(),
}));
jest.mock('@/shared/storage', () => ({
  getSetting: jest.fn().mockResolvedValue(null),
  setSetting: jest.fn().mockResolvedValue(undefined),
}));
// The slide reaches the app barrel for `useTheme`, and the barrel pulls the
// IAP binding in behind it.
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));

const request = jest.mocked(requestNotificationPermission);
const prefs = () => useNotificationPreferences.getState();
const answer = () => useWhatsNewStore.getState().tourOffer.answers.notifications;

async function press(testID: string): Promise<void> {
  await act(async () => {
    fireEvent.press(screen.getByTestId(testID));
  });
}

beforeEach(() => {
  request.mockReset().mockResolvedValue('granted');
  useAuthStore.setState({ isAuthenticated: true, isDemoMode: false, authMethod: 'oauth' });
  useNotificationPreferences.setState({
    enabled: false,
    privacyAccepted: false,
    pendingUnregister: false,
    pendingUnregisterAthleteId: null,
    categories: { sectionPr: true, fitnessMilestone: true },
    isLoaded: true,
  });
  useWhatsNewStore.setState({ tourOffer: NO_TOUR_OFFER });
});

describe('the examples', () => {
  it('are drawn from the sentences a posted notification is built from', async () => {
    await render(<NotificationsSlide />);
    const examples = screen.getAllByTestId('tour-notification-example');
    expect(examples.length).toBeGreaterThanOrEqual(2);

    const titles = screen.getAllByTestId('tour-notification-example-title');
    const bodies = screen.getAllByTestId('tour-notification-example-body');
    for (const node of [...titles, ...bodies]) {
      const text = String(node.props.children);
      expect(NOTIFICATION_TEMPLATE_KEYS.some((key) => text.startsWith(key))).toBe(true);
    }
  });

  it('show on an account that cannot receive pushes, with no buttons and a line saying why', async () => {
    useAuthStore.setState({ authMethod: 'apiKey' });
    await render(<NotificationsSlide />);

    expect(screen.getAllByTestId('tour-notification-example').length).toBeGreaterThan(0);
    expect(screen.getByText('whatsNew.tutorial.notificationsNeedSignIn')).toBeTruthy();
    expect(screen.queryByTestId('tour-notifications-turn-on')).toBeNull();
    expect(screen.queryByTestId('tour-notifications-never')).toBeNull();
  });

  it('show in demo with no buttons', async () => {
    useAuthStore.setState({ authMethod: 'demo', isDemoMode: true });
    await render(<NotificationsSlide />);

    expect(screen.getByText('whatsNew.tutorial.notificationsNeedSignIn')).toBeTruthy();
    expect(screen.queryByTestId('tour-notifications-turn-on')).toBeNull();
  });
});

describe('Turn on', () => {
  it('raises the system prompt once and stores consent, the preference and the answer', async () => {
    await render(<NotificationsSlide />);
    await press('tour-notifications-turn-on');

    expect(request).toHaveBeenCalledTimes(1);
    expect(prefs().privacyAccepted).toBe(true);
    expect(prefs().enabled).toBe(true);
    expect(answer()).toBe('on');
    expect(screen.queryByTestId('tour-notifications-turn-on')).toBeNull();
  });

  it('stores nothing when the system prompt is refused, and asks again on the next tap', async () => {
    request.mockResolvedValueOnce('askable');
    await render(<NotificationsSlide />);
    await press('tour-notifications-turn-on');

    expect(prefs().enabled).toBe(false);
    expect(prefs().privacyAccepted).toBe(false);
    expect(answer()).toBeUndefined();

    await press('tour-notifications-turn-on');
    expect(request).toHaveBeenCalledTimes(2);
    expect(prefs().enabled).toBe(true);
  });

  it('says notifications are off once the system stops asking', async () => {
    request.mockResolvedValueOnce('blocked');
    await render(<NotificationsSlide />);
    await press('tour-notifications-turn-on');

    expect(screen.getByTestId('tour-notifications-blocked')).toBeTruthy();
    expect(prefs().enabled).toBe(false);
    expect(answer()).toBeUndefined();
  });

  it('keeps the disclosure of what is stored one tap away, recording nothing', async () => {
    await render(<NotificationsSlide />);
    expect(screen.queryByText('notifications.privacy.brief')).toBeNull();

    await press('tour-notifications-details');

    expect(screen.getByText('notifications.privacy.brief')).toBeTruthy();
    expect(prefs().privacyAccepted).toBe(false);
  });
});

describe('Never remind me again', () => {
  it('stores the answer, asks nothing of the system, and offers no buttons again', async () => {
    await render(<NotificationsSlide />);
    await press('tour-notifications-never');

    expect(request).not.toHaveBeenCalled();
    expect(answer()).toBe('never');
    expect(prefs().enabled).toBe(false);
    expect(screen.queryByTestId('tour-notifications-turn-on')).toBeNull();
    expect(screen.getByText('notifications.prompt.settingsHint')).toBeTruthy();
  });

  it('holds when the tour is opened again', async () => {
    useWhatsNewStore.setState({
      tourOffer: { ...NO_TOUR_OFFER, answers: { notifications: 'never' } },
    });
    await render(<NotificationsSlide />);

    expect(screen.queryByTestId('tour-notifications-turn-on')).toBeNull();
    expect(screen.queryByTestId('tour-notifications-never')).toBeNull();
  });
});

it('offers no buttons when notifications are already on', async () => {
  useNotificationPreferences.setState({ enabled: true, privacyAccepted: true });
  await render(<NotificationsSlide />);

  expect(screen.queryByTestId('tour-notifications-turn-on')).toBeNull();
  expect(screen.getByText('whatsNew.tutorial.notificationsOn')).toBeTruthy();
});
