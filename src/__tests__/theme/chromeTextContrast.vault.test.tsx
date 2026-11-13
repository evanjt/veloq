/**
 * Scenario: the shared chrome drew its quieter text by dimming a text token,
 * through a style `opacity` or a colour built at an alpha, and the token test
 * measures the token rather than what lands. The tab bar's inactive labels were
 * black at 0.45, 3.27:1 over its scrim; the attribution line was
 * `textSecondary` at 0.7, 3.62:1; a slower-than-best tab badge was near-black
 * on grey, 2.29:1; and a tab count kept its light ink in dark, 1.93:1.
 *
 * Expected behaviour: every one of these texts clears 4.5:1 on the colour
 * actually behind it in both themes, measured after compositing, and the tab
 * bar's glyphs clear 3:1 as marks.
 */

import React from 'react';
import { Platform, StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';

import { BottomTabBar } from '@/shared/ui/BottomTabBar';
import { DeviceAttribution } from '@/shared/ui/GarminAttribution';
import { SwipeableTabs, type SwipeableTab } from '@/shared/ui';
import { colors, darkColors } from '@/theme';

import { AA_TEXT, composite, contrastRatio, renderedTextColour } from '../__shared__/contrast';

jest.mock('expo-haptics', () => ({
  ...jest.requireActual('expo-haptics'),
  selectionAsync: jest.fn(() => Promise.resolve()),
  impactAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light' },
}));

jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  usePathname: () => '/',
  useSegments: () => ['(tabs)'],
}));

let mockIsDark = false;
jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: mockIsDark }),
}));

const authState = {
  isAuthenticated: true,
  isDemoMode: false,
  hideDemoBanner: false,
  setHideDemoBanner: () => {},
};
jest.mock('@/shared/app/AuthStore', () => ({
  useAuthStore: (selector: (s: typeof authState) => unknown) => selector(authState),
}));

jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 0, bottom: 24, left: 0, right: 0 }),
}));

jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());

const THEMES = [
  { name: 'light', isDark: false, palette: colors },
  { name: 'dark', isDark: true, palette: darkColors },
] as const;

const SURFACES = {
  light: [colors.surface, colors.surfacePage, colors.surfaceInput],
  dark: [
    darkColors.surfacePage,
    darkColors.surface,
    darkColors.surfaceRaised,
    darkColors.surfaceRaised,
  ],
};

afterEach(() => {
  mockIsDark = false;
});

describe('the bottom tab bar', () => {
  // The bar is opaque, so what lands behind a label or a glyph is its surface, and the cap over
  // the selected glyph is that same surface.
  const MARK = 3;
  const originalOS = Platform.OS;

  afterEach(() => {
    Platform.OS = originalOS;
  });

  function surfaceOf(getByTestId: (id: string) => ReactTestInstance): string {
    return StyleSheet.flatten(getByTestId('bottom-tab-bar-surface').props.style).backgroundColor;
  }

  it.each(THEMES)(
    'labels clear 4.5:1 on its surface in the $name theme, selected and not',
    async (theme) => {
      mockIsDark = theme.isDark;
      const { getByTestId, getByText } = await render(<BottomTabBar />);
      const ground = surfaceOf(getByTestId);

      // The feed is the selected tab at `/`, the fitness tab an unselected one.
      const failing = ['navigation.feed', 'navigation.fitness'].flatMap((label) => {
        const colour = renderedTextColour(getByText(label).props.style, ground);
        const ratio = contrastRatio(colour, ground);
        return ratio >= AA_TEXT ? [] : [`${label} ${ratio.toFixed(2)}`];
      });

      expect(failing).toStrictEqual([]);
    }
  );

  const PLATFORMS = ['ios', 'android'] as const;
  const CASES = PLATFORMS.flatMap((os) => THEMES.map((theme) => ({ os, theme, name: theme.name })));

  it.each(CASES)(
    'glyphs clear 3:1 on its surface on $os in the $name theme, selected and not',
    async ({ os, theme }) => {
      Platform.OS = os;
      mockIsDark = theme.isDark;
      const { getByTestId, UNSAFE_getByProps } = await render(<BottomTabBar />);
      const ground = surfaceOf(getByTestId);

      const failing = ['feed', 'fitness'].flatMap((key) => {
        const ratio = contrastRatio(
          UNSAFE_getByProps({ testID: `bottom-tab-${key}-glyph` }).props.color,
          ground
        );
        return ratio >= MARK ? [] : [`${key} ${ratio.toFixed(2)}`];
      });

      expect(failing).toStrictEqual([]);
    }
  );
});

describe('the swipeable tab strip badges', () => {
  const TABS: SwipeableTab[] = [
    { key: 'active', label: 'Active', icon: 'map-marker-path', count: 11 },
    { key: 'counted', label: 'Counted', icon: 'chart-line', count: 22 },
    { key: 'plain', label: 'Plain', icon: 'bike', count: 3 },
  ];

  function renderStrip(isDark: boolean) {
    return render(
      <SwipeableTabs tabs={TABS} activeTab="active" onTabChange={jest.fn()} isDark={isDark}>
        {TABS.map((tab) => (
          <React.Fragment key={tab.key} />
        ))}
      </SwipeableTabs>
    );
  }

  /** The fill of the closest view behind a text, which is the badge it sits on. */
  function nearestFill(node: ReactTestInstance): string | undefined {
    for (let at: ReactTestInstance | null = node; at; at = at.parent) {
      const fill = StyleSheet.flatten(at.props.style ?? {}).backgroundColor;
      if (typeof fill === 'string') return fill;
    }
    return undefined;
  }

  it.each(THEMES)('clear 4.5:1 on their own fill in the $name theme', async (theme) => {
    const { getByText } = await renderStrip(theme.isDark);
    const page = theme.palette.surfacePage;

    const failing = ['11', '22', '3'].flatMap((text) => {
      const node = getByText(text);
      const fill = nearestFill(node);
      const ground = fill ? composite(fill, page) : page;
      const ratio = contrastRatio(renderedTextColour(node.props.style, ground), ground);
      return ratio >= AA_TEXT ? [] : [`${text} ${ratio.toFixed(2)}`];
    });

    expect(failing).toStrictEqual([]);
  });

  it.each(THEMES)(
    'draws the active icon and label in one ink in the $name theme',
    async (theme) => {
      const { getByText, UNSAFE_getAllByProps } = await renderStrip(theme.isDark);

      const label = StyleSheet.flatten(getByText('Active').props.style).color;
      const icon = UNSAFE_getAllByProps({ name: 'map-marker-path' })[0].props.color;

      expect(icon).toBe(label);
    }
  );
});

describe('the Garmin trademark line', () => {
  it.each(THEMES)('clears 4.5:1 on every surface in the $name theme', async (theme) => {
    mockIsDark = theme.isDark;
    const { getByText } = await render(<DeviceAttribution deviceName="Garmin Edge 840" />);
    const style = getByText('attribution.garminTrademark').props.style;

    const worst = Math.min(
      ...SURFACES[theme.name].map((ground) =>
        contrastRatio(renderedTextColour(style, ground), ground)
      )
    );

    expect(worst).toBeGreaterThanOrEqual(AA_TEXT);
  });
});
