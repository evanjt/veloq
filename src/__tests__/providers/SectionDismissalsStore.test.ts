/**
 * SectionDismissalsStore Tests
 *
 * Focus: Permanent dismissal of section suggestions
 * - Initialize from AsyncStorage
 * - Dismiss/restore with persistence
 * - Synchronous isDismissed helper
 * - Clear all dismissals
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  useSectionDismissals,
  getSectionDismissals,
  initializeSectionDismissals,
} from '@/providers/SectionDismissalsStore';

const DISMISSALS_KEY = 'veloq-section-dismissals';

describe('SectionDismissalsStore', () => {
  beforeEach(async () => {
    useSectionDismissals.setState({
      dismissedIds: new Set(),
      isLoaded: false,
    });
    await AsyncStorage.clear();
    jest.clearAllMocks();
  });

  // ============================================================
  // INITIALIZATION
  // ============================================================

  describe('initialize()', () => {
    it('sets isLoaded when no stored data', async () => {
      await useSectionDismissals.getState().initialize();
      expect(useSectionDismissals.getState().isLoaded).toBe(true);
      expect(useSectionDismissals.getState().dismissedIds.size).toBe(0);
    });

    it('restores dismissed IDs from storage', async () => {
      await AsyncStorage.setItem(DISMISSALS_KEY, JSON.stringify(['d1', 'd2']));
      await useSectionDismissals.getState().initialize();
      const state = useSectionDismissals.getState();
      expect(state.dismissedIds.size).toBe(2);
      expect(state.dismissedIds.has('d1')).toBe(true);
      expect(state.dismissedIds.has('d2')).toBe(true);
    });

    it('handles corrupt JSON', async () => {
      await AsyncStorage.setItem(DISMISSALS_KEY, '{broken');
      await useSectionDismissals.getState().initialize();
      expect(useSectionDismissals.getState().isLoaded).toBe(true);
      expect(useSectionDismissals.getState().dismissedIds.size).toBe(0);
    });

    it('handles non-array data', async () => {
      await AsyncStorage.setItem(DISMISSALS_KEY, JSON.stringify(42));
      await useSectionDismissals.getState().initialize();
      expect(useSectionDismissals.getState().isLoaded).toBe(true);
      expect(useSectionDismissals.getState().dismissedIds.size).toBe(0);
    });
  });

  // ============================================================
  // DISMISS / RESTORE
  // ============================================================

  describe('dismiss()', () => {
    it('adds ID to dismissed set', async () => {
      await useSectionDismissals.getState().dismiss('s1');
      expect(useSectionDismissals.getState().dismissedIds.has('s1')).toBe(true);
    });

    it('persists to AsyncStorage', async () => {
      await useSectionDismissals.getState().dismiss('s1');
      const stored = JSON.parse((await AsyncStorage.getItem(DISMISSALS_KEY))!);
      expect(stored).toContain('s1');
    });

    it('is idempotent', async () => {
      await useSectionDismissals.getState().dismiss('s1');
      await useSectionDismissals.getState().dismiss('s1');
      expect(useSectionDismissals.getState().dismissedIds.size).toBe(1);
    });
  });

  describe('restore()', () => {
    it('removes ID from dismissed set', async () => {
      await useSectionDismissals.getState().dismiss('s1');
      await useSectionDismissals.getState().restore('s1');
      expect(useSectionDismissals.getState().dismissedIds.has('s1')).toBe(false);
    });

    it('persists removal', async () => {
      await useSectionDismissals.getState().dismiss('s1');
      await useSectionDismissals.getState().dismiss('s2');
      await useSectionDismissals.getState().restore('s1');
      const stored = JSON.parse((await AsyncStorage.getItem(DISMISSALS_KEY))!);
      expect(stored).not.toContain('s1');
      expect(stored).toContain('s2');
    });

    it('is safe on non-existent ID', async () => {
      await useSectionDismissals.getState().restore('nonexistent');
      expect(useSectionDismissals.getState().dismissedIds.size).toBe(0);
    });
  });

  // ============================================================
  // SYNCHRONOUS HELPERS
  // ============================================================

  describe('isDismissed()', () => {
    it('returns true for dismissed', async () => {
      await useSectionDismissals.getState().dismiss('s1');
      expect(useSectionDismissals.getState().isDismissed('s1')).toBe(true);
    });

    it('returns false for non-dismissed', () => {
      expect(useSectionDismissals.getState().isDismissed('s1')).toBe(false);
    });
  });

  describe('getSectionDismissals()', () => {
    it('returns current dismissed set', async () => {
      await useSectionDismissals.getState().dismiss('s1');
      const result = getSectionDismissals();
      expect(result.has('s1')).toBe(true);
    });
  });

  // ============================================================
  // CLEAR
  // ============================================================

  describe('clear()', () => {
    it('removes all dismissals', async () => {
      await useSectionDismissals.getState().dismiss('s1');
      await useSectionDismissals.getState().dismiss('s2');
      await useSectionDismissals.getState().clear();
      expect(useSectionDismissals.getState().dismissedIds.size).toBe(0);
    });

    it('removes from storage', async () => {
      await useSectionDismissals.getState().dismiss('s1');
      await useSectionDismissals.getState().clear();
      expect(await AsyncStorage.getItem(DISMISSALS_KEY)).toBeNull();
    });
  });

  describe('initializeSectionDismissals()', () => {
    it('delegates to store initialize', async () => {
      await initializeSectionDismissals();
      expect(useSectionDismissals.getState().isLoaded).toBe(true);
    });
  });
});
