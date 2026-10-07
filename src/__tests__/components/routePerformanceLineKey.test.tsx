/**
 * Scenario: the Route tab map draws the activity line over the matched route
 * line, and nothing says which is which.
 *
 * Expected behaviour: the route header shows a swatch in each line's own map
 * colour, labelled as the activity and the matched route.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';

import { RoutePerformanceSection } from '@/features/routes/components/performance/RoutePerformanceSection';
import { getActivityColor } from '@/shared/activity/activityUtils';
import { mapLayerColors } from '@/theme';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('@/shared/app/navigation', () => ({ navigateTo: jest.fn() }));
jest.mock('@/features/routes/components/section', () => ({
  SectionScatterChart: () => null,
  ScatterLegend: () => null,
}));
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
    currentRank: null,
    attemptCount: 0,
    percentileRank: null,
    trendCurves: [],
    error: undefined,
  }),
}));

function swatchColour(view: ReturnType<typeof render>, testID: string) {
  return StyleSheet.flatten(view.getByTestId(testID).props.style).backgroundColor;
}

it('keys the activity line and the route line to their map colours', () => {
  const view = render(<RoutePerformanceSection activityId="a_1" activityType="Ride" />);

  expect(swatchColour(view, 'route-key-activity')).toBe(getActivityColor('Ride'));
  expect(swatchColour(view, 'route-key-route')).toBe(mapLayerColors.routeOverlay);
  expect(view.getByText('activityDetail.lineKeyActivity')).toBeTruthy();
  expect(view.getByText('activityDetail.lineKeyRoute')).toBeTruthy();
});
