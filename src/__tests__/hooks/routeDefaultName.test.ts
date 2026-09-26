/**
 * Scenario: a route group reaches the UI in the window before the engine has
 * minted its name, so it arrives with no `customName`.
 *
 * Expected behaviour: nothing on the JS side invents a number. The engine
 * mints `Route N` into `route_names` on the next `save_groups`, on its own
 * ordering, and a number guessed here would be a different one that the
 * athlete then watches change. A group with no name yet reads as having no
 * name, and the row renders its own localised default.
 */

import { renderHook } from '@testing-library/react-native';
import { useRouteMatch } from '@/features/routes/hooks/useRouteMatch';
import type { RouteGroup as NativeRouteGroup } from 'veloqrs';

jest.mock('@/features/routes/hooks/useEngine', () => ({
  useEngineGroups: () => ({ groups: [] }),
}));

function group(groupId: string, sportType: string, activityIds: string[], customName?: string) {
  return {
    groupId,
    representativeId: activityIds[0],
    activityIds,
    activityCount: activityIds.length,
    sportType,
    customName,
  } as unknown as NativeRouteGroup;
}

const catalogue = [
  group('g1', 'Ride', ['a1']),
  group('g2', 'Walk', ['a2']),
  group('g3', 'Walk', ['a3']),
];

it('leaves an unnamed group unnamed rather than guessing the engine number', () => {
  const { result } = renderHook(() => useRouteMatch('a2', true, catalogue));

  expect(result.current.routeGroup?.name).toBe('');
});

it('keeps the name the engine minted or the athlete set', () => {
  const named = [group('g1', 'Ride', ['a1'], 'Route 7')];
  const { result } = renderHook(() => useRouteMatch('a1', true, named));

  expect(result.current.routeGroup?.name).toBe('Route 7');
});

// The two lists that fill this hook are filtered differently, so a name that
// depended on a group's position in one would not survive the other.
it('reads the same whichever list filled it', () => {
  const whole = renderHook(() => useRouteMatch('a3', true, catalogue));
  const filtered = renderHook(() => useRouteMatch('a3', true, [catalogue[2]]));

  expect(filtered.result.current.routeGroup?.name).toBe(whole.result.current.routeGroup?.name);
});
