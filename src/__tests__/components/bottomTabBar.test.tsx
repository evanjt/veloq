/**
 * Scenario: the tab bar is mounted at the layout root, above the Stack, so it
 * paints over whatever screen is showing.
 *
 * Expected behaviour: a signed-out user gets no tabs. The five destinations
 * are unreachable without a session, and the bar's band collides with the
 * login card's footer line.
 */

import React from 'react';
import { Platform, StyleSheet } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';

import { BottomTabBar } from '@/shared/ui/BottomTabBar';
import { colorWithOpacity, colors, darkColors, opacity } from '@/theme';

// A tab's glyph is decoration, hidden from the screen reader, so a query reaches it only here.
const HIDDEN = { includeHiddenElements: true };

jest.mock('expo-haptics', () => ({
  ...jest.requireActual('expo-haptics'),
  selectionAsync: jest.fn(() => Promise.resolve()),
  impactAsync: jest.fn(() => Promise.resolve()),
  performAndroidHapticsAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light' },
}));

let mockSegments: string[] = ['(tabs)'];
let mockPathname = '/';
let mockIsDark = false;

// The router refuses to navigate before an app root has rendered, and the bar renders alone.
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  router: { navigate: jest.fn() },
  usePathname: () => mockPathname,
  useSegments: () => mockSegments,
}));

const authState = { isAuthenticated: false, isDemoMode: false };

jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: mockIsDark, preferOpaqueChrome: false }),
}));

jest.mock('@/shared/app/AuthStore', () => ({
  useAuthStore: (selector: (s: typeof authState) => unknown) => selector(authState),
}));

jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 0, bottom: 24, left: 0, right: 0 }),
}));

jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());

describe('BottomTabBar', () => {
  beforeEach(() => {
    authState.isAuthenticated = false;
    authState.isDemoMode = false;
    mockSegments = ['(tabs)'];
    mockPathname = '/';
    mockIsDark = false;
    jest.clearAllMocks();
  });

  it('renders nothing on a stack screen outside the tabs group', async () => {
    authState.isAuthenticated = true;
    mockSegments = ['backup-settings'];

    const { queryByTestId } = await render(<BottomTabBar />);

    expect(queryByTestId('bottom-tab-bar')).toBeNull();
  });

  it('renders nothing on the recording screen', async () => {
    authState.isAuthenticated = true;
    mockSegments = ['record'];

    const { queryByTestId } = await render(<BottomTabBar />);

    expect(queryByTestId('bottom-tab-bar')).toBeNull();
  });

  it('renders nothing without a session', async () => {
    const { queryByTestId } = await render(<BottomTabBar />);

    expect(queryByTestId('bottom-tab-bar')).toBeNull();
  });

  it('renders the destinations for a signed-in athlete', async () => {
    authState.isAuthenticated = true;

    const { getByTestId, getByLabelText } = await render(<BottomTabBar />);

    expect(getByTestId('bottom-tab-bar')).toBeTruthy();
    expect(getByLabelText('navigation.feed')).toBeTruthy();
  });

  it('carries Settings as the fifth tab, under its own short label, and opens it', async () => {
    authState.isAuthenticated = true;
    const { getAllByRole, getByLabelText } = await render(<BottomTabBar />);

    expect(getAllByRole('tab').map((tab) => tab.props.accessibilityLabel)).toEqual([
      'navigation.feed',
      'navigation.fitness',
      'navigation.map',
      'navigation.insights',
      'navigation.settingsTab',
    ]);
    await fireEvent.press(getByLabelText('navigation.settingsTab'));
    expect(router.navigate).toHaveBeenCalledWith('/settings');
  });

  it('renders the destinations in demo mode', async () => {
    authState.isAuthenticated = true;
    authState.isDemoMode = true;

    const { getByTestId } = await render(<BottomTabBar />);

    expect(getByTestId('bottom-tab-bar')).toBeTruthy();
  });

  it('switching tab fires one selection haptic and no impact, and the current tab fires none', async () => {
    authState.isAuthenticated = true;
    const { getByLabelText } = await render(<BottomTabBar />);

    await fireEvent.press(getByLabelText('navigation.feed'));
    expect(Haptics.selectionAsync).not.toHaveBeenCalled();

    await fireEvent.press(getByLabelText('navigation.fitness'));

    expect(Haptics.selectionAsync).toHaveBeenCalledTimes(1);
    expect(Haptics.impactAsync).not.toHaveBeenCalled();
  });

  it('fires the selection haptic on Android too, and none for the current tab', async () => {
    const originalOS = Platform.OS;
    Platform.OS = 'android';
    try {
      authState.isAuthenticated = true;
      const { getByLabelText } = await render(<BottomTabBar />);

      await fireEvent.press(getByLabelText('navigation.feed'));
      expect(Haptics.performAndroidHapticsAsync).not.toHaveBeenCalled();

      await fireEvent.press(getByLabelText('navigation.fitness'));

      expect(Haptics.performAndroidHapticsAsync).toHaveBeenCalledTimes(1);
      expect(Haptics.performAndroidHapticsAsync).toHaveBeenCalledWith('segment-tick');
      expect(Haptics.selectionAsync).not.toHaveBeenCalled();
      expect(Haptics.impactAsync).not.toHaveBeenCalled();
    } finally {
      Platform.OS = originalOS;
    }
  });

  describe('the bar itself', () => {
    const TABS = [
      { key: 'feed', path: '/' },
      { key: 'fitness', path: '/fitness' },
      { key: 'map', path: '/map' },
      { key: 'insights', path: '/insights' },
      { key: 'settingsTab', path: '/settings' },
    ] as const;
    const THEMES = [
      { name: 'light', isDark: false, palette: colors },
      { name: 'dark', isDark: true, palette: darkColors },
    ] as const;
    const originalOS = Platform.OS;

    beforeEach(() => {
      authState.isAuthenticated = true;
    });

    afterEach(() => {
      Platform.OS = originalOS;
    });

    async function glyph(key: string) {
      const { UNSAFE_getByProps } = await render(<BottomTabBar />);
      return UNSAFE_getByProps({ testID: `bottom-tab-${key}-glyph` }).props;
    }

    it.each(THEMES)(
      'draws on an opaque surface with a hairline and no fade in $name',
      async (theme) => {
        mockIsDark = theme.isDark;
        const { getByTestId, queryByTestId } = await render(<BottomTabBar />);

        expect(queryByTestId('bottom-tab-bar-gradient')).toBeNull();
        const surface = StyleSheet.flatten(getByTestId('bottom-tab-bar-surface').props.style);
        expect(surface.backgroundColor).toBe(theme.palette.surface);
        expect(surface.borderTopColor).toBe(theme.palette.border);
        expect(surface.borderTopWidth).toBeGreaterThan(0);
      }
    );

    it.each(TABS)('fills the $key glyph when selected and outlines it when not', async (tab) => {
      mockPathname = tab.path;
      const selected = (await glyph(tab.key)).name;
      mockPathname = tab.path === '/' ? '/map' : '/';
      const unselected = (await glyph(tab.key)).name;

      expect(selected).not.toBe(unselected);
      expect(unselected).toMatch(/-outline$/);
      expect(`${selected}-outline`).toBe(unselected);
    });

    it.each(THEMES)(
      'draws the selected glyph in controlOn and the others in iconSecondary in $name',
      async (theme) => {
        Platform.OS = 'ios';
        mockIsDark = theme.isDark;

        expect((await glyph('feed')).color).toBe(theme.palette.controlOn);
        expect((await glyph('fitness')).color).toBe(theme.palette.iconSecondary);
      }
    );

    it.each(THEMES)(
      'draws the selected label in textPrimary and the others in textSecondary in $name',
      async (theme) => {
        mockIsDark = theme.isDark;
        const { getByText } = await render(<BottomTabBar />);

        expect(StyleSheet.flatten(getByText('navigation.feed').props.style).color).toBe(
          theme.palette.textPrimary
        );
        expect(StyleSheet.flatten(getByText('navigation.fitness').props.style).color).toBe(
          theme.palette.textSecondary
        );
      }
    );

    it('shrinks a long label to a 0.8 floor on one line rather than cutting it off', async () => {
      const { getByText } = await render(<BottomTabBar />);
      const label = getByText('navigation.fitness').props;

      expect(label.numberOfLines).toBe(1);
      expect(label.adjustsFontSizeToFit).toBe(true);
      expect(label.minimumFontScale).toBe(0.8);
    });

    it('draws no indicator on iOS', async () => {
      Platform.OS = 'ios';
      const { queryAllByTestId } = await render(<BottomTabBar />);

      expect(queryAllByTestId(/^bottom-tab-.*-indicator$/, HIDDEN)).toHaveLength(0);
    });

    it.each(THEMES)(
      'puts the Android indicator behind the selected tab only, in $name',
      async (theme) => {
        Platform.OS = 'android';
        mockIsDark = theme.isDark;
        mockPathname = '/insights';
        const { getAllByTestId, UNSAFE_getByProps } = await render(<BottomTabBar />);

        const indicators = getAllByTestId(/^bottom-tab-.*-indicator$/, HIDDEN);
        expect(indicators.map((node) => node.props.testID)).toEqual([
          'bottom-tab-insights-indicator',
        ]);
        const style = StyleSheet.flatten(indicators[0].props.style);
        expect(style.width).toBe(56);
        expect(style.height).toBe(28);
        expect(style.borderRadius).toBeGreaterThanOrEqual(14);
        expect(style.backgroundColor).toBe(
          colorWithOpacity(theme.palette.controlOn, opacity.tint3)
        );
        expect(UNSAFE_getByProps({ testID: 'bottom-tab-insights-glyph' }).props.color).toBe(
          theme.isDark ? theme.palette.textPrimary : theme.palette.controlOn
        );
        expect(UNSAFE_getByProps({ testID: 'bottom-tab-feed-glyph' }).props.color).toBe(
          theme.palette.iconSecondary
        );
      }
    );
  });
});
