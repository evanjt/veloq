/**
 * Scenario: the routes list and the route performance hook both build a
 * `RouteGroup` from an engine group that has no name yet.
 *
 * Expected behaviour: neither invents `Route N`. The number is minted once, by
 * the engine, into `route_names`, on an ordering neither of these lists shares,
 * so a number guessed here is one the athlete watches change.
 */

import { batchGroupToRouteGroup } from '@/features/routes/lib/batchGroupToRouteGroup';
import { buildRouteGroupBase } from '@/features/routes/lib/buildRouteGroup';
import type { GroupWithPolyline, RouteGroup } from 'veloqrs';

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
    encodedPolyline: new ArrayBuffer(0),
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

describe('the route detail builder', () => {
  it('leaves an unnamed group unnamed instead of exposing its group id', () => {
    const group = {
      groupId: 'r_9',
      representativeId: 'a',
      activityIds: ['a'],
    } as RouteGroup;

    expect(buildRouteGroupBase(group)?.name).toBe('');
  });
});

describe('route sport without a scalar', () => {
  it('keeps an empty sport set empty in the batch builder', () => {
    const row = batchGroupToRouteGroup({ ...engineGroup('g1'), sportTypes: [] });

    expect(row.type).toBe('Other');
    expect(row.sportTypes).toEqual([]);
  });

  it('keeps the full group sport neutral without a selected chip', () => {
    const group = {
      groupId: 'g1',
      representativeId: 'a',
      activityIds: ['a'],
    } as RouteGroup;

    expect(buildRouteGroupBase(group)?.type).toBe('Other');
  });
});
