/**
 * Scenario: one loop, ridden four times and walked once. The engine groups it
 * as one route, sport-blind, and reports every sport that has traversed it.
 *
 * Expected behaviour: asking for walking routes finds it. Filtering on the
 * representative's sport alone drops the loop from every sport but one, which
 * is what the recording overlay picker did.
 */

import { renderHook } from '@testing-library/react-native';
import { useRouteGroups } from '@/features/routes/hooks/useRouteGroups';
import { useGroupSummaries } from '@/features/routes/hooks/useEngine';

jest.mock('@/features/routes/hooks/useEngine', () => ({
  useGroupSummaries: jest.fn(),
}));
jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn(() => ({})) }));

const mixedLoop = {
  groupId: 'g1',
  representativeId: 'a1',
  sportType: 'Ride',
  sportTypes: ['Ride', 'Walk'],
  activityCount: 5,
  bounds: null,
  customName: 'The river loop',
};

beforeEach(() => {
  jest.clearAllMocks();
  (useGroupSummaries as jest.Mock).mockReturnValue({
    summaries: [mixedLoop],
    totalCount: 1,
    refresh: jest.fn(),
  });
});

it('offers a loop that has been walked to a walk, not only to a ride', () => {
  const { result } = renderHook(() => useRouteGroups({ type: 'Walk' }));

  expect(result.current.groups.map((g) => g.id)).toEqual(['g1']);
});

it('still offers it to the sport its representative carries', () => {
  const { result } = renderHook(() => useRouteGroups({ type: 'Ride' }));

  expect(result.current.groups.map((g) => g.id)).toEqual(['g1']);
});

it('does not offer it to a sport nothing traversed it in', () => {
  const { result } = renderHook(() => useRouteGroups({ type: 'Swim' }));

  expect(result.current.groups).toEqual([]);
});
