/**
 * Section Stores Tests
 *
 * Tests for 4 section-related Zustand stores:
 * - DisabledSectionsStore (full suite as representative for Set-based stores)
 * - SectionDismissalsStore (unique: dismiss/restore naming, getSectionDismissals helper)
 * - SupersededSectionsStore (unique: record-based storage, cross-section queries)
 * - PotentialSectionsStore (unique: array storage with schema validation, timestamps)
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useDisabledSections, initializeDisabledSections } from '@/providers/DisabledSectionsStore';
import {
  useSectionDismissals,
  getSectionDismissals,
  initializeSectionDismissals,
} from '@/providers/SectionDismissalsStore';
import {
  useSupersededSections,
  initializeSupersededSections,
} from '@/providers/SupersededSectionsStore';
import {
  usePotentialSections,
  getPotentialSections,
  initializePotentialSections,
} from '@/providers/PotentialSectionsStore';

const DISABLED_SECTIONS_KEY = 'veloq-disabled-sections';
const DISMISSALS_KEY = 'veloq-section-dismissals';
const SUPERSEDED_SECTIONS_KEY = 'veloq-superseded-sections';
const POTENTIAL_SECTIONS_KEY = 'veloq-potential-sections';

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

// ================================================================
// DisabledSectionsStore — Full Suite (Representative for Set-based stores)
// ================================================================

describe('DisabledSectionsStore', () => {
  beforeEach(async () => {
    useDisabledSections.setState({ disabledIds: new Set(), isLoaded: false });
    await AsyncStorage.clear();
    jest.clearAllMocks();
  });

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
      expect(useDisabledSections.getState().isLoaded).toBe(true);
      expect(useDisabledSections.getState().disabledIds.size).toBe(0);
    });

    it('handles non-array JSON gracefully', async () => {
      await AsyncStorage.setItem(DISABLED_SECTIONS_KEY, JSON.stringify({ foo: 'bar' }));
      await useDisabledSections.getState().initialize();
      expect(useDisabledSections.getState().isLoaded).toBe(true);
      expect(useDisabledSections.getState().disabledIds.size).toBe(0);
    });

    it('handles empty array', async () => {
      await AsyncStorage.setItem(DISABLED_SECTIONS_KEY, JSON.stringify([]));
      await useDisabledSections.getState().initialize();
      expect(useDisabledSections.getState().isLoaded).toBe(true);
      expect(useDisabledSections.getState().disabledIds.size).toBe(0);
    });
  });

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
      expect(await AsyncStorage.getItem(DISABLED_SECTIONS_KEY)).toBeNull();
    });
  });

  describe('initializeDisabledSections()', () => {
    it('calls store initialize', async () => {
      await AsyncStorage.setItem(DISABLED_SECTIONS_KEY, JSON.stringify(['x']));
      await initializeDisabledSections();
      expect(useDisabledSections.getState().isLoaded).toBe(true);
      expect(useDisabledSections.getState().disabledIds.has('x')).toBe(true);
    });
  });
});

// ================================================================
// SectionDismissalsStore — Unique behaviors only
// ================================================================

describe('SectionDismissalsStore', () => {
  beforeEach(async () => {
    useSectionDismissals.setState({ dismissedIds: new Set(), isLoaded: false });
    await AsyncStorage.clear();
    jest.clearAllMocks();
  });

  it('initializes from storage', async () => {
    await AsyncStorage.setItem(DISMISSALS_KEY, JSON.stringify(['d1', 'd2']));
    await initializeSectionDismissals();
    expect(useSectionDismissals.getState().dismissedIds.size).toBe(2);
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
    expect(useSectionDismissals.getState().dismissedIds.size).toBe(0);
  });

  it('dismiss adds and persists, restore removes and persists', async () => {
    await useSectionDismissals.getState().dismiss('s1');
    await useSectionDismissals.getState().dismiss('s2');
    expect(useSectionDismissals.getState().dismissedIds.size).toBe(2);

    await useSectionDismissals.getState().restore('s1');
    const stored = JSON.parse((await AsyncStorage.getItem(DISMISSALS_KEY))!);
    expect(stored).not.toContain('s1');
    expect(stored).toContain('s2');
  });

  it('restore is safe on non-existent ID', async () => {
    await useSectionDismissals.getState().restore('nonexistent');
    expect(useSectionDismissals.getState().dismissedIds.size).toBe(0);
  });

  it('isDismissed returns correct state', async () => {
    await useSectionDismissals.getState().dismiss('s1');
    expect(useSectionDismissals.getState().isDismissed('s1')).toBe(true);
    expect(useSectionDismissals.getState().isDismissed('s2')).toBe(false);
  });

  it('getSectionDismissals() returns current set', async () => {
    await useSectionDismissals.getState().dismiss('s1');
    expect(getSectionDismissals().has('s1')).toBe(true);
  });

  it('clear removes all and from storage', async () => {
    await useSectionDismissals.getState().dismiss('s1');
    await useSectionDismissals.getState().clear();
    expect(useSectionDismissals.getState().dismissedIds.size).toBe(0);
    expect(await AsyncStorage.getItem(DISMISSALS_KEY)).toBeNull();
  });
});

// ================================================================
// SupersededSectionsStore — Unique: record-based, cross-section queries
// ================================================================

describe('SupersededSectionsStore', () => {
  beforeEach(async () => {
    useSupersededSections.setState({ supersededBy: {}, isLoaded: false });
    await AsyncStorage.clear();
    jest.clearAllMocks();
  });

  it('initializes from storage', async () => {
    const data = { 'custom-1': ['auto-1', 'auto-2'], 'custom-2': ['auto-3'] };
    await AsyncStorage.setItem(SUPERSEDED_SECTIONS_KEY, JSON.stringify(data));
    await initializeSupersededSections();
    expect(useSupersededSections.getState().supersededBy).toEqual(data);
  });

  it('handles corrupt and null JSON', async () => {
    await AsyncStorage.setItem(SUPERSEDED_SECTIONS_KEY, 'broken');
    await useSupersededSections.getState().initialize();
    expect(useSupersededSections.getState().isLoaded).toBe(true);
    expect(useSupersededSections.getState().supersededBy).toEqual({});
  });

  it('setSuperseded records and persists', async () => {
    await useSupersededSections.getState().setSuperseded('custom-1', ['auto-1', 'auto-2']);
    expect(useSupersededSections.getState().supersededBy['custom-1']).toEqual(['auto-1', 'auto-2']);
    const stored = JSON.parse((await AsyncStorage.getItem(SUPERSEDED_SECTIONS_KEY))!);
    expect(stored['custom-1']).toEqual(['auto-1', 'auto-2']);
  });

  it('replaces entries for same custom section', async () => {
    await useSupersededSections.getState().setSuperseded('custom-1', ['auto-1']);
    await useSupersededSections.getState().setSuperseded('custom-1', ['auto-2', 'auto-3']);
    expect(useSupersededSections.getState().supersededBy['custom-1']).toEqual(['auto-2', 'auto-3']);
  });

  it('multiple custom sections tracked independently', async () => {
    await useSupersededSections.getState().setSuperseded('custom-1', ['auto-1']);
    await useSupersededSections.getState().setSuperseded('custom-2', ['auto-2']);
    expect(useSupersededSections.getState().supersededBy['custom-1']).toEqual(['auto-1']);
    expect(useSupersededSections.getState().supersededBy['custom-2']).toEqual(['auto-2']);
  });

  it('removeSuperseded removes entries for a custom section', async () => {
    await useSupersededSections.getState().setSuperseded('custom-1', ['auto-1']);
    await useSupersededSections.getState().setSuperseded('custom-2', ['auto-2']);
    await useSupersededSections.getState().removeSuperseded('custom-1');
    expect(useSupersededSections.getState().supersededBy['custom-1']).toBeUndefined();
    expect(useSupersededSections.getState().supersededBy['custom-2']).toEqual(['auto-2']);
  });

  it('removeSuperseded is safe for non-existent custom section', async () => {
    await useSupersededSections.getState().removeSuperseded('nonexistent');
    expect(useSupersededSections.getState().supersededBy).toEqual({});
  });

  it('isSuperseded searches across all custom sections', async () => {
    await useSupersededSections.getState().setSuperseded('custom-1', ['auto-1']);
    await useSupersededSections.getState().setSuperseded('custom-2', ['auto-2']);
    expect(useSupersededSections.getState().isSuperseded('auto-1')).toBe(true);
    expect(useSupersededSections.getState().isSuperseded('auto-2')).toBe(true);
    expect(useSupersededSections.getState().isSuperseded('auto-99')).toBe(false);
  });

  it('getAllSuperseded aggregates and deduplicates', async () => {
    await useSupersededSections.getState().setSuperseded('c1', ['a1', 'a2']);
    await useSupersededSections.getState().setSuperseded('c2', ['a2', 'a3']);
    const all = useSupersededSections.getState().getAllSuperseded();
    expect(all.size).toBe(3);
    expect(all.has('a1')).toBe(true);
    expect(all.has('a2')).toBe(true);
    expect(all.has('a3')).toBe(true);
  });

  it('clear removes all and from storage', async () => {
    await useSupersededSections.getState().setSuperseded('c1', ['a1']);
    await useSupersededSections.getState().clear();
    expect(useSupersededSections.getState().supersededBy).toEqual({});
    expect(await AsyncStorage.getItem(SUPERSEDED_SECTIONS_KEY)).toBeNull();
  });
});

// ================================================================
// PotentialSectionsStore — Unique: array storage, schema validation, timestamps
// ================================================================

describe('PotentialSectionsStore', () => {
  beforeEach(async () => {
    usePotentialSections.setState({ potentials: [], isLoaded: false, lastDetection: null });
    await AsyncStorage.clear();
    jest.clearAllMocks();
  });

  it('initializes from storage with schema validation', async () => {
    const potentials = [makePotentialSection('p1'), makePotentialSection('p2')];
    await AsyncStorage.setItem(POTENTIAL_SECTIONS_KEY, JSON.stringify(potentials));
    await initializePotentialSections();
    expect(usePotentialSections.getState().potentials).toHaveLength(2);
  });

  it('rejects invalid schema objects', async () => {
    await AsyncStorage.setItem(POTENTIAL_SECTIONS_KEY, JSON.stringify([{ id: 'p1' }]));
    await usePotentialSections.getState().initialize();
    expect(usePotentialSections.getState().potentials).toEqual([]);
  });

  it('handles corrupt JSON and non-array', async () => {
    await AsyncStorage.setItem(POTENTIAL_SECTIONS_KEY, '{broken');
    await usePotentialSections.getState().initialize();
    expect(usePotentialSections.getState().isLoaded).toBe(true);
    expect(usePotentialSections.getState().potentials).toEqual([]);

    await AsyncStorage.setItem(POTENTIAL_SECTIONS_KEY, JSON.stringify({ notAnArray: true }));
    usePotentialSections.setState({ isLoaded: false });
    await usePotentialSections.getState().initialize();
    expect(usePotentialSections.getState().potentials).toEqual([]);
  });

  it('setPotentials stores with timestamp', async () => {
    const before = Date.now();
    await usePotentialSections.getState().setPotentials([makePotentialSection('p1')] as any);
    const after = Date.now();
    expect(usePotentialSections.getState().potentials).toHaveLength(1);
    expect(usePotentialSections.getState().lastDetection!).toBeGreaterThanOrEqual(before);
    expect(usePotentialSections.getState().lastDetection!).toBeLessThanOrEqual(after);
  });

  it('setPotentials replaces existing and persists', async () => {
    await usePotentialSections.getState().setPotentials([makePotentialSection('p1')] as any);
    await usePotentialSections.getState().setPotentials([makePotentialSection('p2')] as any);
    expect(usePotentialSections.getState().potentials).toHaveLength(1);
    expect(usePotentialSections.getState().potentials[0].id).toBe('p2');
    const stored = await AsyncStorage.getItem(POTENTIAL_SECTIONS_KEY);
    expect(stored).toBeTruthy();
  });

  it('getPotentialSections() returns current array', async () => {
    await usePotentialSections.getState().setPotentials([makePotentialSection('p1')] as any);
    expect(getPotentialSections()).toHaveLength(1);
    expect(getPotentialSections()[0].id).toBe('p1');
  });

  it('returns empty array initially', () => {
    expect(getPotentialSections()).toEqual([]);
  });

  it('clear removes all and from storage', async () => {
    await usePotentialSections.getState().setPotentials([makePotentialSection('p1')] as any);
    await usePotentialSections.getState().clear();
    expect(usePotentialSections.getState().potentials).toEqual([]);
    expect(usePotentialSections.getState().lastDetection).toBeNull();
    expect(await AsyncStorage.getItem(POTENTIAL_SECTIONS_KEY)).toBeNull();
  });
});
