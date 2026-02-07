/**
 * DisabledSectionsStore Tests
 *
 * Focus: Set-based state management for hiding auto-detected sections
 * - Initialize from AsyncStorage (empty, valid, corrupt)
 * - Disable/enable toggling with persistence
 * - Synchronous helpers (isDisabled, getAllDisabled)
 * - Clear all
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useDisabledSections, initializeDisabledSections } from '@/providers/DisabledSectionsStore';

const DISABLED_SECTIONS_KEY = 'veloq-disabled-sections';

describe('DisabledSectionsStore', () => {
  beforeEach(async () => {
    useDisabledSections.setState({
      disabledIds: new Set(),
      isLoaded: false,
    });
    await AsyncStorage.clear();
    jest.clearAllMocks();
  });

  // ============================================================
  // INITIALIZATION
  // ============================================================

  describe('initialize()', () => {
    it('sets isLoaded to true when no stored data', async () => {
      await useDisabledSections.getState().initialize();
      const state = useDisabledSections.getState();
      expect(state.isLoaded).toBe(true);
      expect(state.disabledIds.size).toBe(0);
    });

    it('restores disabled IDs from storage', async () => {
      await AsyncStorage.setItem(DISABLED_SECTIONS_KEY, JSON.stringify(['s1', 's2', 's3']));
      await useDisabledSections.getState().initialize();
      const state = useDisabledSections.getState();
      expect(state.isLoaded).toBe(true);
      expect(state.disabledIds.size).toBe(3);
      expect(state.disabledIds.has('s1')).toBe(true);
      expect(state.disabledIds.has('s2')).toBe(true);
      expect(state.disabledIds.has('s3')).toBe(true);
    });

    it('handles corrupt JSON gracefully', async () => {
      await AsyncStorage.setItem(DISABLED_SECTIONS_KEY, '{not valid json');
      await useDisabledSections.getState().initialize();
      const state = useDisabledSections.getState();
      expect(state.isLoaded).toBe(true);
      expect(state.disabledIds.size).toBe(0);
    });

    it('handles non-array JSON gracefully', async () => {
      await AsyncStorage.setItem(DISABLED_SECTIONS_KEY, JSON.stringify({ foo: 'bar' }));
      await useDisabledSections.getState().initialize();
      const state = useDisabledSections.getState();
      expect(state.isLoaded).toBe(true);
      expect(state.disabledIds.size).toBe(0);
    });

    it('handles empty array', async () => {
      await AsyncStorage.setItem(DISABLED_SECTIONS_KEY, JSON.stringify([]));
      await useDisabledSections.getState().initialize();
      const state = useDisabledSections.getState();
      expect(state.isLoaded).toBe(true);
      expect(state.disabledIds.size).toBe(0);
    });
  });

  // ============================================================
  // DISABLE / ENABLE
  // ============================================================

  describe('disable()', () => {
    it('adds section ID to disabled set', async () => {
      await useDisabledSections.getState().disable('section-1');
      expect(useDisabledSections.getState().disabledIds.has('section-1')).toBe(true);
    });

    it('persists to AsyncStorage', async () => {
      await useDisabledSections.getState().disable('section-1');
      const stored = await AsyncStorage.getItem(DISABLED_SECTIONS_KEY);
      expect(JSON.parse(stored!)).toContain('section-1');
    });

    it('is idempotent — disabling same ID twice does not duplicate', async () => {
      await useDisabledSections.getState().disable('section-1');
      await useDisabledSections.getState().disable('section-1');
      expect(useDisabledSections.getState().disabledIds.size).toBe(1);
    });

    it('preserves existing disabled IDs when adding new one', async () => {
      await useDisabledSections.getState().disable('s1');
      await useDisabledSections.getState().disable('s2');
      const ids = useDisabledSections.getState().disabledIds;
      expect(ids.has('s1')).toBe(true);
      expect(ids.has('s2')).toBe(true);
      expect(ids.size).toBe(2);
    });
  });

  describe('enable()', () => {
    it('removes section ID from disabled set', async () => {
      await useDisabledSections.getState().disable('s1');
      await useDisabledSections.getState().enable('s1');
      expect(useDisabledSections.getState().disabledIds.has('s1')).toBe(false);
    });

    it('persists removal to AsyncStorage', async () => {
      await useDisabledSections.getState().disable('s1');
      await useDisabledSections.getState().enable('s1');
      const stored = await AsyncStorage.getItem(DISABLED_SECTIONS_KEY);
      expect(JSON.parse(stored!)).not.toContain('s1');
    });

    it('is safe to enable an ID that was never disabled', async () => {
      await useDisabledSections.getState().enable('nonexistent');
      expect(useDisabledSections.getState().disabledIds.size).toBe(0);
    });
  });

  // ============================================================
  // SYNCHRONOUS HELPERS
  // ============================================================

  describe('isDisabled()', () => {
    it('returns true for disabled sections', async () => {
      await useDisabledSections.getState().disable('s1');
      expect(useDisabledSections.getState().isDisabled('s1')).toBe(true);
    });

    it('returns false for non-disabled sections', () => {
      expect(useDisabledSections.getState().isDisabled('s1')).toBe(false);
    });
  });

  describe('getAllDisabled()', () => {
    it('returns a copy of disabled IDs', async () => {
      await useDisabledSections.getState().disable('s1');
      await useDisabledSections.getState().disable('s2');
      const result = useDisabledSections.getState().getAllDisabled();
      expect(result.size).toBe(2);
      // Verify it is a copy (mutating it does not affect store)
      result.add('s3');
      expect(useDisabledSections.getState().disabledIds.size).toBe(2);
    });
  });

  // ============================================================
  // CLEAR
  // ============================================================

  describe('clear()', () => {
    it('removes all disabled IDs', async () => {
      await useDisabledSections.getState().disable('s1');
      await useDisabledSections.getState().disable('s2');
      await useDisabledSections.getState().clear();
      expect(useDisabledSections.getState().disabledIds.size).toBe(0);
    });

    it('removes from AsyncStorage', async () => {
      await useDisabledSections.getState().disable('s1');
      await useDisabledSections.getState().clear();
      const stored = await AsyncStorage.getItem(DISABLED_SECTIONS_KEY);
      expect(stored).toBeNull();
    });
  });

  // ============================================================
  // TOP-LEVEL INITIALIZER
  // ============================================================

  describe('initializeDisabledSections()', () => {
    it('calls store initialize', async () => {
      await AsyncStorage.setItem(DISABLED_SECTIONS_KEY, JSON.stringify(['x']));
      await initializeDisabledSections();
      expect(useDisabledSections.getState().isLoaded).toBe(true);
      expect(useDisabledSections.getState().disabledIds.has('x')).toBe(true);
    });
  });
});
