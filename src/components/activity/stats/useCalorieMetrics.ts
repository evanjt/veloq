/**
 * @fileoverview useCalorieMetrics - Calorie/energy metrics
 *
 * Computes energy expenditure with burn rate context.
 */

import { formatDuration } from '@/lib';
import type { Activity } from '@/types';
import type { StatDetail } from './types';
import { createMetricHook } from './createMetricHook';

interface UseCalorieMetricsOptions {
  activity: Activity;
}

/**
 * Compute calorie/energy metrics.
 *
 * Returns a StatDetail with:
 * - Primary value: Total calories burned
 * - Context: Burn rate (kcal/hr)
 * - Details: Duration, hourly rate
 *
 * Color: Amber-400 (consistent)
 *
 * @example
 * ```tsx
 * const calories = useCalorieMetrics({ activity });
 *
 * if (calories.stat) {
 *   return <StatCard stat={calories.stat} />;
 * }
 * ```
 */
export const useCalorieMetrics = createMetricHook<UseCalorieMetricsOptions>({
  name: 'useCalorieMetrics',

  compute: ({ activity }, t) => {
    // Require calorie data
    if (!activity.calories || activity.calories <= 0) {
      return null;
    }

    const calories = Math.round(activity.calories);
    const durationHours = (activity.moving_time || 0) / 3600;
    const burnRate = durationHours > 0 ? Math.round(calories / durationHours) : 0;

    // Build details array
    const details: StatDetail['details'] = [
      {
        label: t('activity.stats.duration'),
        value: formatDuration(activity.moving_time || 0),
      },
      {
        label: t('activity.stats.burnRate'),
        value: `${burnRate} ${t('activity.stats.kcalPerHr')}`,
      },
    ];

    return {
      title: t('activity.stats.energy'),
      value: `${calories}`,
      icon: 'fire' as const,
      color: '#FBBF24', // Amber-400
      explanation: t('activity.explanations.energy'),
      details,
    };
  },

  getDeps: ({ activity }) => [activity.calories, activity.moving_time],
});
