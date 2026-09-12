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

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
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
  it('offers one for each flag once notifications are on', () => {
    givenPreferences(true, { sectionPr: true, fitnessMilestone: true });
    const { getByTestId } = render(<NotificationSection />);
    expect(getByTestId('settings-notifications-sectionPr')).toBeTruthy();
    expect(getByTestId('settings-notifications-fitnessMilestone')).toBeTruthy();
  });

  it('writes only the flag it belongs to', () => {
    givenPreferences(true, { sectionPr: true, fitnessMilestone: true });
    const { getByTestId } = render(<NotificationSection />);

    fireEvent(getByTestId('settings-notifications-sectionPr'), 'valueChange', false);
    expect(setCategoryEnabled).toHaveBeenCalledTimes(1);
    expect(setCategoryEnabled).toHaveBeenCalledWith('sectionPr', false);

    fireEvent(getByTestId('settings-notifications-fitnessMilestone'), 'valueChange', false);
    expect(setCategoryEnabled).toHaveBeenLastCalledWith('fitnessMilestone', false);
  });

  it('reads the flags rather than holding its own copy', () => {
    givenPreferences(true, { sectionPr: false, fitnessMilestone: true });
    const { getByTestId } = render(<NotificationSection />);
    expect(getByTestId('settings-notifications-sectionPr').props.value).toBe(false);
    expect(getByTestId('settings-notifications-fitnessMilestone').props.value).toBe(true);
  });

  it('is inert while notifications are off, so a switch cannot promise a push', () => {
    givenPreferences(false, { sectionPr: true, fitnessMilestone: true });
    const { getByTestId } = render(<NotificationSection />);
    expect(getByTestId('settings-notifications-sectionPr').props.disabled).toBe(true);
    expect(getByTestId('settings-notifications-fitnessMilestone').props.disabled).toBe(true);
  });
});
