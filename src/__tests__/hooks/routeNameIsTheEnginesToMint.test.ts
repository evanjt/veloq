/**
 * Scenario: the routes list and the route performance hook both build a
 * `RouteGroup` from an engine group that has no name yet.
 *
 * Expected behaviour: neither invents `Route N`. The number is minted once, by
 * the engine, into `route_names`, on an ordering neither of these lists shares,
 * so a number guessed here is one the athlete watches change.
 */

import { batchGroupToRouteGroup } from '@/features/routes/lib/batchGroupToRouteGroup';
import type { GroupWithPolyline } from 'veloqrs';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

function engineGroup(groupId: string, customName?: string) {
  return {
    groupId,
    sportType: 'Ride',
    activityCount: 3,
    distanceMeters: 1000,
    customName,
    bounds: null,
    sportTypes: ['Ride'],
  } as unknown as GroupWithPolyline;
}

describe('the routes list', () => {
  it('leaves an unnamed group unnamed, wherever it sits in the list', () => {
    const rows = [engineGroup('g1'), engineGroup('g2')].map(batchGroupToRouteGroup);

    expect(rows.map((r) => r.name)).toEqual(['', '']);
  });

  it('keeps the name the engine minted or the athlete set', () => {
    expect(batchGroupToRouteGroup(engineGroup('g1', 'Route 7')).name).toBe('Route 7');
    expect(batchGroupToRouteGroup(engineGroup('g2', 'Commute')).name).toBe('Commute');
  });
});
