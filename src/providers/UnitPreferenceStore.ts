import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLocales } from 'expo-localization';

const UNIT_PREFERENCE_KEY = 'veloq-unit-preference';

export type UnitPreference = 'auto' | 'metric' | 'imperial';

/**
 * Unit preferences from intervals.icu athlete profile.
 * Used to set initial defaults and show in settings UI.
 */
export interface IntervalsUnitPreferences {
  measurementPreference: 'meters' | 'feet';
  fahrenheit: boolean;
  windSpeed: 'KMH' | 'MPH' | 'MS';
}

interface UnitPreferenceState {
  /** User's local preference: auto, metric, or imperial */
  unitPreference: UnitPreference;
  /** Unit preferences from intervals.icu profile (null for demo mode) */
  intervalsPreferences: IntervalsUnitPreferences | null;
  isLoaded: boolean;

  // Actions
  initialize: () => Promise<void>;
  setUnitPreference: (pref: UnitPreference) => Promise<void>;
  setIntervalsPreferences: (prefs: IntervalsUnitPreferences) => void;
}

/**
 * Detect metric preference from device locale.
 * Returns true for metric, false for imperial.
 */
function detectFromLocale(): boolean {
  try {
    const locales = getLocales();
    const locale = locales[0];
    // Only US, Liberia, and Myanmar use imperial
    const imperialCountries = ['US', 'LR', 'MM'];
    return !imperialCountries.includes(locale?.regionCode || '');
  } catch {
    return true; // Default to metric
  }
}

export const useUnitPreference = create<UnitPreferenceState>((set, get) => ({
  unitPreference: 'auto',
  intervalsPreferences: null,
  isLoaded: false,

  initialize: async () => {
    try {
      const stored = await AsyncStorage.getItem(UNIT_PREFERENCE_KEY);
      if (stored && ['auto', 'metric', 'imperial'].includes(stored)) {
        set({
          unitPreference: stored as UnitPreference,
          isLoaded: true,
        });
      } else {
        set({ isLoaded: true });
      }
    } catch {
      set({ isLoaded: true });
    }
  },

  setUnitPreference: async (pref: UnitPreference) => {
    await AsyncStorage.setItem(UNIT_PREFERENCE_KEY, pref);
    set({ unitPreference: pref });
  },

  setIntervalsPreferences: (prefs: IntervalsUnitPreferences) => {
    set({ intervalsPreferences: prefs });
  },
}));

/**
 * Resolve current unit preference to boolean.
 * For use in React components via useMetricSystem hook.
 *
 * Resolution order:
 * 1. Explicit user setting (metric/imperial)
 * 2. 'auto' with intervals.icu preferences available: use intervals.icu
 * 3. 'auto' without intervals.icu: detect from device locale
 */
export function resolveIsMetric(): boolean {
  const { unitPreference, intervalsPreferences } = useUnitPreference.getState();

  if (unitPreference === 'metric') return true;
  if (unitPreference === 'imperial') return false;

  // 'auto' mode - check intervals.icu preferences first
  if (intervalsPreferences) {
    return intervalsPreferences.measurementPreference === 'meters';
  }

  // Fall back to locale detection
  return detectFromLocale();
}

/**
 * Get metric preference synchronously (for non-React contexts).
 */
export function getIsMetric(): boolean {
  return resolveIsMetric();
}

/**
 * Get a human-readable label for the intervals.icu preference.
 */
export function getIntervalsPreferenceLabel(prefs: IntervalsUnitPreferences | null): string | null {
  if (!prefs) return null;
  return prefs.measurementPreference === 'meters' ? 'Metric' : 'Imperial';
}

/**
 * Initialize unit preference (call during app startup).
 */
export async function initializeUnitPreference(): Promise<void> {
  await useUnitPreference.getState().initialize();
}
