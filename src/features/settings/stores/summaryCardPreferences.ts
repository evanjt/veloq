/** Store for the home summary card: its hero metric, sparkline and supporting metrics. */
import { create } from 'zustand';
import { getSetting, setSetting } from '@/shared/storage';

const SUMMARY_CARD_STORAGE_KEY = 'dashboard_summary_card';

// Available metric types
export type MetricId =
  | 'hrv'
  | 'rhr'
  | 'weekHours'
  | 'weekCount'
  | 'ftp'
  | 'thresholdPace'
  | 'css'
  | 'fitness'
  | 'form'
  | 'weight';

// Metric definition with display info
export interface MetricDefinition {
  id: MetricId;
  labelKey: string; // i18n key
  sportSpecific?: 'Cycling' | 'Running' | 'Swimming'; // Only show for this sport
  color?: string; // Optional accent color
}

// All available metrics
export const AVAILABLE_METRICS: MetricDefinition[] = [
  { id: 'hrv', labelKey: 'metrics.hrv' },
  { id: 'rhr', labelKey: 'metrics.rhr' },
  { id: 'weekHours', labelKey: 'metrics.week' },
  { id: 'weekCount', labelKey: 'metrics.activityCount' },
  { id: 'ftp', labelKey: 'metrics.ftp', sportSpecific: 'Cycling' },
  { id: 'thresholdPace', labelKey: 'metrics.pace', sportSpecific: 'Running' },
  { id: 'css', labelKey: 'metrics.css', sportSpecific: 'Swimming' },
  { id: 'fitness', labelKey: 'metrics.fitness' },
  { id: 'form', labelKey: 'metrics.form' },
  { id: 'weight', labelKey: 'metrics.weight' },
];

/**
 * The metrics the card can draw as its hero, each with its own sparkline. The
 * picker offers these and nothing else, so a stored hero outside them is a
 * value no code path writes and is rewritten on load.
 */
export const HERO_METRICS = ['fitness', 'hrv'] as const satisfies readonly MetricId[];

export type HeroMetricId = (typeof HERO_METRICS)[number];

export function isHeroMetricId(value: unknown): value is HeroMetricId {
  return (HERO_METRICS as readonly unknown[]).includes(value);
}

// Summary card preferences
export interface SummaryCardPreferences {
  enabled: boolean;
  heroMetric: HeroMetricId;
  showSparkline: boolean;
  supportingMetrics: MetricId[];
}

const DEFAULT_SUMMARY_CARD: SummaryCardPreferences = {
  enabled: true,
  heroMetric: 'fitness',
  showSparkline: true,
  supportingMetrics: ['fitness', 'ftp', 'weekHours', 'weight'],
};

interface DashboardPreferencesState {
  summaryCard: SummaryCardPreferences;
  isInitialized: boolean;

  // Actions
  setSummaryCardPreferences: (prefs: Partial<SummaryCardPreferences>) => void;
}

export const useDashboardPreferences = create<DashboardPreferencesState>((set) => ({
  summaryCard: DEFAULT_SUMMARY_CARD,
  isInitialized: false,

  setSummaryCardPreferences: (prefs) => {
    set((state) => {
      const newSummaryCard = { ...state.summaryCard, ...prefs };
      // Persist
      persistSummaryCard(newSummaryCard);
      return { summaryCard: newSummaryCard };
    });
  },
}));

const METRIC_IDS = new Set<string>(AVAILABLE_METRICS.map((m) => m.id));

function isMetricId(value: unknown): value is MetricId {
  return typeof value === 'string' && METRIC_IDS.has(value);
}

/** A stored card as read, before its hero is held to the ones the card draws. */
type StoredSummaryCard = Omit<SummaryCardPreferences, 'heroMetric'> & { heroMetric: MetricId };

function parseStoredSummaryCard(raw: string): StoredSummaryCard | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const merged: StoredSummaryCard = {
    ...DEFAULT_SUMMARY_CARD,
    ...(parsed as Partial<StoredSummaryCard>),
  };
  if (typeof merged.enabled !== 'boolean' || typeof merged.showSparkline !== 'boolean') {
    return null;
  }
  if (!isMetricId(merged.heroMetric)) {
    return null;
  }
  if (!Array.isArray(merged.supportingMetrics) || !merged.supportingMetrics.every(isMetricId)) {
    return null;
  }
  return merged;
}

// Persistence helpers
async function persistSummaryCard(summaryCard: SummaryCardPreferences): Promise<void> {
  try {
    await setSetting(SUMMARY_CARD_STORAGE_KEY, JSON.stringify(summaryCard));
  } catch (error) {
    if (__DEV__) {
      console.warn('[DashboardPreferences] Failed to persist summary card:', error);
    }
  }
}

export async function initializeDashboardPreferences(): Promise<void> {
  try {
    const storedSummaryCard = await getSetting(SUMMARY_CARD_STORAGE_KEY);

    const stored = storedSummaryCard ? parseStoredSummaryCard(storedSummaryCard) : null;
    let summaryCard: SummaryCardPreferences = DEFAULT_SUMMARY_CARD;
    if (stored) {
      const { heroMetric, ...rest } = stored;
      if (isHeroMetricId(heroMetric)) {
        summaryCard = { ...rest, heroMetric };
      } else {
        // Form was a hero once and is drawn in the fitness sparkline now. No
        // picker ever offered the others, so whichever it is, it becomes
        // fitness rather than three readers each guessing.
        summaryCard = { ...rest, heroMetric: 'fitness' };
        persistSummaryCard(summaryCard);
      }
    }

    useDashboardPreferences.setState({
      summaryCard,
      isInitialized: true,
    });
  } catch (error) {
    if (__DEV__) {
      console.warn('[DashboardPreferences] Failed to initialize:', error);
    }
    useDashboardPreferences.setState({
      summaryCard: DEFAULT_SUMMARY_CARD,
      isInitialized: true,
    });
  }
}

// Helper to get metric definition by ID
export function getMetricDefinition(id: MetricId): MetricDefinition | undefined {
  return AVAILABLE_METRICS.find((m) => m.id === id);
}
