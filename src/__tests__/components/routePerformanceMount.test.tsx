/**
 * Scenario: the activity Route tab opens for an activity whose group the detail bundle already holds.
 * Expected behaviour: the card reads that group's performances and never lists every group in the library.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

import { RoutePerformanceSection } from '@/features/routes/components/performance/RoutePerformanceSection';
import { getEngine } from '@/shared/native/engine';

jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));
jest.mock('veloqrs', () =>
  require('../__shared__/veloqrsStub').withOverrides(
    require('../__shared__/veloqrsStub').namespacesOver(() =>
      require('@/shared/native/engine').getEngine()
    )
  )
);
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('@/shared/app/navigation', () => ({ navigateTo: jest.fn() }));
jest.mock('@/shared/app/NetworkContext', () => ({ useIsOnline: () => true }));
jest.mock('@/features/settings', () => ({
  useMapPreferences: () => ({ getStyleForActivity: () => 'light' }),
}));
jest.mock('@/features/routes/components/section', () => ({
  PerformanceChartPanel: () => null,
}));

const getRoutePerformances = jest.fn(() => ({ performances: [] }));

beforeEach(() => {
  jest.clearAllMocks();
  (getEngine as jest.Mock).mockReturnValue({
    subscribe: () => () => undefined,
    getRoutePerformances,
  });
});

it('reads the matched group from the bundle without listing every group', async () => {
  const group = { groupId: 'g1', activityIds: ['a1', 'a2'], customName: 'Harbour loop' };
  const view = await render(
    <RoutePerformanceSection activityId="a1" activityType="Ride" routeGroups={[group] as never} />
  );
  expect(getRoutePerformances).toHaveBeenCalledWith('g1', 'a1', undefined);
  expect(view.getByRole('button', { name: 'Harbour loop' })).toBeTruthy();
});
