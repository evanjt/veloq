/**
 * RecordingPreferencesStore edge case tests
 *
 * Target: finding bugs related to corrupt AsyncStorage data, invalid
 * values, and missing validation in the store.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  useRecordingPreferences,
  initializeRecordingPreferences,
} from '@/providers/RecordingPreferencesStore';

const STORAGE_KEY = 'veloq-recording-preferences';

const DEFAULT_AUTO_PAUSE_THRESHOLDS: Record<string, number> = {
  cycling: 2,
  running: 1,
  walking: 0.5,
};

const DEFAULT_DATA_FIELDS: Record<string, string[]> = {
  gps: ['speed', 'distance', 'heartrate', 'power'],
  indoor: ['heartrate', 'power', 'cadence', 'timer'],
  manual: ['timer', 'distance'],
};

function resetStore() {
  useRecordingPreferences.setState({
    recentActivityTypes: [],
    autoPauseEnabled: true,
    autoPauseThresholds: { ...DEFAULT_AUTO_PAUSE_THRESHOLDS },
    dataFields: { ...DEFAULT_DATA_FIELDS },
    isLoaded: false,
  });
}

describe('RecordingPreferencesStore', () => {
  beforeEach(async () => {
    resetStore();
    await AsyncStorage.clear();
    jest.clearAllMocks();
  });

  // ============================================================
  // Initialization defaults
  // ============================================================

  describe('defaults', () => {
    it('initializes with valid default auto-pause thresholds', () => {
      const state = useRecordingPreferences.getState();
      expect(state.autoPauseEnabled).toBe(true);
      expect(state.autoPauseThresholds).toEqual(DEFAULT_AUTO_PAUSE_THRESHOLDS);
      expect(state.dataFields).toEqual(DEFAULT_DATA_FIELDS);
      expect(state.recentActivityTypes).toEqual([]);
    });

    it('isLoaded starts as false before initialization', () => {
      expect(useRecordingPreferences.getState().isLoaded).toBe(false);
    });

    it('isLoaded becomes true after initialization with no stored data', async () => {
      await initializeRecordingPreferences();
      expect(useRecordingPreferences.getState().isLoaded).toBe(true);
    });
  });

  // ============================================================
  // Corrupt AsyncStorage recovery
  // ============================================================

  describe('corrupt AsyncStorage recovery', () => {
    /**
     * BUG FOUND: Broken JSON triggers the catch block, which sets isLoaded=true
     * but does NOT reset state to defaults — the store keeps whatever state it
     * had before. This is correct behavior (defaults are already set), but
     * let's verify.
     */
    it('recovers from invalid JSON without crashing', async () => {
      await AsyncStorage.setItem(STORAGE_KEY, '{broken json!!!');
      await initializeRecordingPreferences();
      expect(useRecordingPreferences.getState().isLoaded).toBe(true);
      // Should retain defaults, not garbage
      expect(useRecordingPreferences.getState().autoPauseEnabled).toBe(true);
      expect(useRecordingPreferences.getState().autoPauseThresholds).toEqual(
        DEFAULT_AUTO_PAUSE_THRESHOLDS
      );
    });

    /**
     * BUG: No type validation on parsed data. If stored data contains
     * a string where a Record<string, number> is expected, the store
     * will happily set it. The `??` only guards against null/undefined,
     * not wrong types.
     *
     * For example: stored `{autoPauseThresholds: "not-an-object"}` —
     * "not-an-object" is truthy, so `??` does NOT trigger the default.
     * The store sets autoPauseThresholds to the string "not-an-object".
     */
    it('stored autoPauseThresholds as string should fallback to defaults', async () => {
      await AsyncStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ autoPauseThresholds: 'not-an-object' })
      );
      await initializeRecordingPreferences();
      const state = useRecordingPreferences.getState();
      // The store should have an object, not a string
      expect(typeof state.autoPauseThresholds).toBe('object');
      expect(state.autoPauseThresholds).not.toBe('not-an-object');
    });

    /**
     * BUG: Stored autoPauseEnabled as string "false" — truthy in JS,
     * so `parsed.autoPauseEnabled ?? true` gives "false" (the string),
     * not false (the boolean). When used in a condition, string "false"
     * is truthy, so auto-pause would always appear enabled.
     */
    it('stored autoPauseEnabled as string "false" should resolve to boolean false', async () => {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ autoPauseEnabled: 'false' }));
      await initializeRecordingPreferences();
      const state = useRecordingPreferences.getState();
      // autoPauseEnabled should be boolean, not string
      expect(typeof state.autoPauseEnabled).toBe('boolean');
    });

    /**
     * BUG: Stored dataFields as array instead of Record — truthy,
     * so `??` doesn't trigger defaults.
     */
    it('stored dataFields as array should fallback to defaults', async () => {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ dataFields: ['gps', 'indoor'] }));
      await initializeRecordingPreferences();
      const state = useRecordingPreferences.getState();
      expect(typeof state.dataFields).toBe('object');
      expect(Array.isArray(state.dataFields)).toBe(false);
    });

    it('recovers when AsyncStorage.getItem throws', async () => {
      (AsyncStorage.getItem as jest.Mock).mockRejectedValueOnce(new Error('Storage error'));
      await initializeRecordingPreferences();
      expect(useRecordingPreferences.getState().isLoaded).toBe(true);
      expect(useRecordingPreferences.getState().autoPauseEnabled).toBe(true);
    });
  });

  // ============================================================
  // setAutoPauseThreshold validation
  // ============================================================

  describe('setAutoPauseThreshold edge cases', () => {
    /**
     * BUG: No validation on threshold values. Negative km/h, NaN,
     * and Infinity are all accepted and persisted.
     */
    it('negative threshold should not be stored (or at least clamped to 0)', () => {
      useRecordingPreferences.getState().setAutoPauseThreshold('cycling', -5);
      const threshold = useRecordingPreferences.getState().autoPauseThresholds['cycling'];
      // Negative speed threshold makes no physical sense
      expect(threshold).toBeGreaterThanOrEqual(0);
    });

    it('NaN threshold should not be stored', () => {
      useRecordingPreferences.getState().setAutoPauseThreshold('cycling', NaN);
      const threshold = useRecordingPreferences.getState().autoPauseThresholds['cycling'];
      expect(Number.isNaN(threshold)).toBe(false);
    });

    it('Infinity threshold should not be stored', () => {
      useRecordingPreferences.getState().setAutoPauseThreshold('cycling', Infinity);
      const threshold = useRecordingPreferences.getState().autoPauseThresholds['cycling'];
      expect(Number.isFinite(threshold)).toBe(true);
    });

    it('valid threshold is stored correctly', () => {
      useRecordingPreferences.getState().setAutoPauseThreshold('cycling', 3.5);
      expect(useRecordingPreferences.getState().autoPauseThresholds['cycling']).toBe(3.5);
    });
  });

  // ============================================================
  // addRecentType
  // ============================================================

  describe('addRecentType', () => {
    it('adds type to front of list', () => {
      useRecordingPreferences.getState().addRecentType('Ride');
      expect(useRecordingPreferences.getState().recentActivityTypes[0]).toBe('Ride');
    });

    it('removes duplicates when adding same type again', () => {
      useRecordingPreferences.getState().addRecentType('Ride');
      useRecordingPreferences.getState().addRecentType('Run');
      useRecordingPreferences.getState().addRecentType('Ride');
      const types = useRecordingPreferences.getState().recentActivityTypes;
      expect(types[0]).toBe('Ride');
      expect(types.filter((t) => t === 'Ride')).toHaveLength(1);
    });

    it('limits to 4 recent types', () => {
      useRecordingPreferences.getState().addRecentType('Ride');
      useRecordingPreferences.getState().addRecentType('Run');
      useRecordingPreferences.getState().addRecentType('Swim');
      useRecordingPreferences.getState().addRecentType('Hike');
      useRecordingPreferences.getState().addRecentType('Walk');
      const types = useRecordingPreferences.getState().recentActivityTypes;
      expect(types).toHaveLength(4);
      expect(types[0]).toBe('Walk');
      // 'Ride' should be evicted as the oldest
      expect(types).not.toContain('Ride');
    });
  });

  // ============================================================
  // setDataFields
  // ============================================================

  describe('setDataFields', () => {
    it('sets fields for a mode without affecting other modes', () => {
      useRecordingPreferences.getState().setDataFields('gps', ['speed', 'heartrate']);
      const fields = useRecordingPreferences.getState().dataFields;
      expect(fields.gps).toEqual(['speed', 'heartrate']);
      expect(fields.indoor).toEqual(DEFAULT_DATA_FIELDS.indoor);
    });

    it('allows setting empty fields array', () => {
      useRecordingPreferences.getState().setDataFields('gps', []);
      expect(useRecordingPreferences.getState().dataFields.gps).toEqual([]);
    });
  });

  // ============================================================
  // Persistence
  // ============================================================

  describe('persistence', () => {
    it('persists changes to AsyncStorage', async () => {
      useRecordingPreferences.getState().setAutoPause(false);
      // Give the async write time to complete
      await new Promise((resolve) => setTimeout(resolve, 10));
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      expect(stored).toBeTruthy();
      const parsed = JSON.parse(stored!);
      expect(parsed.autoPauseEnabled).toBe(false);
    });

    it('persist failure does not crash the store', async () => {
      (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('Write failed'));
      // Should not throw
      expect(() => {
        useRecordingPreferences.getState().setAutoPause(false);
      }).not.toThrow();
      // State should still be updated (optimistic update)
      expect(useRecordingPreferences.getState().autoPauseEnabled).toBe(false);
    });
  });
});
