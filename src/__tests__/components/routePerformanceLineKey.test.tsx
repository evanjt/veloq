/**
 * Scenario: the Route tab map draws the activity line over the matched route
 * line, and nothing says which is which.
 *
 * Expected behaviour: the route header shows a swatch in each line's own map
 * colour for the base the map opens on, labelled as the activity and the
 * matched route. A record's standing line opens the page with the exact time
 * the screen hands it, the improvement for a record and the gap for a slower
 * attempt, since the tab no longer carries either.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';

import { RoutePerformanceSection } from '@/features/routes/components/performance/RoutePerformanceSection';
import { mapPalette } from '@/theme';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars && ('improvement' in vars || 'gap' in vars) ? `${key}|${JSON.stringify(vars)}` : key,
  }),
}));
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('@/shared/app/navigation', () => ({ navigateTo: jest.fn() }));
jest.mock('@/shared/app/NetworkContext', () => ({ useIsOnline: () => true }));
jest.mock('@/features/settings', () => ({
  useMapPreferences: () => ({ getStyleForActivity: () => 'dark' }),
}));
jest.mock('@/features/routes/components/section', () => ({
  PerformanceChartPanel: () => null,
}));
let mockStanding: Record<string, unknown> = { currentRank: null, attemptCount: 0 };
jest.mock('@/features/routes/hooks/useRoutePerformances', () => ({
  useRoutePerformances: () => ({
    routeGroup: { id: 'r_1', name: 'Lake loop', activityCount: 4 },
    performances: [],
    currentDirectionBest: null,
    bestForwardRecord: null,
    bestReverseRecord: null,
    bestForwardIsRecord: false,
    bestReverseIsRecord: false,
    forwardStats: null,
    reverseStats: null,
    ...mockStanding,
    percentileRank: null,
    trendCurves: [],
    error: undefined,
  }),
}));

function swatchColour(view: Awaited<ReturnType<typeof render>>, testID: string) {
  return StyleSheet.flatten(view.getByTestId(testID).props.style).backgroundColor;
}

beforeEach(() => {
  mockStanding = { currentRank: null, attemptCount: 0 };
});

it('keys the activity line and the route line to their map colours', async () => {
  const view = await render(<RoutePerformanceSection activityId="a_1" activityType="Ride" />);

  expect(swatchColour(view, 'route-key-activity')).toBe(mapPalette('dark').route);
  expect(swatchColour(view, 'route-key-route')).toBe(mapPalette('dark').muted);
  expect(view.getByText('activityDetail.lineKeyActivity')).toBeTruthy();
  expect(view.getByText('activityDetail.lineKeyRoute')).toBeTruthy();
});

it('states how much a record beat the previous best by', async () => {
  mockStanding = { currentRank: 1, attemptCount: 5 };
  const view = await render(
    <RoutePerformanceSection activityId="a_1" activityType="Ride" improvementSeconds={14} />
  );

  expect(view.getByText('routes.standingBestBy|{"total":5,"improvement":"14 s"}')).toBeTruthy();
});

it('names the best alone when the screen has no improvement to hand over', async () => {
  mockStanding = { currentRank: 1, attemptCount: 5 };
  const view = await render(<RoutePerformanceSection activityId="a_1" activityType="Ride" />);

  expect(view.getByText('routes.standingBest')).toBeTruthy();
});

it('opens the page with the record time to the second', async () => {
  mockStanding = { currentRank: 1, attemptCount: 5 };
  const view = await render(
    <RoutePerformanceSection activityId="a_1" activityType="Ride" improvementSeconds={65} />
  );

  expect(view.getByTestId('route-standing').props.children).toBe(
    'routes.standingBestBy|{"total":5,"improvement":"1:05"}'
  );
});

it("states a slower attempt's gap as the engine's route highlight gives it", async () => {
  mockStanding = {
    currentRank: 3,
    attemptCount: 4,
    performances: [{ activityId: 'a_1', movingTime: 1000, direction: 'same', speed: 5 }],
    currentDirectionBest: { bestTime: 980 },
  };
  const view = await render(
    <RoutePerformanceSection activityId="a_1" activityType="Ride" gapToBestSeconds={95} />
  );

  expect(view.getByTestId('route-standing').props.children).toBe(
    'routes.standingRank|{"rank":3,"total":4,"gap":"1:35"}'
  );
});

it('puts the standing line above the route header', async () => {
  mockStanding = { currentRank: 3, attemptCount: 4 };
  const view = await render(
    <RoutePerformanceSection activityId="a_1" activityType="Ride" gapToBestSeconds={95} />
  );

  const order = JSON.stringify(view.toJSON());
  expect(order.indexOf('route-standing')).toBeGreaterThan(-1);
  expect(order.indexOf('route-standing')).toBeLessThan(order.indexOf('Lake loop'));
});
