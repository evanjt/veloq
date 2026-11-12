/**
 * Scenario: an unfolded display held on its side puts the system status bar and its cutout on a
 * side edge. The tab bar spans the window's width, so its outer tabs would sit under that edge.
 *
 * Expected behaviour: the tab row is padded by the left and right safe-area insets, and the bar's
 * surface and hairline still run the full width.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';

import { BottomTabBar } from '@/shared/ui/BottomTabBar';

let mockInsets = { top: 0, bottom: 24, left: 0, right: 0 };

jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  router: { navigate: jest.fn() },
  usePathname: () => '/',
  useSegments: () => ['(tabs)'],
}));

jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false, preferOpaqueChrome: false }),
}));

jest.mock('@/shared/app/AuthStore', () => ({
  useAuthStore: (selector: (s: { isAuthenticated: boolean }) => unknown) =>
    selector({ isAuthenticated: true }),
}));

jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => mockInsets,
}));

jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());

describe('BottomTabBar beside a side inset', () => {
  it('pads the tab row by the side insets and leaves the surface full width', async () => {
    mockInsets = { top: 0, bottom: 21, left: 0, right: 38 };

    const { getByTestId } = await render(<BottomTabBar />);

    const row = StyleSheet.flatten(getByTestId('bottom-tab-row').props.style);
    expect(row.paddingLeft).toBe(0);
    expect(row.paddingRight).toBe(38);
    const surface = StyleSheet.flatten(getByTestId('bottom-tab-bar-surface').props.style);
    expect(surface).toMatchObject({ left: 0, right: 0 });
  });

  it('pads neither side on a window with no side inset', async () => {
    mockInsets = { top: 0, bottom: 24, left: 0, right: 0 };

    const { getByTestId } = await render(<BottomTabBar />);

    const row = StyleSheet.flatten(getByTestId('bottom-tab-row').props.style);
    expect(row.paddingLeft).toBe(0);
    expect(row.paddingRight).toBe(0);
  });
});
