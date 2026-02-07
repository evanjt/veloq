/**
 * SyncDateRangeStore Tests
 *
 * Tests the sync date range and GPS progress management including:
 * - Range expansion and locking
 * - Generation counter for race condition prevention
 * - GPS sync progress state machine
 * - Delayed unlock behavior
 */

import {
  useSyncDateRange,
  getSyncGeneration,
  GpsSyncProgress,
} from '@/providers/SyncDateRangeStore';

// Helper to get a date string N days from today
function daysFromToday(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().split('T')[0];
}

describe('SyncDateRangeStore', () => {
  beforeEach(() => {
    // Use fake timers with a fixed system time to ensure consistent date calculations
    jest.useFakeTimers();
    // Set a fixed time at noon UTC to avoid date boundary issues
    jest.setSystemTime(new Date('2025-01-30T12:00:00Z'));

    // Reset store to initial state
    const defaultOldest = daysFromToday(-90);
    const defaultNewest = daysFromToday(0);

    useSyncDateRange.setState({
      oldest: defaultOldest,
      newest: defaultNewest,
      isFetchingExtended: false,
      hasExpanded: false,
      gpsSyncProgress: {
        status: 'idle',
        completed: 0,
        total: 0,
        message: '',
      },
      isGpsSyncing: false,
      lastSyncTimestamp: null,
      isExpansionLocked: false,
      syncGeneration: 0,
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('Initial State', () => {
    it('has default 90-day range from today', () => {
      const state = useSyncDateRange.getState();
      const expectedOldest = daysFromToday(-90);
      const expectedNewest = daysFromToday(0);

      expect(state.oldest).toBe(expectedOldest);
      expect(state.newest).toBe(expectedNewest);
    });

    it('starts with expansion unlocked', () => {
      expect(useSyncDateRange.getState().isExpansionLocked).toBe(false);
    });

    it('starts with generation 0', () => {
      expect(useSyncDateRange.getState().syncGeneration).toBe(0);
    });

    it('starts with idle GPS sync status', () => {
      const progress = useSyncDateRange.getState().gpsSyncProgress;
      expect(progress.status).toBe('idle');
      expect(progress.completed).toBe(0);
      expect(progress.total).toBe(0);
    });
  });

  describe('expandRange()', () => {
    it('expands oldest date when requested is earlier', () => {
      const currentOldest = useSyncDateRange.getState().oldest;
      const earlierDate = daysFromToday(-180);

      useSyncDateRange.getState().expandRange(earlierDate, currentOldest);

      expect(useSyncDateRange.getState().oldest).toBe(earlierDate);
      expect(useSyncDateRange.getState().hasExpanded).toBe(true);
      expect(useSyncDateRange.getState().isFetchingExtended).toBe(true);
    });

    it('expands newest date when requested is later', () => {
      const currentNewest = useSyncDateRange.getState().newest;
      const laterDate = daysFromToday(30);

      useSyncDateRange.getState().expandRange(currentNewest, laterDate);

      expect(useSyncDateRange.getState().newest).toBe(laterDate);
      expect(useSyncDateRange.getState().hasExpanded).toBe(true);
    });

    it('expands both dates simultaneously', () => {
      const earlierDate = daysFromToday(-365);
      const laterDate = daysFromToday(7);

      useSyncDateRange.getState().expandRange(earlierDate, laterDate);

      const state = useSyncDateRange.getState();
      expect(state.oldest).toBe(earlierDate);
      expect(state.newest).toBe(laterDate);
      expect(state.hasExpanded).toBe(true);
    });

    it('does not modify range when requested is within current range', () => {
      const state = useSyncDateRange.getState();
      const withinOldest = daysFromToday(-45);
      const withinNewest = daysFromToday(-5);

      useSyncDateRange.getState().expandRange(withinOldest, withinNewest);

      const newState = useSyncDateRange.getState();
      expect(newState.oldest).toBe(state.oldest);
      expect(newState.newest).toBe(state.newest);
      expect(newState.hasExpanded).toBe(false);
    });

    it('is blocked when expansion is locked', () => {
      useSyncDateRange.setState({ isExpansionLocked: true });

      const stateBefore = useSyncDateRange.getState();
      const requestedOldest = daysFromToday(-365);

      useSyncDateRange.getState().expandRange(requestedOldest, stateBefore.newest);

      // Range should NOT have changed
      expect(useSyncDateRange.getState().oldest).toBe(stateBefore.oldest);
      expect(useSyncDateRange.getState().hasExpanded).toBe(false);
    });

    it('only expands the boundary that needs expansion', () => {
      const currentState = useSyncDateRange.getState();
      const earlierOldest = daysFromToday(-180);
      // Request newest that's actually older than current
      const olderNewest = daysFromToday(-10);

      useSyncDateRange.getState().expandRange(earlierOldest, olderNewest);

      const newState = useSyncDateRange.getState();
      // Oldest should expand
      expect(newState.oldest).toBe(earlierOldest);
      // Newest should stay at original (we don't contract)
      expect(newState.newest).toBe(currentState.newest);
    });
  });

  describe('reset()', () => {
    it('resets to default 90-day range', () => {
      // First expand the range
      useSyncDateRange.getState().expandRange(daysFromToday(-365), daysFromToday(30));

      useSyncDateRange.getState().reset();

      const state = useSyncDateRange.getState();
      expect(state.oldest).toBe(daysFromToday(-90));
      expect(state.newest).toBe(daysFromToday(0));
    });

    it('locks expansion after reset', () => {
      useSyncDateRange.getState().reset();

      expect(useSyncDateRange.getState().isExpansionLocked).toBe(true);
    });

    it('increments generation counter', () => {
      const genBefore = useSyncDateRange.getState().syncGeneration;

      useSyncDateRange.getState().reset();

      expect(useSyncDateRange.getState().syncGeneration).toBe(genBefore + 1);
    });

    it('clears expansion flags', () => {
      useSyncDateRange.setState({
        hasExpanded: true,
        isFetchingExtended: true,
      });

      useSyncDateRange.getState().reset();

      const state = useSyncDateRange.getState();
      expect(state.hasExpanded).toBe(false);
      expect(state.isFetchingExtended).toBe(false);
    });

    it('multiple resets increment generation each time', () => {
      useSyncDateRange.getState().reset();
      useSyncDateRange.getState().reset();
      useSyncDateRange.getState().reset();

      expect(useSyncDateRange.getState().syncGeneration).toBe(3);
    });
  });

  describe('GPS Sync Progress', () => {
    it('setGpsSyncProgress updates progress state', () => {
      const progress: GpsSyncProgress = {
        status: 'fetching',
        completed: 5,
        total: 20,
        percent: 25,
        message: 'Downloading GPS data...',
      };

      useSyncDateRange.getState().setGpsSyncProgress(progress);

      const state = useSyncDateRange.getState();
      expect(state.gpsSyncProgress.status).toBe('fetching');
      expect(state.gpsSyncProgress.completed).toBe(5);
      expect(state.gpsSyncProgress.total).toBe(20);
      expect(state.gpsSyncProgress.message).toBe('Downloading GPS data...');
    });

    it('sets isGpsSyncing=true for active statuses', () => {
      const activeStatuses: GpsSyncProgress['status'][] = ['fetching', 'processing', 'computing'];

      for (const status of activeStatuses) {
        useSyncDateRange.getState().setGpsSyncProgress({
          status,
          completed: 0,
          total: 10,
          percent: 0,
          message: '',
        });

        expect(useSyncDateRange.getState().isGpsSyncing).toBe(true);
      }
    });

    it('sets isGpsSyncing=false for terminal statuses', () => {
      const terminalStatuses: GpsSyncProgress['status'][] = ['idle', 'complete', 'error'];

      for (const status of terminalStatuses) {
        useSyncDateRange.getState().setGpsSyncProgress({
          status,
          completed: 0,
          total: 10,
          percent: 0,
          message: '',
        });

        expect(useSyncDateRange.getState().isGpsSyncing).toBe(false);
      }
    });

    it('sets lastSyncTimestamp on complete', () => {
      expect(useSyncDateRange.getState().lastSyncTimestamp).toBeNull();

      useSyncDateRange.getState().setGpsSyncProgress({
        status: 'complete',
        completed: 20,
        total: 20,
        percent: 100,
        message: 'Done',
      });

      const timestamp = useSyncDateRange.getState().lastSyncTimestamp;
      expect(timestamp).not.toBeNull();
      expect(new Date(timestamp!).getTime()).toBeCloseTo(Date.now(), -2); // Within 100ms
    });

    it('does not update lastSyncTimestamp on error', () => {
      useSyncDateRange.getState().setGpsSyncProgress({
        status: 'error',
        completed: 5,
        total: 20,
        percent: 0,
        message: 'Network error',
      });

      expect(useSyncDateRange.getState().lastSyncTimestamp).toBeNull();
    });

    it('tracks progress through complete sync lifecycle', () => {
      const store = useSyncDateRange.getState();

      // Start sync
      store.setGpsSyncProgress({
        status: 'fetching',
        completed: 0,
        total: 10,
        percent: 0,
        message: '',
      });
      expect(useSyncDateRange.getState().isGpsSyncing).toBe(true);

      // Progress
      store.setGpsSyncProgress({
        status: 'fetching',
        completed: 5,
        total: 10,
        percent: 50,
        message: '',
      });
      expect(useSyncDateRange.getState().gpsSyncProgress.completed).toBe(5);

      // Processing
      store.setGpsSyncProgress({
        status: 'processing',
        completed: 10,
        total: 10,
        percent: 100,
        message: '',
      });
      expect(useSyncDateRange.getState().isGpsSyncing).toBe(true);

      // Computing
      store.setGpsSyncProgress({
        status: 'computing',
        completed: 0,
        total: 0,
        percent: 50,
        message: '',
      });
      expect(useSyncDateRange.getState().isGpsSyncing).toBe(true);

      // Complete
      store.setGpsSyncProgress({
        status: 'complete',
        completed: 10,
        total: 10,
        percent: 100,
        message: '',
      });
      expect(useSyncDateRange.getState().isGpsSyncing).toBe(false);
      expect(useSyncDateRange.getState().lastSyncTimestamp).not.toBeNull();
    });
  });

  describe('Expansion Locking', () => {
    it('unlockExpansion() sets isExpansionLocked to false', () => {
      useSyncDateRange.setState({ isExpansionLocked: true });

      useSyncDateRange.getState().unlockExpansion();

      expect(useSyncDateRange.getState().isExpansionLocked).toBe(false);
    });

    it('delayedUnlockExpansion() unlocks after 500ms', () => {
      useSyncDateRange.setState({ isExpansionLocked: true });

      useSyncDateRange.getState().delayedUnlockExpansion();

      // Still locked immediately
      expect(useSyncDateRange.getState().isExpansionLocked).toBe(true);

      // Fast-forward 500ms
      jest.advanceTimersByTime(500);

      // Now unlocked
      expect(useSyncDateRange.getState().isExpansionLocked).toBe(false);
    });

    it('delayedUnlockExpansion() does nothing if already unlocked', () => {
      useSyncDateRange.setState({ isExpansionLocked: false });

      useSyncDateRange.getState().delayedUnlockExpansion();
      jest.advanceTimersByTime(500);

      // Should still be unlocked (no error)
      expect(useSyncDateRange.getState().isExpansionLocked).toBe(false);
    });

    it('expansion works after unlock', () => {
      // Lock and try to expand
      useSyncDateRange.setState({ isExpansionLocked: true });
      const originalOldest = useSyncDateRange.getState().oldest;

      useSyncDateRange.getState().expandRange(daysFromToday(-180), daysFromToday(0));
      expect(useSyncDateRange.getState().oldest).toBe(originalOldest); // Blocked

      // Unlock
      useSyncDateRange.getState().unlockExpansion();

      // Now expansion should work
      useSyncDateRange.getState().expandRange(daysFromToday(-180), daysFromToday(0));
      expect(useSyncDateRange.getState().oldest).toBe(daysFromToday(-180));
    });
  });

  describe('Generation Counter', () => {
    it('getSyncGeneration() returns current generation', () => {
      useSyncDateRange.setState({ syncGeneration: 42 });

      expect(getSyncGeneration()).toBe(42);
    });

    it('generation counter prevents stale updates pattern', () => {
      // Simulate: Start sync gen 0, reset (gen 1), old sync completes
      const startGen = getSyncGeneration();
      expect(startGen).toBe(0);

      // Simulate async operation starting
      const capturedGen = getSyncGeneration();

      // Reset happens (user clears cache)
      useSyncDateRange.getState().reset();
      const newGen = getSyncGeneration();
      expect(newGen).toBe(1);

      // Check if captured generation is stale
      expect(capturedGen).not.toBe(newGen);
      // This pattern allows sync operations to detect staleness
    });

    it('generation persists through expansion', () => {
      useSyncDateRange.setState({ syncGeneration: 5 });

      useSyncDateRange.getState().expandRange(daysFromToday(-365), daysFromToday(0));

      // Generation should NOT change on expand
      expect(useSyncDateRange.getState().syncGeneration).toBe(5);
    });
  });

  describe('markExpansionProcessed()', () => {
    it('clears hasExpanded flag', () => {
      useSyncDateRange.setState({ hasExpanded: true });

      useSyncDateRange.getState().markExpansionProcessed();

      expect(useSyncDateRange.getState().hasExpanded).toBe(false);
    });

    it('does not affect other state', () => {
      useSyncDateRange.setState({
        hasExpanded: true,
        isFetchingExtended: true,
        isExpansionLocked: false,
      });

      useSyncDateRange.getState().markExpansionProcessed();

      const state = useSyncDateRange.getState();
      expect(state.hasExpanded).toBe(false);
      expect(state.isFetchingExtended).toBe(true); // Unchanged
      expect(state.isExpansionLocked).toBe(false); // Unchanged
    });
  });

  describe('setFetchingExtended()', () => {
    it('sets isFetchingExtended flag', () => {
      useSyncDateRange.getState().setFetchingExtended(true);
      expect(useSyncDateRange.getState().isFetchingExtended).toBe(true);

      useSyncDateRange.getState().setFetchingExtended(false);
      expect(useSyncDateRange.getState().isFetchingExtended).toBe(false);
    });
  });

  describe('Race Condition Scenarios', () => {
    it('reset during active sync invalidates in-flight operations', () => {
      // Start sync
      useSyncDateRange.getState().setGpsSyncProgress({
        status: 'fetching',
        completed: 0,
        total: 100,
        percent: 0,
        message: '',
      });
      const syncStartGen = getSyncGeneration();

      // User triggers reset (e.g., cache clear)
      useSyncDateRange.getState().reset();

      // Sync operation should detect stale generation
      expect(getSyncGeneration()).not.toBe(syncStartGen);
      expect(useSyncDateRange.getState().isExpansionLocked).toBe(true);
    });

    it('multiple rapid expansions merge correctly', () => {
      // Simulate timeline slider being dragged rapidly
      useSyncDateRange.getState().expandRange(daysFromToday(-100), daysFromToday(0));
      useSyncDateRange.getState().expandRange(daysFromToday(-150), daysFromToday(0));
      useSyncDateRange.getState().expandRange(daysFromToday(-200), daysFromToday(0));

      // Should have the widest range
      expect(useSyncDateRange.getState().oldest).toBe(daysFromToday(-200));
    });

    it('locked expansion prevents cache pollution from stale UI', () => {
      // Reset locks expansion
      useSyncDateRange.getState().reset();

      // Stale UI component tries to expand (e.g., from cached props)
      useSyncDateRange.getState().expandRange(daysFromToday(-365), daysFromToday(0));

      // Should stay at default 90 days
      expect(useSyncDateRange.getState().oldest).toBe(daysFromToday(-90));
    });

    it('unlock after delay allows controlled re-expansion', () => {
      useSyncDateRange.getState().reset();

      // Can't expand while locked
      useSyncDateRange.getState().expandRange(daysFromToday(-180), daysFromToday(0));
      expect(useSyncDateRange.getState().oldest).toBe(daysFromToday(-90));

      // Simulate sync complete + delayed unlock
      useSyncDateRange.getState().setGpsSyncProgress({
        status: 'complete',
        completed: 10,
        total: 10,
        percent: 100,
        message: '',
      });
      useSyncDateRange.getState().delayedUnlockExpansion();
      jest.advanceTimersByTime(500);

      // Now expansion works
      useSyncDateRange.getState().expandRange(daysFromToday(-180), daysFromToday(0));
      expect(useSyncDateRange.getState().oldest).toBe(daysFromToday(-180));
    });
  });

  describe('Date Format Validation', () => {
    it('stores dates in YYYY-MM-DD format', () => {
      const state = useSyncDateRange.getState();

      // Verify format with regex
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      expect(state.oldest).toMatch(dateRegex);
      expect(state.newest).toMatch(dateRegex);
    });

    it('handles date comparison correctly (string comparison)', () => {
      // This tests that string comparison works for our date format
      // "2025-01-01" < "2025-12-31" should be true
      const earlier = '2025-01-01';
      const later = '2025-12-31';

      expect(earlier < later).toBe(true);
      expect(later > earlier).toBe(true);

      // Edge case: year boundary
      const dec31 = '2024-12-31';
      const jan1 = '2025-01-01';
      expect(dec31 < jan1).toBe(true);
    });
  });
});
