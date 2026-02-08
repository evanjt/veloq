/**
 * PotentialSectionsStore Tests
 *
 * Focus: Storage for detected but not yet confirmed sections
 * - Initialize with schema validation (type guard)
 * - setPotentials persists with timestamp
 * - clear removes all
 * - Corrupt data recovery
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  usePotentialSections,
  getPotentialSections,
  initializePotentialSections,
} from '@/providers/PotentialSectionsStore';

const POTENTIAL_SECTIONS_KEY = 'veloq-potential-sections';

// Minimal valid PotentialSection shape for testing
function makePotentialSection(id: string) {
  return {
    id,
    sportType: 'Ride',
    polyline: [
      [0, 0],
      [1, 1],
    ],
    activityIds: ['a1', 'a2'],
    visitCount: 5,
    distanceMeters: 1500,
    confidence: 0.85,
    scale: 'medium',
  };
}

describe('PotentialSectionsStore', () => {
  beforeEach(async () => {
    usePotentialSections.setState({
      potentials: [],
      isLoaded: false,
      lastDetection: null,
    });
    await AsyncStorage.clear();
    jest.clearAllMocks();
  });

  // ============================================================
  // INITIALIZATION
  // ============================================================

  describe('initialize()', () => {
    it('sets isLoaded when no stored data', async () => {
      await usePotentialSections.getState().initialize();
      expect(usePotentialSections.getState().isLoaded).toBe(true);
      expect(usePotentialSections.getState().potentials).toEqual([]);
    });

    it('restores valid potentials from storage', async () => {
      const potentials = [makePotentialSection('p1'), makePotentialSection('p2')];
      await AsyncStorage.setItem(POTENTIAL_SECTIONS_KEY, JSON.stringify(potentials));
      await usePotentialSections.getState().initialize();
      expect(usePotentialSections.getState().potentials).toHaveLength(2);
      expect(usePotentialSections.getState().potentials[0].id).toBe('p1');
    });

    it('handles corrupt JSON', async () => {
      await AsyncStorage.setItem(POTENTIAL_SECTIONS_KEY, '{broken');
      await usePotentialSections.getState().initialize();
      expect(usePotentialSections.getState().isLoaded).toBe(true);
      expect(usePotentialSections.getState().potentials).toEqual([]);
    });

    it('handles non-array JSON', async () => {
      await AsyncStorage.setItem(POTENTIAL_SECTIONS_KEY, JSON.stringify({ notAnArray: true }));
      await usePotentialSections.getState().initialize();
      expect(usePotentialSections.getState().isLoaded).toBe(true);
      expect(usePotentialSections.getState().potentials).toEqual([]);
    });

    it('handles array with invalid schema objects', async () => {
      await AsyncStorage.setItem(
        POTENTIAL_SECTIONS_KEY,
        JSON.stringify([{ id: 'p1' }]) // Missing required fields
      );
      await usePotentialSections.getState().initialize();
      // Type guard checks first element — invalid means rejected
      expect(usePotentialSections.getState().isLoaded).toBe(true);
      expect(usePotentialSections.getState().potentials).toEqual([]);
    });

    it('accepts empty array', async () => {
      await AsyncStorage.setItem(POTENTIAL_SECTIONS_KEY, JSON.stringify([]));
      await usePotentialSections.getState().initialize();
      expect(usePotentialSections.getState().isLoaded).toBe(true);
      expect(usePotentialSections.getState().potentials).toEqual([]);
    });
  });

  // ============================================================
  // SET POTENTIALS
  // ============================================================

  describe('setPotentials()', () => {
    it('stores potentials in state', async () => {
      const potentials = [makePotentialSection('p1')];
      await usePotentialSections.getState().setPotentials(potentials as any);
      expect(usePotentialSections.getState().potentials).toHaveLength(1);
    });

    it('sets lastDetection timestamp', async () => {
      const before = Date.now();
      await usePotentialSections.getState().setPotentials([makePotentialSection('p1')] as any);
      const after = Date.now();
      const ts = usePotentialSections.getState().lastDetection!;
      expect(ts).toBeGreaterThanOrEqual(before);
      expect(ts).toBeLessThanOrEqual(after);
    });

    it('persists to AsyncStorage', async () => {
      await usePotentialSections.getState().setPotentials([makePotentialSection('p1')] as any);
      const stored = await AsyncStorage.getItem(POTENTIAL_SECTIONS_KEY);
      expect(stored).toBeTruthy();
      const parsed = JSON.parse(stored!);
      expect(parsed.potentials).toHaveLength(1);
    });

    it('replaces existing potentials', async () => {
      await usePotentialSections.getState().setPotentials([makePotentialSection('p1')] as any);
      await usePotentialSections.getState().setPotentials([makePotentialSection('p2')] as any);
      expect(usePotentialSections.getState().potentials).toHaveLength(1);
      expect(usePotentialSections.getState().potentials[0].id).toBe('p2');
    });
  });

  // ============================================================
  // CLEAR
  // ============================================================

  describe('clear()', () => {
    it('removes all potentials', async () => {
      await usePotentialSections.getState().setPotentials([makePotentialSection('p1')] as any);
      await usePotentialSections.getState().clear();
      expect(usePotentialSections.getState().potentials).toEqual([]);
      expect(usePotentialSections.getState().lastDetection).toBeNull();
    });

    it('removes from storage', async () => {
      await usePotentialSections.getState().setPotentials([makePotentialSection('p1')] as any);
      await usePotentialSections.getState().clear();
      expect(await AsyncStorage.getItem(POTENTIAL_SECTIONS_KEY)).toBeNull();
    });
  });

  // ============================================================
  // SYNCHRONOUS HELPERS
  // ============================================================

  describe('getPotentialSections()', () => {
    it('returns current potentials array', async () => {
      await usePotentialSections.getState().setPotentials([makePotentialSection('p1')] as any);
      const result = getPotentialSections();
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('p1');
    });

    it('returns empty array initially', () => {
      expect(getPotentialSections()).toEqual([]);
    });
  });

  describe('initializePotentialSections()', () => {
    it('delegates to store initialize', async () => {
      await initializePotentialSections();
      expect(usePotentialSections.getState().isLoaded).toBe(true);
    });
  });
});
