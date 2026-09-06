/**
 * Scenario: a route group reaches the UI with no name from the engine.
 * Expected behaviour: the fallback name carries no sport word and its number
 * is the group's position in the whole catalogue, not among its own sport.
 * Names have not been per sport since the loader's migration strips the
 * prefix, so a sport-scoped fallback disagrees with what the engine stores.
 */

import { renderHook } from '@testing-library/react-native';
import { useRouteMatch } from '@/features/routes/hooks/useRouteMatch';
import type { RouteGroup as NativeRouteGroup } from 'veloqrs';

jest.mock('@/features/routes/hooks/useEngine', () => ({
  useEngineGroups: () => ({ groups: [] }),
}));

function group(groupId: string, sportType: string, activityIds: string[]) {
  return {
    groupId,
    representativeId: activityIds[0],
    activityIds,
    activityCount: activityIds.length,
    sportType,
  } as unknown as NativeRouteGroup;
}

const catalogue = [
  group('g1', 'Ride', ['a1']),
  group('g2', 'Walk', ['a2']),
  group('g3', 'Walk', ['a3']),
];

it('names an unnamed group without its sport', () => {
  const { result } = renderHook(() => useRouteMatch('a2', true, catalogue));

  expect(result.current.routeGroup?.name).toBe('Route 2');
});

it('numbers the fallback across the catalogue, not within one sport', () => {
  const { result } = renderHook(() => useRouteMatch('a3', true, catalogue));

  expect(result.current.routeGroup?.name).toBe('Route 3');
});
