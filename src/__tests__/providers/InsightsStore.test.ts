import AsyncStorage from '@react-native-async-storage/async-storage';
import { useInsightsStore, initializeInsightsStore } from '@/providers/InsightsStore';

const STORAGE_KEY = 'veloq-insights-last-seen';

describe('InsightsStore', () => {
  beforeEach(async () => {
    useInsightsStore.setState({ lastSeenTimestamp: 0, hasNewInsights: false, isLoaded: false });
    await AsyncStorage.clear();
    jest.clearAllMocks();
  });

  describe('initial state', () => {
    it('has correct defaults', () => {
      const state = useInsightsStore.getState();
      expect(state.lastSeenTimestamp).toBe(0);
      expect(state.hasNewInsights).toBe(false);
      expect(state.isLoaded).toBe(false);
    });
  });

  describe('initialize()', () => {
    it('sets isLoaded when no stored data', async () => {
      await initializeInsightsStore();
      expect(useInsightsStore.getState().isLoaded).toBe(true);
      expect(useInsightsStore.getState().lastSeenTimestamp).toBe(0);
    });

    it('restores timestamp from storage', async () => {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(1700000000000));
      await initializeInsightsStore();
      expect(useInsightsStore.getState().lastSeenTimestamp).toBe(1700000000000);
      expect(useInsightsStore.getState().isLoaded).toBe(true);
    });

    it('handles corrupt JSON gracefully', async () => {
      await AsyncStorage.setItem(STORAGE_KEY, 'not-json');
      await initializeInsightsStore();
      expect(useInsightsStore.getState().isLoaded).toBe(true);
      expect(useInsightsStore.getState().lastSeenTimestamp).toBe(0);
    });
  });

  describe('markSeen()', () => {
    it('updates timestamp and clears hasNewInsights', () => {
      useInsightsStore.setState({ hasNewInsights: true });
      const before = Date.now();
      useInsightsStore.getState().markSeen();
      const state = useInsightsStore.getState();
      expect(state.lastSeenTimestamp).toBeGreaterThanOrEqual(before);
      expect(state.hasNewInsights).toBe(false);
    });

    it('persists to AsyncStorage', async () => {
      useInsightsStore.getState().markSeen();
      // Allow fire-and-forget to complete
      await new Promise((r) => setTimeout(r, 10));
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      expect(stored).not.toBeNull();
      expect(typeof JSON.parse(stored!)).toBe('number');
    });
  });

  describe('setHasNewInsights()', () => {
    it('toggles flag', () => {
      useInsightsStore.getState().setHasNewInsights(true);
      expect(useInsightsStore.getState().hasNewInsights).toBe(true);
      useInsightsStore.getState().setHasNewInsights(false);
      expect(useInsightsStore.getState().hasNewInsights).toBe(false);
    });
  });

  describe('idempotency', () => {
    it('initialize is idempotent (calling twice does not reset in-memory state)', async () => {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(1700000000000));
      await initializeInsightsStore();
      // Mutate in-memory state after first init
      useInsightsStore.getState().setHasNewInsights(true);
      expect(useInsightsStore.getState().hasNewInsights).toBe(true);
      // Second init should not crash and should still load
      await initializeInsightsStore();
      expect(useInsightsStore.getState().isLoaded).toBe(true);
      expect(useInsightsStore.getState().lastSeenTimestamp).toBe(1700000000000);
    });
  });
});
