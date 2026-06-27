import { useUnitPreference, resolveIsMetric } from './UnitPreferenceStore';

// Resolution: explicit metric/imperial wins; 'auto' falls back to intervals.icu
// preferences, then device locale. Subscribe so the component re-renders on change.
export function useMetricSystem(): boolean {
  useUnitPreference((state) => state.unitPreference);
  useUnitPreference((state) => state.intervalsPreferences);

  return resolveIsMetric();
}
