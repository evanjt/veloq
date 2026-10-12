/**
 * Scenario: turning notifications on for the first time shows the notice that
 * names what the server stores and who routes the push.
 *
 * Expected behaviour: it is the platform alert, the decline button comes first,
 * accepting continues to the permission request, and declining or dismissing
 * leaves notifications off.
 */

import React from 'react';
import { Alert, Linking, type AlertButton } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';

import { NotificationSection } from '@/features/settings/components/NotificationSection';
import { useNotificationPreferences } from '@/features/settings/stores/NotificationPreferencesStore';
import { requestNotificationPermission } from '@/features/settings/lib/notificationService';

jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysOnly());
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('@/features/settings/lib/notificationService', () => ({
  hasNotificationPermission: jest.fn().mockResolvedValue(true),
  requestNotificationPermission: jest.fn().mockResolvedValue('granted'),
  registerForPushNotifications: jest.fn().mockResolvedValue(undefined),
  unregisterFromPushNotifications: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/shared/app/AuthStore', () => ({
  useAuthStore: (select: (s: unknown) => unknown) =>
    select({ authMethod: 'oauth', isDemoMode: false }),
}));

const setEnabled = jest.fn();
const acceptPrivacy = jest.fn();
let alertSpy: jest.SpyInstance;

function givenFirstRun() {
  useNotificationPreferences.setState({
    enabled: false,
    privacyAccepted: false,
    pendingUnregister: false,
    setEnabled,
    acceptPrivacy,
  } as never);
}

async function turnOn(tree: Awaited<ReturnType<typeof render>>) {
  await fireEvent.press(tree.getByTestId('settings-notifications-toggle'));
}

function lastAlert() {
  const [title, body, buttons, options] = alertSpy.mock.calls[alertSpy.mock.calls.length - 1] as [
    string,
    string,
    AlertButton[],
    { cancelable?: boolean; onDismiss?: () => void },
  ];
  return { title, body, buttons, options };
}

beforeEach(() => {
  setEnabled.mockReset();
  acceptPrivacy.mockReset();
  (requestNotificationPermission as jest.Mock).mockClear();
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  givenFirstRun();
});

afterEach(() => alertSpy.mockRestore());

describe('the notification privacy notice', () => {
  it('is an alert with the privacy strings and the decline button first', async () => {
    await turnOn(await render(<NotificationSection />));

    expect(alertSpy).toHaveBeenCalledTimes(1);
    const { title, body, buttons } = lastAlert();
    expect(title).toBe('notifications.privacy.title');
    expect(body).toBe('notifications.privacy.brief');
    expect(buttons.map((b) => b.text)).toEqual(['common.cancel', 'notifications.privacy.accept']);
    expect(buttons[0].style).toBe('cancel');
  });

  it('is not shown again once the privacy notice has been accepted', async () => {
    useNotificationPreferences.setState({ privacyAccepted: true } as never);
    await turnOn(await render(<NotificationSection />));
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('accepting records consent and asks for the permission', async () => {
    await turnOn(await render(<NotificationSection />));
    await act(async () => {
      lastAlert().buttons[1].onPress?.();
    });

    expect(acceptPrivacy).toHaveBeenCalledTimes(1);
    expect(requestNotificationPermission).toHaveBeenCalledTimes(1);
    expect(setEnabled).toHaveBeenCalledWith(true);
  });

  it('declining and dismissing leave notifications off and consent unrecorded', async () => {
    await turnOn(await render(<NotificationSection />));
    const { buttons, options } = lastAlert();
    expect(options.cancelable).toBe(true);

    await act(async () => {
      buttons[0].onPress?.();
      options.onDismiss?.();
    });

    expect(acceptPrivacy).not.toHaveBeenCalled();
    expect(requestNotificationPermission).not.toHaveBeenCalled();
    expect(setEnabled).not.toHaveBeenCalled();
  });
});

describe('notifications refused for good', () => {
  beforeEach(() => {
    useNotificationPreferences.setState({ privacyAccepted: true } as never);
    (requestNotificationPermission as jest.Mock).mockResolvedValueOnce('blocked');
  });

  it('leaves the switch off and says so, with the settings page one tap away', async () => {
    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    const tree = await render(<NotificationSection />);
    await act(async () => turnOn(tree));

    expect(setEnabled).not.toHaveBeenCalled();
    expect(tree.getByTestId('settings-notifications-blocked')).toBeTruthy();
    expect(tree.getByText('permissionNotice.notificationsOff')).toBeTruthy();
    await fireEvent.press(tree.getByText('common.openSettings'));
    expect(openSettings).toHaveBeenCalledTimes(1);
    openSettings.mockRestore();
  });
});
