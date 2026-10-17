import { IDLE_EXTENDED_FETCH, isExtendedFetchRunning } from '@/shared/app/extendedFetch';
import { useSyncDateRange } from '@/shared/app/SyncDateRangeStore';

describe('useSyncDateRange', () => {
  beforeEach(() => {
    useSyncDateRange.setState({
      extendedFetch: IDLE_EXTENDED_FETCH,
    });
  });

  it('reports the widened range running once the engine accepts the window', () => {
    const state = useSyncDateRange.getState();
    state.expandRange('2020-01-01', state.newest);
    expect(isExtendedFetchRunning(useSyncDateRange.getState().extendedFetch)).toBe(false);

    useSyncDateRange.getState().windowAccepted();
    expect(isExtendedFetchRunning(useSyncDateRange.getState().extendedFetch)).toBe(true);
  });
});
