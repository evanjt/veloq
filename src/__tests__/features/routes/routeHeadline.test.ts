/**
 * Scenario: a route's representative ride is 10 km with 236 m of climbing,
 * and a later 5 km walk was also done over it.
 *
 * Expected behaviour: the hero figures are the engine's, the representative's
 * distance and climbing, with no attempts read in TypeScript.
 */

import { routeHeadline } from '@/features/routes/lib/routeHeadline';

it('takes the representative distance and climbing from the engine', () => {
  expect(routeHeadline({ distanceMeters: 10_000, elevationGainMeters: 236 })).toEqual({
    distance: 10_000,
    elevationGain: 236,
  });
});

it('reads empty before the detail has arrived', () => {
  expect(routeHeadline(undefined)).toEqual({ distance: 0, elevationGain: 0 });
  expect(routeHeadline(null)).toEqual({ distance: 0, elevationGain: 0 });
});
