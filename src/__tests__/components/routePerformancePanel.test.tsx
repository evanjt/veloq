/**
 * Scenario: the activity screen's Route tab charts the route's history with
 * this activity in it.
 *
 * Expected behaviour: it draws the same panel as the route page, with the
 * selected-attempt card opening on this activity, which has nowhere to open,
 * and no view choice where only the attempts over time can be drawn.
 */

import React from 'react';
import { render, within } from '@testing-library/react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { RoutePerformanceSection } from '@/features/routes/components/performance/RoutePerformanceSection';
import { PerformanceChartPanel } from '@/features/routes/components/section';
import { colors, darkColors } from '@/theme';
import { layoutViews } from '../__shared__/layoutViews';

const mockRoute = {
  isDark: false,
  currentDirectionBest: null as { bestTime: number; bestSpeed: number; activityDate: Date } | null,
  currentRank: null as number | null,
};

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysWithValues());
jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: mockRoute.isDark }),
  useMetricSystem: () => true,
}));
jest.mock('@/shared/app/navigation', () => ({ navigateTo: jest.fn() }));
jest.mock('@/shared/app/NetworkContext', () => ({ useIsOnline: () => true }));
jest.mock('@/features/settings', () => ({
  useMapPreferences: () => ({ getStyleForActivity: () => 'light' }),
}));

const attempt = (id: string, day: number, duration: number) => ({
  activityId: id,
  name: `Tidal flats ${id}`,
  date: new Date(2026, 4, day),
  speed: 6000 / duration,
  duration,
  direction: 'same',
  matchPercentage: 98,
  outsideDistanceBand: false,
  isRecord: id === 'mine',
});

jest.mock('@/features/routes/hooks/useRoutePerformances', () => ({
  useRoutePerformances: () => ({
    routeGroup: { id: 'flats', name: 'Tidal flats', activityCount: 3 },
    performances: [attempt('older', 1, 1300), attempt('mine', 9, 1200), attempt('newer', 12, 1250)],
    currentDirectionBest: mockRoute.currentDirectionBest,
    bestForwardRecord: null,
    bestReverseRecord: null,
    bestForwardIsRecord: false,
    bestReverseIsRecord: false,
    forwardStats: null,
    reverseStats: null,
    currentRank: mockRoute.currentRank,
    attemptCount: 3,
    percentileRank: null,
    trendCurves: {},
    error: undefined,
  }),
}));

it('draws the panel with its card on this activity', async () => {
  const view = await render(<RoutePerformanceSection activityId="mine" activityType="Ride" />);
  await layoutViews(view, 400, 220);

  expect(view.UNSAFE_getAllByType(PerformanceChartPanel)).toHaveLength(1);
  const card = within(view.getByTestId('selected-attempt-card'));
  expect(card.getByText('Tidal flats mine')).toBeTruthy();
  expect(card.getByTestId('selected-attempt-this-activity')).toBeTruthy();
  expect(card.queryByText('sections.attemptOpen')).toBeNull();
  expect(view.queryByTestId('chart-plot-scatter')).toBeNull();
  expect(view.getByTestId('scatter-legend')).toBeTruthy();
});

describe.each([
  { isDark: false, gold: colors.achievement },
  { isDark: true, gold: darkColors.achievement },
])('the current-best trophy on the route header (dark $isDark)', ({ isDark, gold }) => {
  beforeEach(() => {
    mockRoute.isDark = isDark;
    mockRoute.currentDirectionBest = {
      bestTime: 1200,
      bestSpeed: 6000 / 1200,
      activityDate: new Date(2026, 4, 9),
    };
    mockRoute.currentRank = 1;
  });

  afterEach(() => {
    mockRoute.isDark = false;
    mockRoute.currentDirectionBest = null;
    mockRoute.currentRank = null;
  });

  it('draws the trophy in the gold of the active theme', async () => {
    const view = await render(<RoutePerformanceSection activityId="mine" activityType="Ride" />);

    const header = view.getByRole('button', { name: 'Tidal flats' });
    const trophies = header
      .findAllByType(MaterialCommunityIcons)
      .filter((icon) => icon.props.name === 'trophy');
    expect(trophies).toHaveLength(1);
    expect(trophies[0].props.color).toBe(gold);
  });
});
