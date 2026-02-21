/**
 * MapPreferencesContext Tests
 *
 * Focus: Bug-catching edge cases over coverage metrics
 * - ActivityType validation
 * - Style resolution (override vs default)
 * - Batch updates
 * - Persistence validation
 * - Concurrent update safety
 */

import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MapPreferencesProvider, useMapPreferences } from '@/providers/MapPreferencesContext';
import type { MapStyleType } from '@/components/maps/mapStyles';
import type { ActivityType } from '@/types';

const STORAGE_KEY = 'veloq-map-preferences';

const DEFAULT_PREFERENCES = {
  defaultStyle: 'light' as MapStyleType,
  activityTypeStyles: {},
  terrain3DDefault: false,
  terrain3DByType: {},
};

// Wrapper for testing hooks
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <MapPreferencesProvider>{children}</MapPreferencesProvider>
);

describe('MapPreferencesContext', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.clearAllMocks();
  });

  // ============================================================
  // CONTEXT BASICS
  // ============================================================

  describe('Context Setup', () => {
    it('throws error when used outside provider', () => {
      // Suppress console.error for this test
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      expect(() => {
        renderHook(() => useMapPreferences());
      }).toThrow('useMapPreferences must be used within a MapPreferencesProvider');

      consoleSpy.mockRestore();
    });

    it('provides default preferences initially', async () => {
      const { result } = renderHook(() => useMapPreferences(), { wrapper });

      await waitFor(() => {
        expect(result.current.isLoaded).toBe(true);
      });

      expect(result.current.preferences.defaultStyle).toBe('light');
      expect(result.current.preferences.activityTypeStyles).toEqual({});
    });

    it('sets isLoaded to true after initialization', async () => {
      const { result } = renderHook(() => useMapPreferences(), { wrapper });

      await waitFor(() => {
        expect(result.current.isLoaded).toBe(true);
      });
    });
  });

  // ============================================================
  // STYLE RESOLUTION
  // ============================================================

  describe('getStyleForActivity() - Style Resolution', () => {
    it('returns default style when no override exists', async () => {
      const { result } = renderHook(() => useMapPreferences(), { wrapper });

      await waitFor(() => {
        expect(result.current.isLoaded).toBe(true);
      });

      const style = result.current.getStyleForActivity('Ride');
      expect(style).toBe('light');
    });

    it('returns override when one exists', async () => {
      await AsyncStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          defaultStyle: 'light',
          activityTypeStyles: { Ride: 'dark' },
        })
      );

      const { result } = renderHook(() => useMapPreferences(), { wrapper });

      await waitFor(() => {
        expect(result.current.isLoaded).toBe(true);
      });

      expect(result.current.getStyleForActivity('Ride')).toBe('dark');
      expect(result.current.getStyleForActivity('Run')).toBe('light'); // No override
    });

    it('returns updated style after setActivityTypeStyle', async () => {
      const { result } = renderHook(() => useMapPreferences(), { wrapper });

      await waitFor(() => {
        expect(result.current.isLoaded).toBe(true);
      });

      await act(async () => {
        await result.current.setActivityTypeStyle('Ride', 'satellite');
      });

      expect(result.current.getStyleForActivity('Ride')).toBe('satellite');
    });
  });

  // ============================================================
  // SETDEFAULTSTYLE
  // ============================================================

  describe('setDefaultStyle()', () => {
    it('updates default style', async () => {
      const { result } = renderHook(() => useMapPreferences(), { wrapper });

      await waitFor(() => {
        expect(result.current.isLoaded).toBe(true);
      });

      await act(async () => {
        await result.current.setDefaultStyle('dark');
      });

      expect(result.current.preferences.defaultStyle).toBe('dark');
    });

    /**
     * BUG: Persistence never executes due to React batching
     *
     * The code assumes setState callback runs synchronously:
     *   let newPrefs = null;
     *   setPreferences((prev) => { newPrefs = {...}; return newPrefs; });
     *   if (newPrefs) await savePreferences(newPrefs);  // newPrefs is still null!
     *
     * With React 18's automatic batching, the callback is deferred,
     * so `newPrefs` is still null when the if-check runs.
     *
     * FIX: Use useRef or useEffect to persist after state update.
     */
    it('should persist changes to AsyncStorage', async () => {
      const { result } = renderHook(() => useMapPreferences(), { wrapper });

      await waitFor(() => {
        expect(result.current.isLoaded).toBe(true);
      });

      const setItemSpy = jest.spyOn(AsyncStorage, 'setItem');

      await act(async () => {
        await result.current.setDefaultStyle('satellite');
      });

      // setItem SHOULD be called to persist the change
      expect(setItemSpy).toHaveBeenCalledWith(
        STORAGE_KEY,
        expect.stringContaining('"defaultStyle":"satellite"')
      );

      setItemSpy.mockRestore();
    });

    it('does not affect activity type overrides', async () => {
      const { result } = renderHook(() => useMapPreferences(), { wrapper });

      await waitFor(() => {
        expect(result.current.isLoaded).toBe(true);
      });

      // Set an override first
      await act(async () => {
        await result.current.setActivityTypeStyle('Ride', 'dark');
      });

      // Change default
      await act(async () => {
        await result.current.setDefaultStyle('satellite');
      });

      // Override should still be dark
      expect(result.current.getStyleForActivity('Ride')).toBe('dark');
      expect(result.current.preferences.defaultStyle).toBe('satellite');
    });
  });

  // ============================================================
  // SETACTIVITYTYPESTYLE
  // ============================================================

  describe('setActivityTypeStyle()', () => {
    it('adds new override', async () => {
      const { result } = renderHook(() => useMapPreferences(), { wrapper });

      await waitFor(() => {
        expect(result.current.isLoaded).toBe(true);
      });

      await act(async () => {
        await result.current.setActivityTypeStyle('Ride', 'dark');
      });

      expect(result.current.preferences.activityTypeStyles.Ride).toBe('dark');
    });

    it('updates existing override', async () => {
      await AsyncStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          defaultStyle: 'light',
          activityTypeStyles: { Ride: 'dark' },
        })
      );

      const { result } = renderHook(() => useMapPreferences(), { wrapper });

      await waitFor(() => {
        expect(result.current.isLoaded).toBe(true);
      });

      await act(async () => {
        await result.current.setActivityTypeStyle('Ride', 'satellite');
      });

      expect(result.current.preferences.activityTypeStyles.Ride).toBe('satellite');
    });

    it('removes override when style is null', async () => {
      await AsyncStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          defaultStyle: 'light',
          activityTypeStyles: { Ride: 'dark' },
        })
      );

      const { result } = renderHook(() => useMapPreferences(), { wrapper });

      await waitFor(() => {
        expect(result.current.isLoaded).toBe(true);
      });

      await act(async () => {
        await result.current.setActivityTypeStyle('Ride', null);
      });

      expect(result.current.preferences.activityTypeStyles.Ride).toBeUndefined();
      expect(result.current.getStyleForActivity('Ride')).toBe('light'); // Falls back to default
    });

    /**
     * BUG: Same React batching bug as setDefaultStyle - persistence never runs.
     * FIX: Use useRef or useEffect to persist after state update.
     */
    it('should persist activity type style to AsyncStorage', async () => {
      const { result } = renderHook(() => useMapPreferences(), { wrapper });

      await waitFor(() => {
        expect(result.current.isLoaded).toBe(true);
      });

      const setItemSpy = jest.spyOn(AsyncStorage, 'setItem');

      await act(async () => {
        await result.current.setActivityTypeStyle('Run', 'satellite');
      });

      // setItem SHOULD be called
      expect(setItemSpy).toHaveBeenCalledWith(
        STORAGE_KEY,
        expect.stringContaining('"Run":"satellite"')
      );

      setItemSpy.mockRestore();
    });
  });

  // ============================================================
  // BATCH UPDATES
  // ============================================================

  describe('setActivityGroupStyle() - Batch Updates', () => {
    it('updates multiple activity types at once', async () => {
      const { result } = renderHook(() => useMapPreferences(), { wrapper });

      await waitFor(() => {
        expect(result.current.isLoaded).toBe(true);
      });

      await act(async () => {
        await result.current.setActivityGroupStyle(['Ride', 'VirtualRide', 'GravelRide'], 'dark');
      });

      expect(result.current.preferences.activityTypeStyles.Ride).toBe('dark');
      expect(result.current.preferences.activityTypeStyles.VirtualRide).toBe('dark');
      expect(result.current.preferences.activityTypeStyles.GravelRide).toBe('dark');
    });

    it('removes multiple overrides when style is null', async () => {
      const { result } = renderHook(() => useMapPreferences(), { wrapper });

      await waitFor(() => {
        expect(result.current.isLoaded).toBe(true);
      });

      // First set up the overrides
      await act(async () => {
        await result.current.setActivityGroupStyle(['Ride', 'Run', 'Swim'], 'dark');
      });

      // Then remove Ride and Run
      await act(async () => {
        await result.current.setActivityGroupStyle(['Ride', 'Run'], null);
      });

      expect(result.current.preferences.activityTypeStyles.Ride).toBeUndefined();
      expect(result.current.preferences.activityTypeStyles.Run).toBeUndefined();
      expect(result.current.preferences.activityTypeStyles.Swim).toBe('dark'); // Unchanged
    });

    /**
     * BUG: Same React batching bug affects batch updates - persistence never runs.
     * FIX: Use useRef or useEffect to persist after state update.
     */
    it('should persist batch update to AsyncStorage', async () => {
      const { result } = renderHook(() => useMapPreferences(), { wrapper });

      await waitFor(() => {
        expect(result.current.isLoaded).toBe(true);
      });

      const setItemSpy = jest.spyOn(AsyncStorage, 'setItem');

      await act(async () => {
        await result.current.setActivityGroupStyle(['Ride', 'Run', 'Swim'], 'satellite');
      });

      // setItem SHOULD be called with all three activity types
      expect(setItemSpy).toHaveBeenCalledWith(
        STORAGE_KEY,
        expect.stringContaining('"Ride":"satellite"')
      );

      setItemSpy.mockRestore();
    });

    it('handles empty array gracefully', async () => {
      const { result } = renderHook(() => useMapPreferences(), { wrapper });

      await waitFor(() => {
        expect(result.current.isLoaded).toBe(true);
      });

      const prefsBefore = { ...result.current.preferences };

      await act(async () => {
        await result.current.setActivityGroupStyle([], 'dark');
      });

      // No changes should occur
      expect(result.current.preferences.activityTypeStyles).toEqual(prefsBefore.activityTypeStyles);
    });
  });

  // ============================================================
  // PERSISTENCE VALIDATION
  // ============================================================

  describe('Persistence Validation', () => {
    it('loads default preferences when storage is empty', async () => {
      const { result } = renderHook(() => useMapPreferences(), { wrapper });

      await waitFor(() => {
        expect(result.current.isLoaded).toBe(true);
      });

      expect(result.current.preferences.defaultStyle).toBe('light');
      expect(result.current.preferences.activityTypeStyles).toEqual({});
    });

    it('rejects invalid JSON and uses defaults', async () => {
      await AsyncStorage.setItem(STORAGE_KEY, 'not valid json {{{');

      const { result } = renderHook(() => useMapPreferences(), { wrapper });

      await waitFor(() => {
        expect(result.current.isLoaded).toBe(true);
      });

      expect(result.current.preferences).toEqual(DEFAULT_PREFERENCES);
    });

    it('rejects invalid defaultStyle value and uses defaults', async () => {
      await AsyncStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          defaultStyle: 'invalid_style',
          activityTypeStyles: {},
        })
      );

      const { result } = renderHook(() => useMapPreferences(), { wrapper });

      await waitFor(() => {
        expect(result.current.isLoaded).toBe(true);
      });

      expect(result.current.preferences.defaultStyle).toBe('light');
    });

    it('rejects invalid activityTypeStyles key and uses defaults', async () => {
      await AsyncStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          defaultStyle: 'light',
          activityTypeStyles: { InvalidActivityType: 'dark' },
        })
      );

      const { result } = renderHook(() => useMapPreferences(), { wrapper });

      await waitFor(() => {
        expect(result.current.isLoaded).toBe(true);
      });

      // Should reject entire object due to invalid key
      expect(result.current.preferences.activityTypeStyles).toEqual({});
    });

    it('rejects invalid activityTypeStyles value and uses defaults', async () => {
      await AsyncStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          defaultStyle: 'light',
          activityTypeStyles: { Ride: 'invalid_style' },
        })
      );

      const { result } = renderHook(() => useMapPreferences(), { wrapper });

      await waitFor(() => {
        expect(result.current.isLoaded).toBe(true);
      });

      // Should reject entire object due to invalid value
      expect(result.current.preferences.activityTypeStyles.Ride).toBeUndefined();
    });

    it('rejects non-object defaultStyle type', async () => {
      await AsyncStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          defaultStyle: 123, // Should be string
          activityTypeStyles: {},
        })
      );

      const { result } = renderHook(() => useMapPreferences(), { wrapper });

      await waitFor(() => {
        expect(result.current.isLoaded).toBe(true);
      });

      expect(result.current.preferences.defaultStyle).toBe('light');
    });

    it('handles AsyncStorage read failure gracefully', async () => {
      const mockGetItem = AsyncStorage.getItem as jest.Mock;
      mockGetItem.mockRejectedValueOnce(new Error('Storage unavailable'));

      const { result } = renderHook(() => useMapPreferences(), { wrapper });

      await waitFor(() => {
        expect(result.current.isLoaded).toBe(true);
      });

      // Should use defaults after error
      expect(result.current.preferences).toEqual(DEFAULT_PREFERENCES);
    });
  });

  // ============================================================
  // VALID ACTIVITY TYPES
  // ============================================================

  describe('ActivityType Validation', () => {
    it('accepts standard activity types via setActivityTypeStyle', async () => {
      const { result } = renderHook(() => useMapPreferences(), { wrapper });

      await waitFor(() => {
        expect(result.current.isLoaded).toBe(true);
      });

      const validTypes: ActivityType[] = ['Ride', 'Run', 'Swim', 'Hike', 'Walk'];

      for (const activityType of validTypes) {
        await act(async () => {
          await result.current.setActivityTypeStyle(activityType, 'dark');
        });
        expect(result.current.preferences.activityTypeStyles[activityType]).toBe('dark');
      }
    });

    it('accepts VirtualRide activity type', async () => {
      const { result } = renderHook(() => useMapPreferences(), { wrapper });

      await waitFor(() => {
        expect(result.current.isLoaded).toBe(true);
      });

      await act(async () => {
        await result.current.setActivityTypeStyle('VirtualRide', 'satellite');
      });

      expect(result.current.preferences.activityTypeStyles.VirtualRide).toBe('satellite');
    });

    it('accepts multiple virtual activity types', async () => {
      const { result } = renderHook(() => useMapPreferences(), { wrapper });

      await waitFor(() => {
        expect(result.current.isLoaded).toBe(true);
      });

      await act(async () => {
        await result.current.setActivityTypeStyle('VirtualRide', 'dark');
        await result.current.setActivityTypeStyle('VirtualRun', 'satellite');
      });

      expect(result.current.preferences.activityTypeStyles.VirtualRide).toBe('dark');
      expect(result.current.preferences.activityTypeStyles.VirtualRun).toBe('satellite');
    });
  });

  // ============================================================
  // CONCURRENT UPDATES
  // ============================================================

  describe('Concurrent Update Safety', () => {
    it('sequential updates preserve all changes', async () => {
      const { result } = renderHook(() => useMapPreferences(), { wrapper });

      await waitFor(() => {
        expect(result.current.isLoaded).toBe(true);
      });

      await act(async () => {
        await result.current.setActivityTypeStyle('Ride', 'dark');
      });

      await act(async () => {
        await result.current.setActivityTypeStyle('Run', 'satellite');
      });

      await act(async () => {
        await result.current.setDefaultStyle('dark');
      });

      expect(result.current.preferences.activityTypeStyles.Ride).toBe('dark');
      expect(result.current.preferences.activityTypeStyles.Run).toBe('satellite');
      expect(result.current.preferences.defaultStyle).toBe('dark');
    });

    it('rapid updates to different activity types preserve all changes', async () => {
      const { result } = renderHook(() => useMapPreferences(), { wrapper });

      await waitFor(() => {
        expect(result.current.isLoaded).toBe(true);
      });

      // Fire multiple updates in quick succession
      await act(async () => {
        await Promise.all([
          result.current.setActivityTypeStyle('Ride', 'dark'),
          result.current.setActivityTypeStyle('Run', 'satellite'),
          result.current.setActivityTypeStyle('Swim', 'light'),
        ]);
      });

      // Due to functional updates in setPreferences, all should be preserved
      expect(result.current.preferences.activityTypeStyles.Ride).toBe('dark');
      expect(result.current.preferences.activityTypeStyles.Run).toBe('satellite');
      expect(result.current.preferences.activityTypeStyles.Swim).toBe('light');
    });
  });

  // ============================================================
  // EDGE CASES
  // ============================================================

  describe('Edge Cases', () => {
    it('handles null activityTypeStyles in stored data', async () => {
      await AsyncStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          defaultStyle: 'dark',
          activityTypeStyles: null,
        })
      );

      const { result } = renderHook(() => useMapPreferences(), { wrapper });

      await waitFor(() => {
        expect(result.current.isLoaded).toBe(true);
      });

      // Should reject and use defaults
      expect(result.current.preferences.activityTypeStyles).toEqual({});
    });

    it('handles default empty activityTypeStyles', async () => {
      const { result } = renderHook(() => useMapPreferences(), { wrapper });

      await waitFor(() => {
        expect(result.current.isLoaded).toBe(true);
      });

      // Default should have empty activityTypeStyles
      expect(result.current.preferences.activityTypeStyles).toEqual({});
      expect(result.current.preferences.defaultStyle).toBe('light');
    });

    it('handles array in place of activityTypeStyles object', async () => {
      await AsyncStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          defaultStyle: 'light',
          activityTypeStyles: ['Ride', 'Run'], // Should be object, not array
        })
      );

      const { result } = renderHook(() => useMapPreferences(), { wrapper });

      await waitFor(() => {
        expect(result.current.isLoaded).toBe(true);
      });

      // Should reject and use defaults
      expect(result.current.preferences.activityTypeStyles).toEqual({});
    });
  });
});
