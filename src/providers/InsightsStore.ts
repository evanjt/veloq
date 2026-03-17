import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Insight } from '@/types';

const STORAGE_KEY = 'veloq-insights-fingerprint';

/** Compute a stable fingerprint from a list of insights (sorted id:title pairs). */
export function computeInsightFingerprint(insights: Insight[]): string {
  return insights
    .map((i) => `${i.id}:${i.title}`)
    .sort()
    .join('|');
}

/** Diff current insights against a stored fingerprint. Returns IDs of new/changed insights. */
export function diffInsights(current: Insight[], previousFingerprint: string): Set<string> {
  if (!previousFingerprint) {
    return new Set(current.map((i) => i.id));
  }
  const prevPairs = new Set(previousFingerprint.split('|'));
  const changed = new Set<string>();
  for (const insight of current) {
    const pair = `${insight.id}:${insight.title}`;
    if (!prevPairs.has(pair)) {
      changed.add(insight.id);
    }
  }
  return changed;
}

interface InsightsState {
  lastSeenFingerprint: string;
  hasNewInsights: boolean;
  changedInsightIds: Set<string>;
  isLoaded: boolean;
  initialize: () => Promise<void>;
  markSeen: (insights: Insight[]) => void;
  setNewInsights: (changed: Set<string>) => void;
}

export const useInsightsStore = create<InsightsState>((set) => ({
  lastSeenFingerprint: '',
  hasNewInsights: false,
  changedInsightIds: new Set(),
  isLoaded: false,

  initialize: async () => {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (stored && typeof stored === 'string') {
        set({ lastSeenFingerprint: stored, isLoaded: true });
        return;
      }
    } catch {
      // Ignore parse errors
    }
    set({ isLoaded: true });
  },

  markSeen: (insights: Insight[]) => {
    const fingerprint = computeInsightFingerprint(insights);
    set({ lastSeenFingerprint: fingerprint, hasNewInsights: false, changedInsightIds: new Set() });
    AsyncStorage.setItem(STORAGE_KEY, fingerprint).catch(() => {});
  },

  setNewInsights: (changed: Set<string>) => {
    set({ hasNewInsights: changed.size > 0, changedInsightIds: changed });
  },
}));

export async function initializeInsightsStore(): Promise<void> {
  await useInsightsStore.getState().initialize();
}
