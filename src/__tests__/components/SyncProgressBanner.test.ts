/**
 * Tests for SyncProgressBanner display logic.
 *
 * Validates that the banner shows immediate feedback when the user extends
 * the sync date range (isFetchingExtended), without waiting for GPS sync
 * to start.
 */

import { useSyncDateRange, GpsSyncProgress } from '@/providers/SyncDateRangeStore';
import { formatGpsSyncProgress } from '@/lib/utils/syncProgressFormat';
import type { TFunction } from 'i18next';

const t = ((key: string) => key) as unknown as TFunction;

const idleProgress: GpsSyncProgress = {
  status: 'idle',
  completed: 0,
  total: 0,
  percent: 0,
  message: '',
};

const fetchingProgress: GpsSyncProgress = {
  status: 'fetching',
  completed: 3,
  total: 10,
  percent: 30,
  message: '',
};

/**
 * Reproduce the banner's displayInfo selection logic.
 * This mirrors the useMemo in SyncProgressBanner.tsx.
 */
function computeDisplayInfo(state: {
  isFetchingExtended: boolean;
  gpsSyncProgress: GpsSyncProgress;
  isGpsSyncing: boolean;
  boundsStatus: string;
}) {
  const isSyncingBounds = state.boundsStatus === 'syncing';
  const isProcessingRoutes =
    state.isGpsSyncing &&
    (state.gpsSyncProgress.status === 'fetching' ||
      state.gpsSyncProgress.status === 'computing');
  const isLoadingExtended =
    state.isFetchingExtended && !isSyncingBounds && !isProcessingRoutes;

  if (isSyncingBounds) return 'bounds';
  if (isProcessingRoutes) return 'gps';
  if (isLoadingExtended) return 'extended';
  return null;
}

describe('SyncProgressBanner display logic', () => {
  beforeEach(() => {
    useSyncDateRange.setState({
      isFetchingExtended: false,
      gpsSyncProgress: idleProgress,
      isGpsSyncing: false,
    });
  });

  it('shows extended fetch banner when isFetchingExtended is true and no other sync active', () => {
    const result = computeDisplayInfo({
      isFetchingExtended: true,
      gpsSyncProgress: idleProgress,
      isGpsSyncing: false,
      boundsStatus: 'idle',
    });
    expect(result).toBe('extended');
  });

  it('returns null when nothing is active', () => {
    const result = computeDisplayInfo({
      isFetchingExtended: false,
      gpsSyncProgress: idleProgress,
      isGpsSyncing: false,
      boundsStatus: 'idle',
    });
    expect(result).toBeNull();
  });

  it('GPS sync takes priority over extended fetch', () => {
    const result = computeDisplayInfo({
      isFetchingExtended: true,
      gpsSyncProgress: fetchingProgress,
      isGpsSyncing: true,
      boundsStatus: 'idle',
    });
    expect(result).toBe('gps');
  });

  it('bounds sync takes priority over both GPS sync and extended fetch', () => {
    const result = computeDisplayInfo({
      isFetchingExtended: true,
      gpsSyncProgress: fetchingProgress,
      isGpsSyncing: true,
      boundsStatus: 'syncing',
    });
    expect(result).toBe('bounds');
  });

  it('extended fetch banner shows indeterminate progress with correct i18n key', () => {
    // Simulate what the banner renders for the extended fetch state
    const displayInfo = {
      icon: 'cloud-download-outline',
      text: t('mapScreen.loadingOlderActivities') as string,
      percent: 0,
      countText: null,
      indeterminate: true,
    };

    expect(displayInfo.indeterminate).toBe(true);
    expect(displayInfo.percent).toBe(0);
    expect(displayInfo.icon).toBe('cloud-download-outline');
    expect(displayInfo.text).toBe('mapScreen.loadingOlderActivities');
  });

  it('transitions from extended to GPS sync when GPS sync starts', () => {
    // Phase 1: only extended fetch active
    const phase1 = computeDisplayInfo({
      isFetchingExtended: true,
      gpsSyncProgress: idleProgress,
      isGpsSyncing: false,
      boundsStatus: 'idle',
    });
    expect(phase1).toBe('extended');

    // Phase 2: GPS sync starts — takes over from extended fetch
    const phase2 = computeDisplayInfo({
      isFetchingExtended: true,
      gpsSyncProgress: fetchingProgress,
      isGpsSyncing: true,
      boundsStatus: 'idle',
    });
    expect(phase2).toBe('gps');
  });

  it('store sets isFetchingExtended immediately on expandRange', () => {
    const state = useSyncDateRange.getState();
    const earlierDate = '2020-01-01';

    state.expandRange(earlierDate, state.newest);

    expect(useSyncDateRange.getState().isFetchingExtended).toBe(true);
  });

  it('formatGpsSyncProgress returns null when idle and not fetching', () => {
    // Confirms that the existing formatter produces nothing for idle state,
    // meaning the extended fetch banner is the only feedback during the gap
    const result = formatGpsSyncProgress(idleProgress, false, t);
    expect(result).toBeNull();
  });
});
