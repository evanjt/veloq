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
} from '@/features/recording/stores/RecordingPreferencesStore';
import type { DataFieldType } from '@/types';

const STORAGE_KEY = 'veloq-recording-preferences';

const DEFAULT_AUTO_PAUSE_THRESHOLDS: Record<string, number> = {
  cycling: 2,
  running: 1,
  walking: 0.5,
};

const DEFAULT_DATA_FIELDS: Record<string, DataFieldType[]> = {
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
     * but does NOT reset state to defaults - the store keeps whatever state it
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

    // The `??` only guards null/undefined, so wrong-typed truthy values must be
    // type-checked: string thresholds/enabled and array dataFields must not slip through.
    it('coerces wrong-typed stored values back to their expected types', async () => {
      const cases: { payload: object; assert: () => void }[] = [
        {
          payload: { autoPauseThresholds: 'not-an-object' },
          assert: () => {
            const state = useRecordingPreferences.getState();
            expect(typeof state.autoPauseThresholds).toBe('object');
            expect(state.autoPauseThresholds).not.toBe('not-an-object');
          },
        },
        {
          payload: { autoPauseEnabled: 'false' },
          assert: () => {
            expect(typeof useRecordingPreferences.getState().autoPauseEnabled).toBe('boolean');
          },
        },
        {
          payload: { dataFields: ['gps', 'indoor'] },
          assert: () => {
            const state = useRecordingPreferences.getState();
            expect(typeof state.dataFields).toBe('object');
            expect(Array.isArray(state.dataFields)).toBe(false);
          },
        },
      ];

      for (const { payload, assert } of cases) {
        resetStore();
        await AsyncStorage.clear();
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
        await initializeRecordingPreferences();
        assert();
      }
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
    // Negative, NaN, and Infinity speeds make no physical sense and must not persist.
    it('rejects invalid threshold values, keeping a finite non-negative number', () => {
      for (const invalid of [-5, NaN, Infinity]) {
        resetStore();
        useRecordingPreferences.getState().setAutoPauseThreshold('cycling', invalid);
        const threshold = useRecordingPreferences.getState().autoPauseThresholds['cycling'];
        expect(Number.isFinite(threshold)).toBe(true);
        expect(threshold).toBeGreaterThanOrEqual(0);
      }
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
