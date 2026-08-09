/**
 * Activity stats components and hooks.
 */

export { InsightfulStats } from './InsightfulStats';
export { StatCard } from './StatCard';
export { StatDetailModal } from './StatDetailModal';
export { useActivityStats } from './useActivityStats';
export type { StatDetail, StatComparison } from './types';

// Individual metric hooks (extracted from useActivityStats)
export { useTrainingLoad } from './useTrainingLoad';
export { useHeartRateStats } from './useHeartRateStats';
export { useCalorieMetrics } from './useCalorieMetrics';
export { useWeatherImpact } from './useWeatherImpact';
export { useFormAndTSB } from './useFormAndTSB';
export { usePowerMetrics } from './usePowerMetrics';

// Factory for creating metric hooks
export { createMetricHook } from './createMetricHook';
export type { MetricHookConfig, MetricHookResult } from './createMetricHook';
