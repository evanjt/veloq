/**
 * SupersededSectionsStore Tests
 *
 * Focus: Tracking which auto-sections are replaced by custom sections
 * - Record-based storage (customId -> autoId[])
 * - isSuperseded checks across all custom sections
 * - getAllSuperseded aggregation
 * - Remove when custom section deleted
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  useSupersededSections,
  initializeSupersededSections,
} from '@/providers/SupersededSectionsStore';

const SUPERSEDED_SECTIONS_KEY = 'veloq-superseded-sections';

describe('SupersededSectionsStore', () => {
  beforeEach(async () => {
    useSupersededSections.setState({
      supersededBy: {},
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
      await useSupersededSections.getState().initialize();
      expect(useSupersededSections.getState().isLoaded).toBe(true);
      expect(useSupersededSections.getState().supersededBy).toEqual({});
    });

    it('restores superseded map from storage', async () => {
      const data = { 'custom-1': ['auto-1', 'auto-2'], 'custom-2': ['auto-3'] };
      await AsyncStorage.setItem(SUPERSEDED_SECTIONS_KEY, JSON.stringify(data));
      await useSupersededSections.getState().initialize();
      expect(useSupersededSections.getState().supersededBy).toEqual(data);
    });

    it('handles corrupt JSON', async () => {
      await AsyncStorage.setItem(SUPERSEDED_SECTIONS_KEY, 'broken');
      await useSupersededSections.getState().initialize();
      expect(useSupersededSections.getState().isLoaded).toBe(true);
      expect(useSupersededSections.getState().supersededBy).toEqual({});
    });

    it('handles null stored value (non-object)', async () => {
      await AsyncStorage.setItem(SUPERSEDED_SECTIONS_KEY, JSON.stringify(null));
      await useSupersededSections.getState().initialize();
      expect(useSupersededSections.getState().isLoaded).toBe(true);
    });
  });

  // ============================================================
  // SET SUPERSEDED
  // ============================================================

  describe('setSuperseded()', () => {
    it('records which auto sections a custom section supersedes', async () => {
      await useSupersededSections.getState().setSuperseded('custom-1', ['auto-1', 'auto-2']);
      expect(useSupersededSections.getState().supersededBy['custom-1']).toEqual([
        'auto-1',
        'auto-2',
      ]);
    });

    it('persists to storage', async () => {
      await useSupersededSections.getState().setSuperseded('custom-1', ['auto-1']);
      const stored = JSON.parse((await AsyncStorage.getItem(SUPERSEDED_SECTIONS_KEY))!);
      expect(stored['custom-1']).toEqual(['auto-1']);
    });

    it('replaces entries for same custom section', async () => {
      await useSupersededSections.getState().setSuperseded('custom-1', ['auto-1']);
      await useSupersededSections.getState().setSuperseded('custom-1', ['auto-2', 'auto-3']);
      expect(useSupersededSections.getState().supersededBy['custom-1']).toEqual([
        'auto-2',
        'auto-3',
      ]);
    });

    it('multiple custom sections tracked independently', async () => {
      await useSupersededSections.getState().setSuperseded('custom-1', ['auto-1']);
      await useSupersededSections.getState().setSuperseded('custom-2', ['auto-2']);
      const state = useSupersededSections.getState().supersededBy;
      expect(state['custom-1']).toEqual(['auto-1']);
      expect(state['custom-2']).toEqual(['auto-2']);
    });
  });

  // ============================================================
  // REMOVE SUPERSEDED
  // ============================================================

  describe('removeSuperseded()', () => {
    it('removes entries for a deleted custom section', async () => {
      await useSupersededSections.getState().setSuperseded('custom-1', ['auto-1']);
      await useSupersededSections.getState().setSuperseded('custom-2', ['auto-2']);
      await useSupersededSections.getState().removeSuperseded('custom-1');
      expect(useSupersededSections.getState().supersededBy['custom-1']).toBeUndefined();
      expect(useSupersededSections.getState().supersededBy['custom-2']).toEqual(['auto-2']);
    });

    it('persists removal', async () => {
      await useSupersededSections.getState().setSuperseded('custom-1', ['auto-1']);
      await useSupersededSections.getState().removeSuperseded('custom-1');
      const stored = JSON.parse((await AsyncStorage.getItem(SUPERSEDED_SECTIONS_KEY))!);
      expect(stored['custom-1']).toBeUndefined();
    });

    it('is safe for non-existent custom section', async () => {
      await useSupersededSections.getState().removeSuperseded('nonexistent');
      expect(useSupersededSections.getState().supersededBy).toEqual({});
    });
  });

  // ============================================================
  // QUERY HELPERS
  // ============================================================

  describe('isSuperseded()', () => {
    it('returns true for superseded auto section', async () => {
      await useSupersededSections.getState().setSuperseded('custom-1', ['auto-1', 'auto-2']);
      expect(useSupersededSections.getState().isSuperseded('auto-1')).toBe(true);
      expect(useSupersededSections.getState().isSuperseded('auto-2')).toBe(true);
    });

    it('returns false for non-superseded section', async () => {
      await useSupersededSections.getState().setSuperseded('custom-1', ['auto-1']);
      expect(useSupersededSections.getState().isSuperseded('auto-99')).toBe(false);
    });

    it('searches across all custom sections', async () => {
      await useSupersededSections.getState().setSuperseded('custom-1', ['auto-1']);
      await useSupersededSections.getState().setSuperseded('custom-2', ['auto-2']);
      expect(useSupersededSections.getState().isSuperseded('auto-2')).toBe(true);
    });
  });

  describe('getAllSuperseded()', () => {
    it('returns empty set when no superseded sections', () => {
      expect(useSupersededSections.getState().getAllSuperseded().size).toBe(0);
    });

    it('aggregates all superseded auto section IDs', async () => {
      await useSupersededSections.getState().setSuperseded('c1', ['a1', 'a2']);
      await useSupersededSections.getState().setSuperseded('c2', ['a3']);
      const all = useSupersededSections.getState().getAllSuperseded();
      expect(all.size).toBe(3);
      expect(all.has('a1')).toBe(true);
      expect(all.has('a2')).toBe(true);
      expect(all.has('a3')).toBe(true);
    });

    it('deduplicates IDs appearing in multiple custom sections', async () => {
      await useSupersededSections.getState().setSuperseded('c1', ['a1', 'a2']);
      await useSupersededSections.getState().setSuperseded('c2', ['a2', 'a3']);
      const all = useSupersededSections.getState().getAllSuperseded();
      expect(all.size).toBe(3); // a2 not duplicated
    });
  });

  // ============================================================
  // CLEAR
  // ============================================================

  describe('clear()', () => {
    it('removes all superseded data', async () => {
      await useSupersededSections.getState().setSuperseded('c1', ['a1']);
      await useSupersededSections.getState().clear();
      expect(useSupersededSections.getState().supersededBy).toEqual({});
    });

    it('removes from storage', async () => {
      await useSupersededSections.getState().setSuperseded('c1', ['a1']);
      await useSupersededSections.getState().clear();
      expect(await AsyncStorage.getItem(SUPERSEDED_SECTIONS_KEY)).toBeNull();
    });
  });

  describe('initializeSupersededSections()', () => {
    it('delegates to store initialize', async () => {
      await initializeSupersededSections();
      expect(useSupersededSections.getState().isLoaded).toBe(true);
    });
  });
});
