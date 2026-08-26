/**
 * Section Stores Tests
 *
 * Tests for SectionDismissalsStore: dismiss/restore naming and the
 * getSectionDismissals helper.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSectionDismissals } from '@/features/routes/stores/SectionDismissalsStore';

const DISMISSALS_KEY = 'veloq-section-dismissals';

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
