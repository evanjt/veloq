/**
 * Scenario: a cache expansion asks the engine to recompute, and the engine
 * refuses the request.
 *
 * Expected behaviour: the expansion stays unprocessed so the request is made again.
 */

import { renderHook } from '@testing-library/react-native';

import { useRouteReoptimization } from '@/features/routes/hooks/useRouteReoptimization';

const mockMark = jest.fn();
const mockProcessed = jest.fn();

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => ({ markForRecomputation: mockMark }),
}));
jest.mock('@/shared/app/SyncDateRangeStore', () => ({
  useSyncDateRange: (select: (s: unknown) => unknown) =>
    select({ hasExpanded: true, markExpansionProcessed: mockProcessed }),
}));

describe('useRouteReoptimization', () => {
  beforeEach(() => jest.clearAllMocks());

  it('marks the expansion processed when the engine took the request', () => {
    mockMark.mockReturnValue(true);
    renderHook(() => useRouteReoptimization());
    expect(mockProcessed).toHaveBeenCalledTimes(1);
  });

  it('leaves the expansion unprocessed when the engine refused it', () => {
    mockMark.mockReturnValue(false);
    renderHook(() => useRouteReoptimization());
    expect(mockMark).toHaveBeenCalledTimes(1);
    expect(mockProcessed).not.toHaveBeenCalled();
  });
});
