/**
 * Scenario: a route group reaches the recording overlay picker before the
 * engine has minted its name, so its summary carries no `customName`.
 *
 * Expected behaviour: the hook hands the picker an empty name, which the
 * picker renders as the localised default. The group id is never the name.
 */

import { renderHook } from '@testing-library/react-native';
import { useRouteGroups } from '@/features/routes/hooks/useRouteGroups';
import { useGroupSummaries } from '@/features/routes/hooks/useEngine';

jest.mock('@/features/routes/hooks/useEngine', () => ({
  useGroupSummaries: jest.fn(),
}));
jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn(() => ({})) }));

function summary(customName?: string) {
  return {
    groupId: 'r_9',
    representativeId: 'a1',
    sportType: '',
    sportTypes: ['Ride'],
    activityCount: 2,
    bounds: null,
    customName,
  };
}

function namesFor(customName?: string) {
  (useGroupSummaries as jest.Mock).mockReturnValue({
    summaries: [summary(customName)],
    totalCount: 1,
    refresh: jest.fn(),
  });
  const { result } = renderHook(() => useRouteGroups({}));
  return result.current.groups.map((group) => group.name);
}

it('leaves an unnamed group unnamed rather than naming it by its id', () => {
  expect(namesFor(undefined)).toEqual(['']);
});

it('keeps the name the engine minted or the athlete set', () => {
  expect(namesFor('Route 3')).toEqual(['Route 3']);
});
