import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  useInsightsStore,
  initializeInsightsStore,
  computeInsightFingerprint,
  diffInsights,
} from '@/providers/InsightsStore';
import type { Insight } from '@/types';

const STORAGE_KEY = 'veloq-insights-fingerprint';

const makeInsight = (id: string, title: string): Insight => ({
  id,
  category: 'section_pr',
  priority: 1,
  title,
  icon: 'trophy',
  iconColor: '#FC4C02',
  timestamp: Date.now(),
  isNew: false,
});

describe('InsightsStore', () => {
  beforeEach(async () => {
    useInsightsStore.setState({
      lastSeenFingerprint: '',
      hasNewInsights: false,
      changedInsightIds: new Set(),
      isLoaded: false,
    });
    await AsyncStorage.clear();
    jest.clearAllMocks();
  });

  describe('initial state', () => {
    it('has correct defaults', () => {
      const state = useInsightsStore.getState();
      expect(state.lastSeenFingerprint).toBe('');
      expect(state.hasNewInsights).toBe(false);
      expect(state.changedInsightIds.size).toBe(0);
      expect(state.isLoaded).toBe(false);
    });
  });

  describe('initialize()', () => {
    it('sets isLoaded when no stored data', async () => {
      await initializeInsightsStore();
      expect(useInsightsStore.getState().isLoaded).toBe(true);
      expect(useInsightsStore.getState().lastSeenFingerprint).toBe('');
    });

    it('restores fingerprint from storage', async () => {
      const fp = 'section_pr-s1:PR on Hill|tsb_form-position:Form: 5';
      await AsyncStorage.setItem(STORAGE_KEY, fp);
      await initializeInsightsStore();
      expect(useInsightsStore.getState().lastSeenFingerprint).toBe(fp);
      expect(useInsightsStore.getState().isLoaded).toBe(true);
    });

    it('handles corrupt data gracefully', async () => {
      await AsyncStorage.setItem(STORAGE_KEY, '');
      await initializeInsightsStore();
      expect(useInsightsStore.getState().isLoaded).toBe(true);
      expect(useInsightsStore.getState().lastSeenFingerprint).toBe('');
    });
  });

  describe('markSeen()', () => {
    it('stores fingerprint and clears hasNewInsights', () => {
      useInsightsStore.setState({ hasNewInsights: true, changedInsightIds: new Set(['a']) });
      const insights = [makeInsight('a', 'Title A'), makeInsight('b', 'Title B')];
      useInsightsStore.getState().markSeen(insights);
      const state = useInsightsStore.getState();
      expect(state.lastSeenFingerprint).toBe(computeInsightFingerprint(insights));
      expect(state.hasNewInsights).toBe(false);
      expect(state.changedInsightIds.size).toBe(0);
    });

    it('persists fingerprint to AsyncStorage', async () => {
      const insights = [makeInsight('a', 'Title A')];
      useInsightsStore.getState().markSeen(insights);
      await new Promise((r) => setTimeout(r, 10));
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      expect(stored).toBe(computeInsightFingerprint(insights));
    });
  });

  describe('setNewInsights()', () => {
    it('sets hasNewInsights true when changed IDs present', () => {
      useInsightsStore.getState().setNewInsights(new Set(['a']));
      expect(useInsightsStore.getState().hasNewInsights).toBe(true);
      expect(useInsightsStore.getState().changedInsightIds.size).toBe(1);
    });

    it('sets hasNewInsights false when no changed IDs', () => {
      useInsightsStore.setState({ hasNewInsights: true });
      useInsightsStore.getState().setNewInsights(new Set());
      expect(useInsightsStore.getState().hasNewInsights).toBe(false);
    });
  });

  describe('idempotency', () => {
    it('initialize is idempotent', async () => {
      const fp = 'test:fingerprint';
      await AsyncStorage.setItem(STORAGE_KEY, fp);
      await initializeInsightsStore();
      useInsightsStore.getState().setNewInsights(new Set(['x']));
      expect(useInsightsStore.getState().hasNewInsights).toBe(true);
      await initializeInsightsStore();
      expect(useInsightsStore.getState().isLoaded).toBe(true);
      expect(useInsightsStore.getState().lastSeenFingerprint).toBe(fp);
    });
  });
});

describe('computeInsightFingerprint', () => {
  it('returns empty string for empty array', () => {
    expect(computeInsightFingerprint([])).toBe('');
  });

  it('produces deterministic fingerprint regardless of input order', () => {
    const a = makeInsight('a', 'Title A');
    const b = makeInsight('b', 'Title B');
    expect(computeInsightFingerprint([a, b])).toBe(computeInsightFingerprint([b, a]));
  });

  it('changes when title changes', () => {
    const v1 = [makeInsight('a', 'Old Title')];
    const v2 = [makeInsight('a', 'New Title')];
    expect(computeInsightFingerprint(v1)).not.toBe(computeInsightFingerprint(v2));
  });

  it('changes when insight added', () => {
    const v1 = [makeInsight('a', 'Title A')];
    const v2 = [makeInsight('a', 'Title A'), makeInsight('b', 'Title B')];
    expect(computeInsightFingerprint(v1)).not.toBe(computeInsightFingerprint(v2));
  });
});

describe('diffInsights', () => {
  it('returns all IDs when previous fingerprint is empty', () => {
    const insights = [makeInsight('a', 'A'), makeInsight('b', 'B')];
    const changed = diffInsights(insights, '');
    expect(changed.size).toBe(2);
    expect(changed.has('a')).toBe(true);
    expect(changed.has('b')).toBe(true);
  });

  it('returns empty set when fingerprints match', () => {
    const insights = [makeInsight('a', 'A'), makeInsight('b', 'B')];
    const fp = computeInsightFingerprint(insights);
    const changed = diffInsights(insights, fp);
    expect(changed.size).toBe(0);
  });

  it('detects new insight added', () => {
    const original = [makeInsight('a', 'A')];
    const fp = computeInsightFingerprint(original);
    const updated = [makeInsight('a', 'A'), makeInsight('b', 'B')];
    const changed = diffInsights(updated, fp);
    expect(changed.size).toBe(1);
    expect(changed.has('b')).toBe(true);
  });

  it('detects title change as new', () => {
    const original = [makeInsight('a', 'Old')];
    const fp = computeInsightFingerprint(original);
    const updated = [makeInsight('a', 'New')];
    const changed = diffInsights(updated, fp);
    expect(changed.size).toBe(1);
    expect(changed.has('a')).toBe(true);
  });
});
