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
        percent: 0,
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
  });

  describe('GPS Sync Progress', () => {
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
  });

  describe('Generation Counter', () => {
    it('getSyncGeneration() returns current generation', () => {
      useSyncDateRange.setState({ syncGeneration: 42 });

      expect(getSyncGeneration()).toBe(42);
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
  });

  describe('setFetchingExtended()', () => {
    it('sets isFetchingExtended flag', () => {
      useSyncDateRange.getState().setFetchingExtended(true);
      expect(useSyncDateRange.getState().isFetchingExtended).toBe(true);

      useSyncDateRange.getState().setFetchingExtended(false);
      expect(useSyncDateRange.getState().isFetchingExtended).toBe(false);
    });
  });
});
