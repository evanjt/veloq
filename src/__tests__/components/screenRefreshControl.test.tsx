/**
 * Scenario: each screen drew its own pull-to-refresh control, so Android showed
 * its default light disc in the dark theme, a list without `colors` got the
 * default arc, one screen carried an iOS-only title, and three Insights pages
 * had no refresh at all beside a sibling that did.
 *
 * Expected behaviour: one control, coloured from the active theme (the action
 * link arc and tint on the theme's surface), carrying no title, firing the
 * pull haptic once as it hands the pull to the screen; and every Insights page
 * given a refresh handler offers the gesture.
 */

import React from 'react';
import { RefreshControl } from 'react-native';
import { act, render, screen } from '@testing-library/react-native';

import { ScreenRefreshControl } from '@/shared/ui/ScreenRefreshControl';
import { InsightsPanel } from '@/features/insights/components/InsightsPanel';
import { colors, darkColors } from '@/theme';

let mockIsDark = false;
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: mockIsDark }) }));
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysWithValues());
jest.mock('@/features/routes', () => ({ TodayBanner: () => null }));
jest.mock('@/features/insights/components/InsightDebugPanel', () => ({
  InsightDebugPanel: () => null,
}));

const mockMedium = jest.fn();
jest.mock('@/shared/ui/haptics', () => ({
  onPullRefresh:
    (handler: (...args: unknown[]) => unknown) =>
    (...args: unknown[]) => {
      mockMedium();
      return handler(...args);
    },
}));

afterEach(() => {
  mockIsDark = false;
  mockMedium.mockClear();
});

async function renderControl(onRefresh = jest.fn()) {
  await render(<ScreenRefreshControl refreshing={false} onRefresh={onRefresh} />);
  return screen.UNSAFE_getByType(RefreshControl);
}

describe('ScreenRefreshControl', () => {
  it('draws the dark action link arc on the dark surface in the dark theme', async () => {
    mockIsDark = true;
    const control = await renderControl();

    expect(control.props.colors).toEqual([darkColors.actionLink]);
    expect(control.props.tintColor).toBe(darkColors.actionLink);
    expect(control.props.progressBackgroundColor).toBe(darkColors.surface);
  });

  it('draws the light action link arc on the light surface in the light theme', async () => {
    const control = await renderControl();

    expect(control.props.colors).toEqual([colors.actionLink]);
    expect(control.props.tintColor).toBe(colors.actionLink);
    expect(control.props.progressBackgroundColor).toBe(colors.surface);
  });

  it('carries no title', async () => {
    const control = await renderControl();

    expect(control.props.title).toBeUndefined();
    expect(control.props.titleColor).toBeUndefined();
  });

  it('fires the pull haptic once and hands the pull to the screen', async () => {
    const onRefresh = jest.fn();
    const control = await renderControl(onRefresh);

    await act(async () => {
      control.props.onRefresh();
    });
    expect(mockMedium).toHaveBeenCalledTimes(1);
    expect(onRefresh).toHaveBeenCalledTimes(1);

    await act(async () => {
      control.props.onRefresh();
    });
    expect(mockMedium).toHaveBeenCalledTimes(2);
    expect(onRefresh).toHaveBeenCalledTimes(2);
  });
});

describe('the insights panel', () => {
  it('offers pull to refresh when given a handler, and the pull calls it', async () => {
    const onRefresh = jest.fn();
    await render(<InsightsPanel insights={[]} onRefresh={onRefresh} refreshing={false} />);

    const control = screen.UNSAFE_getByType(RefreshControl);
    await act(async () => {
      control.props.onRefresh();
    });
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('shows the refresh as running while the screen syncs', async () => {
    await render(<InsightsPanel insights={[]} onRefresh={jest.fn()} refreshing />);

    expect(screen.UNSAFE_getByType(RefreshControl).props.refreshing).toBe(true);
  });

  it('offers no refresh without a handler', async () => {
    await render(<InsightsPanel insights={[]} />);

    expect(screen.UNSAFE_queryAllByType(RefreshControl)).toHaveLength(0);
  });
});
