/**
 * Scenario: the feed's notification card is the one place consent is asked.
 * Turning on registers a push token and an athlete id on our server. A new
 * feed shows a title, one line and two buttons, with the disclosure one tap
 * away inside the card. An install already enabled without having accepted
 * shows the disclosure at once, since that notice is owed.
 *
 * Expected behaviour: no modal is ever mounted, the disclosure is hidden until
 * the details link is pressed, and the token is only registered once consent is
 * recorded.
 */

import React from 'react';
import { Modal } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';

import { NotificationOptInCard } from '@/features/home/components/NotificationOptInCard';
import { Card } from '@/shared/ui/Card';
import { useNotificationPreferences } from '@/features/settings/stores/NotificationPreferencesStore';
import { useNotificationPrompt } from '@/features/settings/stores/NotificationPromptStore';
import { requestNotificationPermission } from '@/features/settings/lib/notificationService';

jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysOnly());
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

const prefs = () => useNotificationPreferences.getState();

beforeEach(() => {
  (requestNotificationPermission as jest.Mock).mockClear();
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

describe('not enabled', () => {
  it('shows a title, one line and the buttons, with the disclosure collapsed', () => {
    const screen = render(<NotificationOptInCard />);

    expect(screen.getByText('notifications.prompt.title')).toBeTruthy();
    expect(screen.getByText('notifications.prompt.description')).toBeTruthy();
    expect(screen.queryByText('notifications.privacy.brief')).toBeNull();
    expect(screen.queryByText('notifications.prompt.revokeHint')).toBeNull();
    expect(screen.queryByText('login.privacyPolicy')).toBeNull();
    expect(screen.UNSAFE_getByType(Card).props.variant).toBe('raised');
    expect(screen.UNSAFE_queryAllByType(Modal)).toHaveLength(0);
  });

  it('opens the disclosure in the card on Details, with no modal', () => {
    const screen = render(<NotificationOptInCard />);

    fireEvent.press(screen.getByText('notifications.prompt.howItWorks'));

    expect(screen.getByText('notifications.privacy.brief')).toBeTruthy();
    expect(screen.getByText('login.privacyPolicy')).toBeTruthy();
    expect(screen.UNSAFE_queryAllByType(Modal)).toHaveLength(0);
    expect(prefs().privacyAccepted).toBe(false);
  });

  it('closes the disclosure on a second press', () => {
    const screen = render(<NotificationOptInCard />);

    fireEvent.press(screen.getByText('notifications.prompt.howItWorks'));
    fireEvent.press(screen.getByText('notifications.prompt.howItWorks'));

    expect(screen.queryByText('notifications.privacy.brief')).toBeNull();
  });

  it('records consent and enables in one tap', async () => {
    const screen = render(<NotificationOptInCard />);

    await act(async () => {
      fireEvent.press(screen.getByText('notifications.prompt.enable'));
    });

    expect(prefs().privacyAccepted).toBe(true);
    expect(prefs().enabled).toBe(true);
  });

  it('leaves consent unrecorded when the permission is refused', async () => {
    (requestNotificationPermission as jest.Mock).mockResolvedValueOnce(false);
    const screen = render(<NotificationOptInCard />);

    await act(async () => {
      fireEvent.press(screen.getByText('notifications.prompt.enable'));
    });

    expect(prefs().enabled).toBe(false);
    expect(prefs().privacyAccepted).toBe(false);
  });

  it('records nothing on Not now', () => {
    const screen = render(<NotificationOptInCard />);

    fireEvent.press(screen.getByText('notifications.prompt.dismiss'));

    expect(prefs().privacyAccepted).toBe(false);
    expect(prefs().enabled).toBe(false);
  });
});

describe('owed: enabled without consent', () => {
  beforeEach(() => {
    useNotificationPreferences.setState({ enabled: true, privacyAccepted: false });
  });

  it('shows the receiving wording inline with no modal, even after Not now was chosen', () => {
    useNotificationPrompt.setState({ dismissed: true });
    const screen = render(<NotificationOptInCard />);

    expect(screen.getByText('notifications.privacy.briefEnabled')).toBeTruthy();
    expect(screen.queryByText('notifications.prompt.howItWorks')).toBeNull();
    expect(screen.queryByText('notifications.prompt.revokeHint')).toBeNull();
    expect(screen.UNSAFE_queryAllByType(Modal)).toHaveLength(0);
  });

  it('Keep records consent and keeps notifications on', () => {
    const screen = render(<NotificationOptInCard />);

    fireEvent.press(screen.getByText('notifications.prompt.keep'));

    expect(prefs().privacyAccepted).toBe(true);
    expect(prefs().enabled).toBe(true);
  });

  it('Turn off disables without recording consent', () => {
    const screen = render(<NotificationOptInCard />);

    fireEvent.press(screen.getByText('notifications.privacy.turnOff'));

    expect(prefs().enabled).toBe(false);
    expect(prefs().privacyAccepted).toBe(false);
  });

  it('is absent until the stored preferences have loaded', () => {
    useNotificationPreferences.setState({ isLoaded: false });
    const screen = render(<NotificationOptInCard />);

    expect(screen.queryByText('notifications.privacy.briefEnabled')).toBeNull();
  });
});

it('shows nothing once consent is recorded and notifications are on', () => {
  useNotificationPreferences.setState({ enabled: true, privacyAccepted: true });
  const screen = render(<NotificationOptInCard />);

  expect(screen.queryByText('notifications.privacy.briefEnabled')).toBeNull();
  expect(screen.queryByText('notifications.prompt.enable')).toBeNull();
});
