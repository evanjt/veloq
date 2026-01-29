/**
 * Store for dashboard pill customization preferences.
 * Users can enable/disable metrics and reorder them.
 */
import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'dashboard_preferences';
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
  | 'form';

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
];

// User's preference for a metric
export interface MetricPreference {
  id: MetricId;
  enabled: boolean;
  order: number;
}

// Summary card preferences
export interface SummaryCardPreferences {
  heroMetric: MetricId;
  showSparkline: boolean;
  supportingMetrics: MetricId[];
}

const DEFAULT_SUMMARY_CARD: SummaryCardPreferences = {
  heroMetric: 'form',
  showSparkline: true,
  supportingMetrics: ['fitness', 'ftp', 'weekHours', 'weekCount'],
};

// Default metrics by sport
const DEFAULT_METRICS_BY_SPORT: Record<string, MetricId[]> = {
  Cycling: ['fitness', 'form', 'ftp', 'weekHours'],
  Running: ['fitness', 'form', 'thresholdPace', 'weekHours'],
  Swimming: ['fitness', 'form', 'css', 'weekHours'],
  Other: ['fitness', 'form', 'weekHours', 'hrv'],
};

// Create default preferences from a list of enabled metric IDs
function createDefaultPreferences(enabledIds: MetricId[]): MetricPreference[] {
  return AVAILABLE_METRICS.map((metric, index) => ({
    id: metric.id,
    enabled: enabledIds.includes(metric.id),
    order: enabledIds.includes(metric.id) ? enabledIds.indexOf(metric.id) : index + 100, // Disabled metrics at end
  }));
}

interface DashboardPreferencesState {
  metrics: MetricPreference[];
  summaryCard: SummaryCardPreferences;
  isInitialized: boolean;

  // Actions
  setMetricEnabled: (id: MetricId, enabled: boolean) => void;
  reorderMetrics: (fromIndex: number, toIndex: number) => void;
  resetToDefaults: (sport: string) => void;
  getEnabledMetrics: () => MetricPreference[];
  setSummaryCardPreferences: (prefs: Partial<SummaryCardPreferences>) => void;
}

export const useDashboardPreferences = create<DashboardPreferencesState>((set, get) => ({
  metrics: createDefaultPreferences(DEFAULT_METRICS_BY_SPORT.Cycling),
  summaryCard: DEFAULT_SUMMARY_CARD,
  isInitialized: false,

  setMetricEnabled: (id, enabled) => {
    set((state) => {
      const newMetrics = state.metrics.map((m) => {
        if (m.id === id) {
          if (enabled && !m.enabled) {
            // Re-enabling: assign next sequential order after all currently enabled metrics
            const maxEnabledOrder = state.metrics
              .filter((metric) => metric.enabled && metric.id !== id)
              .reduce((max, metric) => Math.max(max, metric.order), -1);
            return { ...m, enabled, order: maxEnabledOrder + 1 };
          }
          // Disabling or no change: just toggle enabled
          return { ...m, enabled };
        }
        return m;
      });
      // Persist
      persistPreferences(newMetrics);
      return { metrics: newMetrics };
    });
  },

  reorderMetrics: (fromIndex, toIndex) => {
    set((state) => {
      const enabledMetrics = [...state.metrics]
        .filter((m) => m.enabled)
        .sort((a, b) => a.order - b.order);

      // Bounds checking: no-op if indices are out of range
      if (
        fromIndex < 0 ||
        fromIndex >= enabledMetrics.length ||
        toIndex < 0 ||
        toIndex >= enabledMetrics.length
      ) {
        return state; // Return unchanged state for invalid indices
      }

      // Reorder within enabled metrics
      const [moved] = enabledMetrics.splice(fromIndex, 1);
      enabledMetrics.splice(toIndex, 0, moved);

      // Update order values
      const newMetrics = state.metrics.map((m) => {
        if (m.enabled) {
          const newOrder = enabledMetrics.findIndex((em) => em.id === m.id);
          return { ...m, order: newOrder };
        }
        return m;
      });

      // Persist
      persistPreferences(newMetrics);
      return { metrics: newMetrics };
    });
  },

  resetToDefaults: (sport) => {
    const defaultIds = DEFAULT_METRICS_BY_SPORT[sport] || DEFAULT_METRICS_BY_SPORT.Other;
    const newMetrics = createDefaultPreferences(defaultIds);
    persistPreferences(newMetrics);
    set({ metrics: newMetrics });
  },

  getEnabledMetrics: () => {
    return get()
      .metrics.filter((m) => m.enabled)
      .sort((a, b) => a.order - b.order);
  },

  setSummaryCardPreferences: (prefs) => {
    set((state) => {
      const newSummaryCard = { ...state.summaryCard, ...prefs };
      // Persist
      persistSummaryCard(newSummaryCard);
      return { summaryCard: newSummaryCard };
    });
  },
}));

// Persistence helpers
async function persistPreferences(metrics: MetricPreference[]): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(metrics));
  } catch (error) {
    if (__DEV__) {
      console.warn('[DashboardPreferences] Failed to persist:', error);
    }
  }
}

async function persistSummaryCard(summaryCard: SummaryCardPreferences): Promise<void> {
  try {
    await AsyncStorage.setItem(SUMMARY_CARD_STORAGE_KEY, JSON.stringify(summaryCard));
  } catch (error) {
    if (__DEV__) {
      console.warn('[DashboardPreferences] Failed to persist summary card:', error);
    }
  }
}

export async function initializeDashboardPreferences(
  primarySport: string = 'Cycling'
): Promise<void> {
  try {
    const [storedMetrics, storedSummaryCard] = await Promise.all([
      AsyncStorage.getItem(STORAGE_KEY),
      AsyncStorage.getItem(SUMMARY_CARD_STORAGE_KEY),
    ]);

    let metrics: MetricPreference[];
    if (storedMetrics) {
      metrics = JSON.parse(storedMetrics) as MetricPreference[];
    } else {
      // No stored preferences - use sport-specific defaults
      const defaultIds = DEFAULT_METRICS_BY_SPORT[primarySport] || DEFAULT_METRICS_BY_SPORT.Other;
      metrics = createDefaultPreferences(defaultIds);
    }

    const summaryCard: SummaryCardPreferences = storedSummaryCard
      ? JSON.parse(storedSummaryCard)
      : DEFAULT_SUMMARY_CARD;

    useDashboardPreferences.setState({ metrics, summaryCard, isInitialized: true });
  } catch (error) {
    if (__DEV__) {
      console.warn('[DashboardPreferences] Failed to initialize:', error);
    }
    // Fall back to cycling defaults
    const metrics = createDefaultPreferences(DEFAULT_METRICS_BY_SPORT.Cycling);
    useDashboardPreferences.setState({
      metrics,
      summaryCard: DEFAULT_SUMMARY_CARD,
      isInitialized: true,
    });
  }
}

// Helper to get metric definition by ID
export function getMetricDefinition(id: MetricId): MetricDefinition | undefined {
  return AVAILABLE_METRICS.find((m) => m.id === id);
}

// Helper to filter metrics by sport
export function getMetricsForSport(metrics: MetricPreference[], sport: string): MetricPreference[] {
  return metrics.filter((m) => {
    const def = getMetricDefinition(m.id);
    if (!def) return false;
    // Include if not sport-specific, or if matches current sport
    return !def.sportSpecific || def.sportSpecific === sport;
  });
}
