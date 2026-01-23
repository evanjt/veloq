import { useUnitPreference, resolveIsMetric } from '@/providers';

/**
 * Check if display should use metric system.
 *
 * Resolution order:
 * 1. Explicit user setting (metric/imperial)
 * 2. 'auto' with intervals.icu preferences: use intervals.icu
 * 3. 'auto' without intervals.icu: detect from device locale
 *
 * @returns true for metric, false for imperial
 */
export function useMetricSystem(): boolean {
  // Subscribe to store changes so component re-renders when preference changes
  const unitPreference = useUnitPreference((state) => state.unitPreference);
  const intervalsPreferences = useUnitPreference((state) => state.intervalsPreferences);

  // Resolve based on current state
  return resolveIsMetric();
}
