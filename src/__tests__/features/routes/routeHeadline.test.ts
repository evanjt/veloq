/**
 * Scenario: a route's representative ride is 10 km and a later 5 km walk was
 * also ridden over it.
 *
 * Expected behaviour: the hero figures are the engine's, the representative's
 * distance and the newest attempt across sports, with no attempts read in
 * TypeScript.
 */

import { routeHeadline } from '@/features/routes/lib/routeHeadline';

it('takes the representative distance and the newest date from the engine', () => {
  const headline = routeHeadline({ distanceMeters: 10_000, lastActivityDate: 1_700_086_400 });

  expect(headline.distance).toBe(10_000);
  expect(headline.lastDate).toBe(new Date(1_700_086_400_000).toISOString());
});

it('reads empty before the detail has arrived and for a route with no attempts', () => {
  expect(routeHeadline(undefined)).toEqual({ distance: 0, lastDate: '' });
  expect(routeHeadline({ distanceMeters: 0 })).toEqual({
    distance: 0,
    lastDate: '',
  });
});

it('reads an invalid date as no date', () => {
  expect(routeHeadline({ distanceMeters: 1, lastActivityDate: Number.NaN }).lastDate).toBe('');
});
