/**
 * Scenario: the Route tab map draws the activity line over the matched route
 * line, and nothing says which is which.
 *
 * Expected behaviour: the route header shows a swatch in each line's own map
 * colour, labelled as the activity and the matched route. A record's standing
 * line states the improvement the screen hands the page, since the tab no
 * longer carries it.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';

import { RoutePerformanceSection } from '@/features/routes/components/performance/RoutePerformanceSection';
import { getActivityColor } from '@/shared/activity/activityUtils';
import { mapLayerColors } from '@/theme';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars && 'improvement' in vars ? `${key}|${JSON.stringify(vars)}` : key,
  }),
}));
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('@/shared/app/navigation', () => ({ navigateTo: jest.fn() }));
jest.mock('@/features/routes/components/section', () => ({
  SectionScatterChart: () => null,
  ScatterLegend: () => null,
}));
let mockStanding = { currentRank: null as number | null, attemptCount: 0 };
jest.mock('@/features/routes/hooks/useRoutePerformances', () => ({
  useRoutePerformances: () => ({
    routeGroup: { id: 'r_1', name: 'Lake loop', activityCount: 4 },
    performances: [],
    bestForwardRecord: null,
    bestReverseRecord: null,
    bestForwardIsRecord: false,
    bestReverseIsRecord: false,
    currentDirectionBest: null,
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

  expect(swatchColour(view, 'route-key-activity')).toBe(getActivityColor('Ride'));
  expect(swatchColour(view, 'route-key-route')).toBe(mapLayerColors.routeOverlay);
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
