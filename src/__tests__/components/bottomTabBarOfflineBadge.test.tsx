/**
 * Scenario: the device loses its connection while the athlete is on a tab. The
 * offline pill draws at the top of the screen, and the tab bar carries the
 * state on the Settings tab.
 *
 * Expected behaviour: the Settings tab draws a warning-toned network-off glyph
 * and says "offline" in its label for as long as the provider reports an offline
 * indicator. Online, the tab is the plain tab. Only the Settings tab carries it.
 */

import React from 'react';
import { render, within } from '@testing-library/react-native';

import { BottomTabBar } from '@/shared/ui/BottomTabBar';
import type { OfflineIndicator } from '@/shared/app/NetworkContext';

let mockIndicator: OfflineIndicator = 'none';

jest.mock('@/shared/app/NetworkContext', () => ({
  useOfflineIndicator: () => mockIndicator,
}));

jest.mock('expo-haptics', () => ({
  ...jest.requireActual('expo-haptics'),
  selectionAsync: jest.fn(() => Promise.resolve()),
  impactAsync: jest.fn(() => Promise.resolve()),
  performAndroidHapticsAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light' },
}));

jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  router: { navigate: jest.fn() },
  usePathname: () => '/',
  useSegments: () => ['(tabs)'],
}));

const authState = { isAuthenticated: true, isDemoMode: false };

jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false, preferOpaqueChrome: false }),
}));

jest.mock('@/shared/app/AuthStore', () => ({
  useAuthStore: (selector: (s: typeof authState) => unknown) => selector(authState),
}));

jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 0, bottom: 24, left: 0, right: 0 }),
}));

jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());

const SETTINGS_BADGE = 'bottom-tab-settingsTab-offline-badge';
const SETTINGS_ONLINE_LABEL = 'navigation.settingsTab';
const SETTINGS_OFFLINE_LABEL = 'navigation.settingsTab, navigation.offline';

describe('BottomTabBar offline badge', () => {
  beforeEach(() => {
    mockIndicator = 'none';
  });

  it('draws the network-off glyph on the Settings tab while offline, and says so in its label', async () => {
    mockIndicator = 'badge';

    const { getByLabelText, getByTestId } = await render(<BottomTabBar />);

    const settingsTab = getByLabelText(SETTINGS_OFFLINE_LABEL);
    expect(within(settingsTab).getByTestId(SETTINGS_BADGE)).toBeTruthy();
    expect(getByTestId(SETTINGS_BADGE)).toBeTruthy();
  });

  it('keeps the glyph while the offline pill is still showing, since the device is offline either way', async () => {
    mockIndicator = 'pill';

    const { getByLabelText } = await render(<BottomTabBar />);

    expect(within(getByLabelText(SETTINGS_OFFLINE_LABEL)).getByTestId(SETTINGS_BADGE)).toBeTruthy();
  });

  it('draws no glyph and no offline word while online', async () => {
    mockIndicator = 'none';

    const { getByLabelText, queryByTestId } = await render(<BottomTabBar />);

    expect(queryByTestId(SETTINGS_BADGE)).toBeNull();
    expect(getByLabelText(SETTINGS_ONLINE_LABEL)).toBeTruthy();
  });

  it('marks only the Settings tab, not the other four', async () => {
    mockIndicator = 'badge';

    const { getAllByRole } = await render(<BottomTabBar />);

    const tabs = getAllByRole('tab');
    expect(tabs).toHaveLength(5);
    const others = tabs.filter((tab) => tab.props.accessibilityLabel !== SETTINGS_OFFLINE_LABEL);
    expect(others).toHaveLength(4);
    for (const tab of others) {
      expect(within(tab).queryByTestId(/bottom-tab-.*-offline-badge/)).toBeNull();
    }
  });
});
