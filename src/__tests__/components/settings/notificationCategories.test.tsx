/**
 * Scenario: two category flags shipped in the preferences store, defaulting on,
 * with no screen able to set either. An athlete who wanted fitness milestones
 * and not section PRs had no way to say so.
 *
 * Expected behaviour: a switch each, under the main one, inert while
 * notifications are off, each writing only its own flag.
 */

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import { NotificationSection } from '@/features/settings/components/NotificationSection';
import { useNotificationPreferences } from '@/features/settings/stores/NotificationPreferencesStore';

jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysOnly());
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('@/features/settings/lib/notificationService', () => ({
  hasNotificationPermission: jest.fn().mockResolvedValue(true),
  requestNotificationPermission: jest.fn().mockResolvedValue(true),
  registerForPushNotifications: jest.fn().mockResolvedValue(undefined),
  unregisterFromPushNotifications: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/shared/app/AuthStore', () => ({
  useAuthStore: (select: (s: unknown) => unknown) =>
    select({ authMethod: 'oauth', isDemoMode: false }),
}));

const setCategoryEnabled = jest.fn();

function givenPreferences(enabled: boolean, categories: Record<string, boolean>) {
  useNotificationPreferences.setState({
    enabled,
    privacyAccepted: true,
    pendingUnregister: false,
    categories: categories as { sectionPr: boolean; fitnessMilestone: boolean },
    setCategoryEnabled,
  } as never);
}

beforeEach(() => {
  setCategoryEnabled.mockReset();
});

describe('the notification category switches', () => {
  it('offers one for each flag once notifications are on', async () => {
    givenPreferences(true, { sectionPr: true, fitnessMilestone: true });
    const { getByTestId } = await render(<NotificationSection />);
    expect(getByTestId('settings-notifications-sectionPr')).toBeTruthy();
    expect(getByTestId('settings-notifications-fitnessMilestone')).toBeTruthy();
  });

  it('writes only the flag it belongs to', async () => {
    givenPreferences(true, { sectionPr: true, fitnessMilestone: true });
    const { getByTestId } = await render(<NotificationSection />);

    await fireEvent.press(getByTestId('settings-notifications-sectionPr'));
    expect(setCategoryEnabled).toHaveBeenCalledTimes(1);
    expect(setCategoryEnabled).toHaveBeenCalledWith('sectionPr', false);

    await fireEvent.press(getByTestId('settings-notifications-fitnessMilestone'));
    expect(setCategoryEnabled).toHaveBeenLastCalledWith('fitnessMilestone', false);
  });

  it('reads the flags rather than holding its own copy', async () => {
    givenPreferences(true, { sectionPr: false, fitnessMilestone: true });
    const { getByTestId } = await render(<NotificationSection />);
    expect(getByTestId('settings-notifications-sectionPr')).not.toBeChecked();
    expect(getByTestId('settings-notifications-fitnessMilestone')).toBeChecked();
  });

  it('names every switch, the two categories apart', async () => {
    givenPreferences(true, { sectionPr: true, fitnessMilestone: true });
    const { getAllByRole, getByRole } = await render(<NotificationSection />);

    expect(getAllByRole('switch')).toHaveLength(3);
    expect(getByRole('switch', { name: 'notifications.settings.enable' })).toBeTruthy();
    expect(getByRole('switch', { name: 'notifications.settings.sectionPr' })).toBeTruthy();
    expect(getByRole('switch', { name: 'notifications.settings.fitnessMilestone' })).toBeTruthy();
  });

  it('turns a category off from a tap on its name', async () => {
    givenPreferences(true, { sectionPr: true, fitnessMilestone: true });
    const { getByText } = await render(<NotificationSection />);

    await fireEvent.press(getByText('notifications.settings.sectionPr'));

    expect(setCategoryEnabled).toHaveBeenCalledTimes(1);
    expect(setCategoryEnabled).toHaveBeenCalledWith('sectionPr', false);
  });

  it('is inert while notifications are off, so a switch cannot promise a push', async () => {
    givenPreferences(false, { sectionPr: true, fitnessMilestone: true });
    const { getByTestId } = await render(<NotificationSection />);
    expect(getByTestId('settings-notifications-sectionPr')).toBeDisabled();
    expect(getByTestId('settings-notifications-fitnessMilestone')).toBeDisabled();
  });
});
