/**
 * Scenario: an athlete turns Reduce Transparency on or off while the tab bar
 * is drawn over the list and the map.
 *
 * Expected behaviour: the bar draws on its opaque surface with a divider and
 * no fade either way, so its labels never take their contrast from content.
 */

import React from 'react';
import { AccessibilityInfo, Platform, StyleSheet } from 'react-native';
import { act, render } from '@testing-library/react-native';

import { BottomTabBar } from '@/shared/ui/BottomTabBar';
import { watchOpaqueChrome } from '@/shared/app/ThemeProvider';

jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  usePathname: () => '/',
  useSegments: () => ['(tabs)'],
}));

jest.mock('@/shared/app', () => ({
  useTheme: jest.requireActual('@/shared/app/useTheme').useTheme,
}));

jest.mock('@/shared/app/AuthStore', () => ({
  useAuthStore: (selector: (s: { isAuthenticated: boolean }) => unknown) =>
    selector({ isAuthenticated: true }),
}));

jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 0, bottom: 24, left: 0, right: 0 }),
}));

jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());

const originalOS = Platform.OS;
let stop: (() => void) | null = null;

async function startWatch() {
  await act(async () => {
    stop = watchOpaqueChrome();
    await new Promise((resolve) => setImmediate(resolve));
  });
}

beforeEach(() => {
  Platform.OS = 'ios';
  jest.spyOn(AccessibilityInfo, 'isReduceTransparencyEnabled').mockResolvedValue(false);
  jest.spyOn(AccessibilityInfo, 'isDarkerSystemColorsEnabled').mockResolvedValue(false);
});

afterEach(() => {
  stop?.();
  stop = null;
  Platform.OS = originalOS;
  jest.restoreAllMocks();
});

describe('BottomTabBar with Reduce Transparency', () => {
  it('draws an opaque surface with a divider and no gradient', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceTransparencyEnabled').mockResolvedValue(true);
    await startWatch();

    const { getByTestId, queryByTestId } = await render(<BottomTabBar />);

    expect(queryByTestId('bottom-tab-bar-gradient')).toBeNull();
    const surface = StyleSheet.flatten(getByTestId('bottom-tab-bar-surface').props.style);
    expect(surface.backgroundColor).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(surface.borderTopWidth).toBeGreaterThan(0);
  });

  it('draws the same opaque surface while the setting is off', async () => {
    await startWatch();

    const { getByTestId, queryByTestId } = await render(<BottomTabBar />);

    expect(queryByTestId('bottom-tab-bar-gradient')).toBeNull();
    const surface = StyleSheet.flatten(getByTestId('bottom-tab-bar-surface').props.style);
    expect(surface.backgroundColor).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(surface.borderTopWidth).toBeGreaterThan(0);
  });
});
