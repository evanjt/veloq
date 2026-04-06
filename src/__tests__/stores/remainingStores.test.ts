/**
 * Remaining Zustand Store Tests
 *
 * Tests for 3 stores not covered by existing provider tests:
 * - DebugStore (unlock/enable debug mode, AsyncStorage persistence, sync helper)
 * - WhatsNewStore (version tracking, tour state machine)
 * - TileCacheStore (ambient cache settings, native pack info, migration)
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

// Mock veloqrs and renderTimer so syncDebugToFFI doesn't crash
jest.mock('veloqrs', () => ({
  RouteEngineClient: {
    setMetricRecorder: jest.fn(),
    setDebugEnabled: jest.fn(),
  },
}));
jest.mock('@/lib/debug/renderTimer', () => ({
  recordFFIMetric: jest.fn(),
}));

// TileCacheStore imports @/lib which triggers a deep import chain
// (debug.ts __DEV__, routeEngine.ts -> expo-file-system). Mock the barrel export.
const noop = () => {};
jest.mock('@/lib', () => ({
  debug: { create: () => noop },
}));

// DebugStore
import { useDebugStore, isDebugEnabled } from '@/providers/DebugStore';

// WhatsNewStore
import { useWhatsNewStore, initializeWhatsNewStore } from '@/providers/WhatsNewStore';

// TileCacheStore
import { useTileCacheStore, initializeTileCacheStore } from '@/providers/TileCacheStore';

// Storage keys (must match store implementations)
const DEBUG_MODE_KEY = 'veloq-debug-mode';
const WHATS_NEW_KEY = 'veloq-whats-new-seen';
const TILE_CACHE_KEY = 'veloq-tile-cache';

// ================================================================
// DebugStore
// ================================================================

describe('DebugStore', () => {
  beforeEach(async () => {
    useDebugStore.setState({
      unlocked: false,
      enabled: false,
      isLoaded: false,
    });
    await AsyncStorage.clear();
    jest.clearAllMocks();
  });

  describe('initial state', () => {
    it('has correct defaults', () => {
      const state = useDebugStore.getState();
      expect(state.unlocked).toBe(false);
      expect(state.enabled).toBe(false);
      expect(state.isLoaded).toBe(false);
    });
  });

  describe('initialize()', () => {
    it('sets isLoaded when no stored data', async () => {
      await useDebugStore.getState().initialize();
      const state = useDebugStore.getState();
      expect(state.isLoaded).toBe(true);
      expect(state.unlocked).toBe(false);
      expect(state.enabled).toBe(false);
    });

    it('restores enabled=true from storage and sets unlocked', async () => {
      await AsyncStorage.setItem(DEBUG_MODE_KEY, JSON.stringify({ enabled: true }));
      await useDebugStore.getState().initialize();
      const state = useDebugStore.getState();
      expect(state.isLoaded).toBe(true);
      expect(state.enabled).toBe(true);
      expect(state.unlocked).toBe(true);
    });

    it('restores enabled=false from storage', async () => {
      await AsyncStorage.setItem(DEBUG_MODE_KEY, JSON.stringify({ enabled: false }));
      await useDebugStore.getState().initialize();
      const state = useDebugStore.getState();
      expect(state.isLoaded).toBe(true);
      expect(state.enabled).toBe(false);
      expect(state.unlocked).toBe(false);
    });

    it('handles corrupt JSON gracefully', async () => {
      await AsyncStorage.setItem(DEBUG_MODE_KEY, 'not valid json');
      await useDebugStore.getState().initialize();
      expect(useDebugStore.getState().isLoaded).toBe(true);
      expect(useDebugStore.getState().enabled).toBe(false);
    });

    it('sets isLoaded even when AsyncStorage throws', async () => {
      (AsyncStorage.getItem as jest.Mock).mockRejectedValueOnce(new Error('fail'));
      await useDebugStore.getState().initialize();
      expect(useDebugStore.getState().isLoaded).toBe(true);
    });
  });

  describe('unlock()', () => {
    it('sets unlocked to true', async () => {
      await useDebugStore.getState().unlock();
      expect(useDebugStore.getState().unlocked).toBe(true);
    });

    it('does not affect enabled state', async () => {
      await useDebugStore.getState().unlock();
      expect(useDebugStore.getState().enabled).toBe(false);
    });
  });

  describe('setEnabled()', () => {
    it('enables debug mode and persists', async () => {
      await useDebugStore.getState().setEnabled(true);
      expect(useDebugStore.getState().enabled).toBe(true);
      expect(useDebugStore.getState().unlocked).toBe(true);
      const stored = JSON.parse((await AsyncStorage.getItem(DEBUG_MODE_KEY))!);
      expect(stored.enabled).toBe(true);
    });

    it('disables debug mode and persists', async () => {
      await useDebugStore.getState().setEnabled(true);
      await useDebugStore.getState().setEnabled(false);
      expect(useDebugStore.getState().enabled).toBe(false);
      expect(useDebugStore.getState().unlocked).toBe(false);
      const stored = JSON.parse((await AsyncStorage.getItem(DEBUG_MODE_KEY))!);
      expect(stored.enabled).toBe(false);
    });
  });

  describe('isDebugEnabled() helper', () => {
    it('returns current enabled state', () => {
      expect(isDebugEnabled()).toBe(false);
      useDebugStore.setState({ enabled: true });
      expect(isDebugEnabled()).toBe(true);
    });
  });
});

// ================================================================
// WhatsNewStore
// ================================================================

describe('WhatsNewStore', () => {
  beforeEach(async () => {
    useWhatsNewStore.setState({
      lastSeenVersion: null,
      isLoaded: false,
      tourState: null,
    });
    await AsyncStorage.clear();
    jest.clearAllMocks();
  });

  describe('initial state', () => {
    it('has correct defaults', () => {
      const state = useWhatsNewStore.getState();
      expect(state.lastSeenVersion).toBeNull();
      expect(state.isLoaded).toBe(false);
      expect(state.tourState).toBeNull();
    });
  });

  describe('initialize()', () => {
    it('sets isLoaded when no stored data', async () => {
      await initializeWhatsNewStore();
      const state = useWhatsNewStore.getState();
      expect(state.isLoaded).toBe(true);
      expect(state.lastSeenVersion).toBeNull();
    });

    it('restores version from storage', async () => {
      await AsyncStorage.setItem(WHATS_NEW_KEY, '0.3.0');
      await initializeWhatsNewStore();
      expect(useWhatsNewStore.getState().lastSeenVersion).toBe('0.3.0');
      expect(useWhatsNewStore.getState().isLoaded).toBe(true);
    });

    it('sets isLoaded even when AsyncStorage throws', async () => {
      (AsyncStorage.getItem as jest.Mock).mockRejectedValueOnce(new Error('fail'));
      await initializeWhatsNewStore();
      expect(useWhatsNewStore.getState().isLoaded).toBe(true);
    });
  });

  describe('markSeen()', () => {
    it('updates lastSeenVersion and persists', async () => {
      await useWhatsNewStore.getState().markSeen('0.3.0');
      expect(useWhatsNewStore.getState().lastSeenVersion).toBe('0.3.0');
      expect(await AsyncStorage.getItem(WHATS_NEW_KEY)).toBe('0.3.0');
    });

    it('overwrites previous version', async () => {
      await useWhatsNewStore.getState().markSeen('0.2.0');
      await useWhatsNewStore.getState().markSeen('0.3.0');
      expect(useWhatsNewStore.getState().lastSeenVersion).toBe('0.3.0');
      expect(await AsyncStorage.getItem(WHATS_NEW_KEY)).toBe('0.3.0');
    });
  });

  describe('Tour State Machine', () => {
    describe('startTour()', () => {
      it('starts whatsNew tour with initial state', () => {
        useWhatsNewStore.getState().startTour('whatsNew');
        const tour = useWhatsNewStore.getState().tourState;
        expect(tour).not.toBeNull();
        expect(tour!.mode).toBe('whatsNew');
        expect(tour!.resumeIndex).toBe(0);
        expect(tour!.exploring).toBe(false);
        expect(tour!.tip).toBeNull();
      });

      it('starts tutorial tour', () => {
        useWhatsNewStore.getState().startTour('tutorial');
        expect(useWhatsNewStore.getState().tourState!.mode).toBe('tutorial');
      });
    });

    describe('showMe()', () => {
      it('sets exploring state with next index and tip', () => {
        useWhatsNewStore.getState().startTour('whatsNew');
        useWhatsNewStore.getState().showMe(2, 'Try this feature');
        const tour = useWhatsNewStore.getState().tourState;
        expect(tour!.resumeIndex).toBe(2);
        expect(tour!.exploring).toBe(true);
        expect(tour!.tip).toBe('Try this feature');
      });

      it('defaults tip to null when not provided', () => {
        useWhatsNewStore.getState().startTour('whatsNew');
        useWhatsNewStore.getState().showMe(1);
        expect(useWhatsNewStore.getState().tourState!.tip).toBeNull();
      });

      it('is a no-op when no tour is active', () => {
        useWhatsNewStore.getState().showMe(5, 'ignored');
        expect(useWhatsNewStore.getState().tourState).toBeNull();
      });
    });

    describe('resumeTour()', () => {
      it('clears exploring flag while keeping index', () => {
        useWhatsNewStore.getState().startTour('whatsNew');
        useWhatsNewStore.getState().showMe(3, 'Exploring');
        useWhatsNewStore.getState().resumeTour();
        const tour = useWhatsNewStore.getState().tourState;
        expect(tour!.exploring).toBe(false);
        expect(tour!.resumeIndex).toBe(3);
      });

      it('is a no-op when no tour is active', () => {
        useWhatsNewStore.getState().resumeTour();
        expect(useWhatsNewStore.getState().tourState).toBeNull();
      });
    });

    describe('endTour()', () => {
      it('clears tour state', () => {
        useWhatsNewStore.getState().startTour('whatsNew');
        useWhatsNewStore.getState().showMe(2);
        useWhatsNewStore.getState().endTour();
        expect(useWhatsNewStore.getState().tourState).toBeNull();
      });

      it('is safe to call when no tour active', () => {
        useWhatsNewStore.getState().endTour();
        expect(useWhatsNewStore.getState().tourState).toBeNull();
      });
    });
  });
});

// ================================================================
// TileCacheStore
// ================================================================

describe('TileCacheStore', () => {
  beforeEach(async () => {
    useTileCacheStore.setState({
      isLoaded: false,
      nativePackCount: 0,
      nativeSizeEstimate: 0,
    });
    await AsyncStorage.clear();
    jest.clearAllMocks();
  });

  describe('initial state', () => {
    it('has correct defaults', () => {
      const state = useTileCacheStore.getState();
      expect(state.isLoaded).toBe(false);
      expect(state.nativePackCount).toBe(0);
      expect(state.nativeSizeEstimate).toBe(0);
    });
  });

  describe('initialize()', () => {
    it('sets isLoaded when no stored data', async () => {
      await initializeTileCacheStore();
      expect(useTileCacheStore.getState().isLoaded).toBe(true);
    });

    it('sets isLoaded with existing ambient cache settings', async () => {
      await AsyncStorage.setItem(TILE_CACHE_KEY, JSON.stringify({ cacheMode: 'ambient' }));
      await initializeTileCacheStore();
      expect(useTileCacheStore.getState().isLoaded).toBe(true);
    });

    it('migrates old proactive cache settings to ambient', async () => {
      await AsyncStorage.setItem(
        TILE_CACHE_KEY,
        JSON.stringify({ cacheMode: 'proactive', maxSize: 500 })
      );
      await initializeTileCacheStore();
      expect(useTileCacheStore.getState().isLoaded).toBe(true);
      const stored = JSON.parse((await AsyncStorage.getItem(TILE_CACHE_KEY))!);
      expect(stored.cacheMode).toBe('ambient');
    });

    it('does not overwrite already-ambient settings', async () => {
      await AsyncStorage.setItem(
        TILE_CACHE_KEY,
        JSON.stringify({ cacheMode: 'ambient', extra: 'field' })
      );
      await initializeTileCacheStore();
      // Should not call setItem since mode is already ambient
      const stored = JSON.parse((await AsyncStorage.getItem(TILE_CACHE_KEY))!);
      expect(stored.cacheMode).toBe('ambient');
      expect(stored.extra).toBe('field');
    });

    it('handles corrupt JSON gracefully', async () => {
      await AsyncStorage.setItem(TILE_CACHE_KEY, 'not valid json');
      await initializeTileCacheStore();
      expect(useTileCacheStore.getState().isLoaded).toBe(true);
    });

    it('sets isLoaded even when AsyncStorage throws', async () => {
      (AsyncStorage.getItem as jest.Mock).mockRejectedValueOnce(new Error('fail'));
      await initializeTileCacheStore();
      expect(useTileCacheStore.getState().isLoaded).toBe(true);
    });
  });

  describe('setNativePackInfo()', () => {
    it('updates pack count and size estimate', () => {
      useTileCacheStore.getState().setNativePackInfo(5, 1024000);
      const state = useTileCacheStore.getState();
      expect(state.nativePackCount).toBe(5);
      expect(state.nativeSizeEstimate).toBe(1024000);
    });

    it('can update to zero values', () => {
      useTileCacheStore.getState().setNativePackInfo(5, 1024000);
      useTileCacheStore.getState().setNativePackInfo(0, 0);
      const state = useTileCacheStore.getState();
      expect(state.nativePackCount).toBe(0);
      expect(state.nativeSizeEstimate).toBe(0);
    });

    it('does not affect isLoaded', () => {
      useTileCacheStore.getState().setNativePackInfo(3, 500000);
      expect(useTileCacheStore.getState().isLoaded).toBe(false);
    });
  });
});
