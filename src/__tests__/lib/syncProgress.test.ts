import { useSyncDateRange, GpsSyncProgress } from '@/shared/app/SyncDateRangeStore';
import { formatGpsSyncProgress } from '@/features/routes/lib/syncProgressFormat';
import type { TFunction } from 'i18next';

const t = ((key: string) => key) as unknown as TFunction;

const idleProgress: GpsSyncProgress = {
  status: 'idle',
  completed: 0,
  total: 0,
  percent: 0,
  message: '',
};

describe('useSyncDateRange', () => {
  beforeEach(() => {
    useSyncDateRange.setState({
      isFetchingExtended: false,
      gpsSyncProgress: idleProgress,
      isGpsSyncing: false,
    });
  });

  it('sets isFetchingExtended synchronously on expandRange', () => {
    const state = useSyncDateRange.getState();
    state.expandRange('2020-01-01', state.newest);
    expect(useSyncDateRange.getState().isFetchingExtended).toBe(true);
  });
});

describe('formatGpsSyncProgress', () => {
  it('returns null while idle and not fetching', () => {
    expect(formatGpsSyncProgress(idleProgress, false, t)).toBeNull();
  });

  it('returns a label once fetching starts', () => {
    const result = formatGpsSyncProgress(
      { status: 'fetching', completed: 3, total: 10, percent: 30, message: '' },
      true,
      t
    );
    expect(result).not.toBeNull();
  });
});
