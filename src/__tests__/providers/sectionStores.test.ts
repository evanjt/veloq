/**
 * Section Stores Tests
 *
 * Tests for 2 section-related Zustand stores:
 * - SectionDismissalsStore (unique: dismiss/restore naming, getSectionDismissals helper)
 * - PotentialSectionsStore (unique: array storage with schema validation, timestamps)
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSectionDismissals } from '@/features/routes/stores/SectionDismissalsStore';
import { usePotentialSections } from '@/features/routes/stores/PotentialSectionsStore';

const DISMISSALS_KEY = 'veloq-section-dismissals';
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
// SectionDismissalsStore - Unique behaviors only
// ================================================================

describe('SectionDismissalsStore', () => {
  beforeEach(async () => {
    useSectionDismissals.setState({ dismissedIds: new Set(), isLoaded: false });
    await AsyncStorage.clear();
    jest.clearAllMocks();
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

  it('isDismissed returns correct state', async () => {
    await useSectionDismissals.getState().dismiss('s1');
    expect(useSectionDismissals.getState().isDismissed('s1')).toBe(true);
    expect(useSectionDismissals.getState().isDismissed('s2')).toBe(false);
  });

  it('clear removes all and from storage', async () => {
    await useSectionDismissals.getState().dismiss('s1');
    await useSectionDismissals.getState().clear();
    expect(useSectionDismissals.getState().dismissedIds.size).toBe(0);
    expect(await AsyncStorage.getItem(DISMISSALS_KEY)).toBeNull();
  });
});

// ================================================================
// PotentialSectionsStore - Unique: array storage, schema validation, timestamps
// ================================================================

describe('PotentialSectionsStore', () => {
  beforeEach(async () => {
    usePotentialSections.setState({ potentials: [], isLoaded: false, lastDetection: null });
    await AsyncStorage.clear();
    jest.clearAllMocks();
  });

  it('rejects invalid schema objects', async () => {
    await AsyncStorage.setItem(POTENTIAL_SECTIONS_KEY, JSON.stringify([{ id: 'p1' }]));
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

  it('clear removes all and from storage', async () => {
    await usePotentialSections.getState().setPotentials([makePotentialSection('p1')] as any);
    await usePotentialSections.getState().clear();
    expect(usePotentialSections.getState().potentials).toEqual([]);
    expect(usePotentialSections.getState().lastDetection).toBeNull();
    expect(await AsyncStorage.getItem(POTENTIAL_SECTIONS_KEY)).toBeNull();
  });
});
