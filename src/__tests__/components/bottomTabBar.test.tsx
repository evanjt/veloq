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
import { fireEvent, render, waitFor, within } from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';

import { BottomTabBar } from '@/shared/ui/BottomTabBar';
import { colors, darkColors } from '@/theme';
import { faceWeight } from '@/theme/typography';

// A tab's glyph is decoration, hidden from the screen reader, so a query reaches it only here.
const HIDDEN = { includeHiddenElements: true };

jest.mock('expo-haptics', () => ({
  ...jest.requireActual('expo-haptics'),
  selectionAsync: jest.fn(() => Promise.resolve()),
  impactAsync: jest.fn(() => Promise.resolve()),
  performAndroidHapticsAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light' },
}));

// The ripple Android selects, so a tab is checked against the value it gets on that platform.
jest.mock('@/shared/ui/pressFeedback', () => ({
  ...jest.requireActual('@/shared/ui/pressFeedback'),
  pressRipple: { borderless: false },
}));

// A touch as the responder system reports it, which is what drives a Pressable's pressed state.
const touchHistory = {
  touchBank: [],
  numberActiveTouches: 0,
  indexOfSingleActiveTouch: -1,
  mostRecentTimeStamp: 0,
};
const grant = (node: ReactTestInstance) =>
  fireEvent(node, 'responderGrant', { touchHistory, nativeEvent: {}, persist: () => {} });
const endTouch = (node: ReactTestInstance) =>
  fireEvent(node, 'responderTerminate', { touchHistory, nativeEvent: {}, persist: () => {} });

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
    const CASES = (['ios', 'android'] as const).flatMap((os) =>
      THEMES.map((theme) => ({ os, theme, name: theme.name }))
    );
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

    it.each(CASES)(
      'draws the selected glyph in controlOn and the others in iconSecondary on $os in $name',
      async ({ os, theme }) => {
        Platform.OS = os;
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

    it('sets the selected label in the heaviest face and the others in the lightest', async () => {
      const { getByText } = await render(<BottomTabBar />);

      expect(StyleSheet.flatten(getByText('navigation.feed').props.style).fontWeight).toBe(
        faceWeight('700')
      );
      expect(StyleSheet.flatten(getByText('navigation.fitness').props.style).fontWeight).toBe(
        faceWeight('400')
      );
    });

    it('keeps the selected label heavier than the rest with bold text on', async () => {
      expect(Number(faceWeight('700', true))).toBeGreaterThan(Number(faceWeight('400', true)));
    });

    it('shrinks a long label to a 0.8 floor on one line rather than cutting it off', async () => {
      const { getByText } = await render(<BottomTabBar />);
      const label = getByText('navigation.fitness').props;

      expect(label.numberOfLines).toBe(1);
      expect(label.adjustsFontSizeToFit).toBe(true);
      expect(label.minimumFontScale).toBe(0.8);
    });

    it.each(CASES)('draws no tinted indicator on $os in $name', async ({ os, theme }) => {
      Platform.OS = os;
      mockIsDark = theme.isDark;
      const { queryAllByTestId } = await render(<BottomTabBar />);

      expect(queryAllByTestId(/^bottom-tab-.*-indicator$/, HIDDEN)).toHaveLength(0);
    });

    it.each(CASES)('draws no cap and no lift on the selected tab on $os in $name', async (c) => {
      Platform.OS = c.os;
      mockIsDark = c.theme.isDark;
      mockPathname = '/insights';
      const { queryAllByTestId, getByLabelText } = await render(<BottomTabBar />);

      expect(queryAllByTestId(/^bottom-tab-.*-cap$/, HIDDEN)).toHaveLength(0);
      const tab = getByLabelText('navigation.insights');
      const glyph = within(tab).UNSAFE_getByProps({ testID: 'bottom-tab-insights-glyph' });
      for (let at: ReactTestInstance | null = glyph; at && at !== tab; at = at.parent) {
        expect(StyleSheet.flatten(at.props.style ?? {}).transform).toBeUndefined();
      }
    });

    it.each(CASES)('draws no ripple and no fade on a tab on $os in $name', async (c) => {
      Platform.OS = c.os;
      mockIsDark = c.theme.isDark;
      const { getByLabelText, UNSAFE_root } = await render(<BottomTabBar />);
      const tab = getByLabelText('navigation.fitness');
      const press = UNSAFE_root.find(
        (node) =>
          node.props.accessibilityLabel === 'navigation.fitness' && 'android_ripple' in node.props
      );

      await grant(tab);

      expect(press.props.android_ripple).toBeUndefined();
      expect(StyleSheet.flatten(getByLabelText('navigation.fitness').props.style).opacity).toBe(
        undefined
      );
    });

    it.each(CASES)(
      'brightens the pressed tab to the selected colours and lets go when the touch ends on $os in $name',
      async (c) => {
        Platform.OS = c.os;
        mockIsDark = c.theme.isDark;
        const { getByLabelText, getByText } = await render(<BottomTabBar />);
        const colourOf = () => ({
          glyph: getByLabelText('navigation.fitness').findByProps({
            testID: 'bottom-tab-fitness-glyph',
          }).props.color,
          label: StyleSheet.flatten(getByText('navigation.fitness').props.style).color,
        });

        expect(colourOf()).toEqual({
          glyph: c.theme.palette.iconSecondary,
          label: c.theme.palette.textSecondary,
        });
        await grant(getByLabelText('navigation.fitness'));
        expect(colourOf()).toEqual({
          glyph: c.theme.palette.controlOn,
          label: c.theme.palette.textPrimary,
        });
        await endTouch(getByLabelText('navigation.fitness'));
        // A press stays drawn for the pressability's minimum duration after the finger lifts.
        await waitFor(() =>
          expect(colourOf()).toEqual({
            glyph: c.theme.palette.iconSecondary,
            label: c.theme.palette.textSecondary,
          })
        );
      }
    );

    it('keeps the outline glyph and the light label while pressed, until the tab is selected', async () => {
      const { getByLabelText, getByText } = await render(<BottomTabBar />);

      await grant(getByLabelText('navigation.fitness'));

      const glyph = getByLabelText('navigation.fitness').findByProps({
        testID: 'bottom-tab-fitness-glyph',
      }).props;
      expect(glyph.name).toMatch(/-outline$/);
      expect(StyleSheet.flatten(getByText('navigation.fitness').props.style).fontWeight).toBe(
        faceWeight('400')
      );
    });
  });
});
