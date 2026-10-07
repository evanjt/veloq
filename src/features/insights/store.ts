import { create } from 'zustand';

import type { Insight } from './types';
import { insightPairKeys } from './lib/sectionIdentity';
import { readInsightFingerprint, writeInsightFingerprint } from './lib/fingerprintStore';

/**
 * One insight's entry in the fingerprint. A card that covers several sections
 * carries a constant id, so its entry also names the exact section and sport
 * pairs it covers, sorted so member order does not matter. Pair keys are
 * percent-encoded, so neither the `|` between entries nor the `#` and `,`
 * inside one can occur within a key.
 */
function fingerprintEntry(insight: Insight): string {
  const pairs = insight.supportingData?.sections;
  if (!pairs || pairs.length < 2) return insight.id;
  const keys = insightPairKeys(insight).sort();
  return `${insight.id}#${keys.join(',')}`;
}

/** Compute a stable fingerprint from a list of insights (sorted entries only).
 *  Titles contain dynamic values (percentages, watts) that change between
 *  sessions - using them caused the "new" dot to fire on every app launch. */
export function computeInsightFingerprint(insights: Insight[]): string {
  return insights.map(fingerprintEntry).sort().join('|');
}

/** Diff current insights against a stored fingerprint. Returns IDs of genuinely new insights. */
export function diffInsights(current: Insight[], previousFingerprint: string): Set<string> {
  if (!previousFingerprint) {
    return new Set(current.map((i) => i.id));
  }
  const prevEntries = new Set(previousFingerprint.split('|'));
  const changed = new Set<string>();
  for (const insight of current) {
    if (!prevEntries.has(fingerprintEntry(insight))) {
      changed.add(insight.id);
    }
  }
  return changed;
}

interface InsightsState {
  lastSeenFingerprint: string;
  hasNewInsights: boolean;
  isLoaded: boolean;
  initialize: () => Promise<void>;
  markSeen: (insights: Insight[]) => void;
  setNewInsights: (hasNew: boolean) => void;
  reset: () => void;
}

export const useInsightsStore = create<InsightsState>((set) => ({
  lastSeenFingerprint: '',
  hasNewInsights: false,
  isLoaded: false,

  initialize: async () => {
    try {
      const stored = await readInsightFingerprint();
      if (stored) {
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
    set({ lastSeenFingerprint: fingerprint, hasNewInsights: false });
    writeInsightFingerprint(fingerprint).catch(() => {});
  },

  setNewInsights: (hasNew: boolean) => {
    set({ hasNewInsights: hasNew });
  },

  reset: () => set({ lastSeenFingerprint: '', hasNewInsights: false }),
}));

export async function initializeInsightsStore(): Promise<void> {
  await useInsightsStore.getState().initialize();
}
