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
import { Linking, Modal } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';

import { NotificationOptInCard } from '@/features/home/components/NotificationOptInCard';
import { Card } from '@/shared/ui/Card';
import { useNotificationPreferences } from '@/features/settings/stores/NotificationPreferencesStore';
import { useNotificationPrompt } from '@/features/settings/stores/NotificationPromptStore';
import { requestNotificationPermission } from '@/features/settings/lib/notificationService';
import { useWhatsNewStore } from '@/features/settings/stores/WhatsNewStore';
import enGB from '@/i18n/locales/en-GB.json';

const mockTranslation = jest.fn((key: string) => key);
jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({ t: mockTranslation }),
}));
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('@/features/settings/lib/notificationService', () => ({
  requestNotificationPermission: jest.fn().mockResolvedValue('granted'),
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
  mockTranslation.mockImplementation((key: string) => key);
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
  useWhatsNewStore.setState({ tourState: null });
  useWhatsNewStore.setState({ launchModal: null, restoreOffered: false });
});

describe('not enabled', () => {
  it('describes the notification kinds available in Settings', async () => {
    mockTranslation.mockImplementation((key: string) => {
      if (key === 'notifications.prompt.description') return enGB.notifications.prompt.description;
      return key;
    });
    const screen = await render(<NotificationOptInCard libraryCount={1} />);
    const description = screen.getByText(enGB.notifications.prompt.description).props.children;

    expect(description).toContain(enGB.notifications.settings.sectionPr.toLowerCase());
    expect(description).toContain(enGB.notifications.settings.fitnessMilestone.toLowerCase());
    expect(description).not.toMatch(/sync|ready/i);
  });

  it('shows a title, one line and the buttons, with the disclosure collapsed', async () => {
    const screen = await render(<NotificationOptInCard libraryCount={1} />);

    expect(screen.getByText('notifications.prompt.title')).toBeTruthy();
    expect(screen.getByText('notifications.prompt.description')).toBeTruthy();
    expect(screen.queryByText('notifications.privacy.brief')).toBeNull();
    expect(screen.queryByText('notifications.prompt.revokeHint')).toBeNull();
    expect(screen.queryByText('login.privacyPolicy')).toBeNull();
    expect(screen.UNSAFE_getByType(Card).props.variant).toBe('raised');
    expect(screen.UNSAFE_queryAllByType(Modal)).toHaveLength(0);
  });

  it('opens the disclosure in the card on Details, with no modal', async () => {
    const screen = await render(<NotificationOptInCard libraryCount={1} />);

    await fireEvent.press(screen.getByText('notifications.prompt.howItWorks'));

    expect(screen.getByText('notifications.privacy.brief')).toBeTruthy();
    expect(screen.getByText('login.privacyPolicy')).toBeTruthy();
    expect(screen.UNSAFE_queryAllByType(Modal)).toHaveLength(0);
    expect(prefs().privacyAccepted).toBe(false);
  });

  it('closes the disclosure on a second press', async () => {
    const screen = await render(<NotificationOptInCard libraryCount={1} />);

    await fireEvent.press(screen.getByText('notifications.prompt.howItWorks'));
    await fireEvent.press(screen.getByText('notifications.prompt.howItWorks'));

    expect(screen.queryByText('notifications.privacy.brief')).toBeNull();
  });

  it('is a disclosure button to a screen reader, saying whether it is open', async () => {
    const screen = await render(<NotificationOptInCard libraryCount={1} />);
    const toggle = () => screen.getByRole('button', { name: 'notifications.prompt.howItWorks' });

    expect(toggle().props.accessibilityState).toMatchObject({ expanded: false });
    await fireEvent.press(toggle());
    expect(toggle().props.accessibilityState).toMatchObject({ expanded: true });
  });

  it('records consent and enables in one tap', async () => {
    const screen = await render(<NotificationOptInCard libraryCount={1} />);

    await act(async () => {
      await fireEvent.press(screen.getByText('notifications.prompt.enable'));
    });

    expect(prefs().privacyAccepted).toBe(true);
    expect(prefs().enabled).toBe(true);
  });

  it('leaves consent unrecorded when the permission is refused', async () => {
    (requestNotificationPermission as jest.Mock).mockResolvedValueOnce('askable');
    const screen = await render(<NotificationOptInCard libraryCount={1} />);

    await act(async () => {
      await fireEvent.press(screen.getByText('notifications.prompt.enable'));
    });

    expect(prefs().enabled).toBe(false);
    expect(prefs().privacyAccepted).toBe(false);
  });

  it('says notifications are off and offers settings once the system stops asking', async () => {
    (requestNotificationPermission as jest.Mock).mockResolvedValueOnce('blocked');
    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    const screen = await render(<NotificationOptInCard libraryCount={1} />);

    await act(async () => {
      await fireEvent.press(screen.getByText('notifications.prompt.enable'));
    });

    expect(screen.getByTestId('notification-optin-blocked')).toBeTruthy();
    expect(screen.getByText('permissionNotice.notificationsOff')).toBeTruthy();
    await fireEvent.press(screen.getByText('common.openSettings'));
    expect(openSettings).toHaveBeenCalledTimes(1);
    expect(prefs().enabled).toBe(false);
    expect(prefs().privacyAccepted).toBe(false);
    openSettings.mockRestore();
  });

  it('shows no notice while the system will still ask', async () => {
    (requestNotificationPermission as jest.Mock).mockResolvedValueOnce('askable');
    const screen = await render(<NotificationOptInCard libraryCount={1} />);

    await act(async () => {
      await fireEvent.press(screen.getByText('notifications.prompt.enable'));
    });

    expect(screen.queryByTestId('notification-optin-blocked')).toBeNull();
  });

  it('records nothing on Not now', async () => {
    const screen = await render(<NotificationOptInCard libraryCount={1} />);

    await fireEvent.press(screen.getByText('notifications.prompt.dismiss'));

    expect(prefs().privacyAccepted).toBe(false);
    expect(prefs().enabled).toBe(false);
  });
});

describe('owed: enabled without consent', () => {
  beforeEach(() => {
    useNotificationPreferences.setState({ enabled: true, privacyAccepted: false });
  });

  it('shows the receiving wording inline with no modal, even after Not now was chosen', async () => {
    useNotificationPrompt.setState({ dismissed: true });
    const screen = await render(<NotificationOptInCard libraryCount={1} />);

    expect(screen.getByText('notifications.privacy.briefEnabled')).toBeTruthy();
    expect(screen.queryByText('notifications.prompt.howItWorks')).toBeNull();
    expect(screen.queryByText('notifications.prompt.revokeHint')).toBeNull();
    expect(screen.UNSAFE_queryAllByType(Modal)).toHaveLength(0);
  });

  it('Keep records consent and keeps notifications on', async () => {
    const screen = await render(<NotificationOptInCard libraryCount={1} />);

    await fireEvent.press(screen.getByText('notifications.prompt.keep'));

    expect(prefs().privacyAccepted).toBe(true);
    expect(prefs().enabled).toBe(true);
  });

  it('Turn off disables without recording consent', async () => {
    const screen = await render(<NotificationOptInCard libraryCount={1} />);

    await fireEvent.press(screen.getByText('notifications.privacy.turnOff'));

    expect(prefs().enabled).toBe(false);
    expect(prefs().privacyAccepted).toBe(false);
  });

  it('is absent until the stored preferences have loaded', async () => {
    useNotificationPreferences.setState({ isLoaded: false });
    const screen = await render(<NotificationOptInCard libraryCount={1} />);

    expect(screen.queryByText('notifications.privacy.briefEnabled')).toBeNull();
  });
});

it('shows nothing once consent is recorded and notifications are on', async () => {
  useNotificationPreferences.setState({ enabled: true, privacyAccepted: true });
  const screen = await render(<NotificationOptInCard libraryCount={1} />);

  expect(screen.queryByText('notifications.privacy.briefEnabled')).toBeNull();
  expect(screen.queryByText('notifications.prompt.enable')).toBeNull();
});

describe('on a first launch', () => {
  it('asks nothing while the tour is open, and asks once it closes', async () => {
    useWhatsNewStore.getState().startTour('tutorial');
    const screen = await render(<NotificationOptInCard libraryCount={1} />);
    expect(screen.queryByText('notifications.prompt.enable')).toBeNull();

    await act(async () => {
      useWhatsNewStore.getState().endTour();
    });
    expect(screen.getByText('notifications.prompt.enable')).toBeTruthy();
  });

  it('asks nothing until the library holds an activity', async () => {
    const screen = await render(<NotificationOptInCard libraryCount={0} />);
    expect(screen.queryByText('notifications.prompt.enable')).toBeNull();

    await screen.rerender(<NotificationOptInCard libraryCount={1} />);
    expect(screen.getByText('notifications.prompt.enable')).toBeTruthy();
  });

  it('asks nothing while the restore offer is unanswered', async () => {
    useWhatsNewStore.setState({ restoreOffered: true });
    const screen = await render(<NotificationOptInCard libraryCount={1} />);
    expect(screen.queryByText('notifications.prompt.enable')).toBeNull();
  });
});
