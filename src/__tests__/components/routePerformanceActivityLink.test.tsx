/**
 * Scenario: the activity Route tab opens the route page from its header card.
 *
 * Expected behaviour: the route page is told which activity it was opened
 * from, so its chart and selected attempt start on that activity, as a section
 * opened from the same activity does.
 */

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import { RoutePerformanceSection } from '@/features/routes/components/performance/RoutePerformanceSection';
import { navigateTo } from '@/shared/app/navigation';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('@/shared/app/navigation', () => ({ navigateTo: jest.fn() }));
jest.mock('@/features/routes/components/section', () => ({
  SectionScatterChart: () => null,
  ScatterLegend: () => null,
}));
jest.mock('@/features/routes/hooks/useRoutePerformances', () => ({
  useRoutePerformances: () => ({
    routeGroup: { id: 'harbour_loop', name: 'Harbour loop', activityCount: 3 },
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

beforeEach(() => jest.mocked(navigateTo).mockClear());

it('opens the route page carrying the activity it was opened from', async () => {
  const view = await render(<RoutePerformanceSection activityId="a1" activityType="Ride" />);

  fireEvent.press(view.getByRole('button', { name: 'Harbour loop' }));

  expect(navigateTo).toHaveBeenCalledTimes(1);
  expect(navigateTo).toHaveBeenCalledWith('/route/harbour_loop?activityId=a1');
});

it('carries the activity id escaped so the route page reads it back whole', async () => {
  const view = await render(<RoutePerformanceSection activityId="a 1&b" activityType="Ride" />);

  fireEvent.press(view.getByRole('button', { name: 'Harbour loop' }));

  expect(navigateTo).toHaveBeenCalledWith('/route/harbour_loop?activityId=a%201%26b');
});
