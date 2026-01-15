/**
 * @fileoverview useFormAndTSB - Training Stress Balance (Form) metrics
 *
 * Computes TSB (Training Stress Balance) from CTL (fitness) and ATL (fatigue).
 * TSB = CTL - ATL, indicating freshness (+) vs fatigue (-).
 */

import type { WellnessData } from '@/types';
import type { StatDetail } from './types';
import { colors } from '@/theme/colors';
import { createMetricHook } from './createMetricHook';

interface UseFormAndTSBOptions {
  wellness?: WellnessData | null;
}

/**
 * Compute Training Stress Balance (Form) metrics.
 *
 * Returns a StatDetail with:
 * - Primary value: TSB (CTL - ATL)
 * - Context: Positive = fresh, Negative = fatigued
 * - Details: CTL (fitness), ATL (fatigue)
 *
 * Color coding:
 * - Green (>5): Fresh
 * - Yellow (-10 to 5): Neutral
 * - Red (<-10): Fatigued
 *
 * @example
 * ```tsx
 * const form = useFormAndTSB({ wellness });
 *
 * if (form.stat) {
 *   return <StatCard stat={form.stat} />;
 * }
 * ```
 */
export const useFormAndTSB = createMetricHook<UseFormAndTSBOptions>({
  name: 'useFormAndTSB',

  compute: ({ wellness }, t) => {
    // Require CTL and ATL
    if (!wellness?.ctl || !wellness?.atl) {
      return null;
    }

    const ctl = wellness.ctl; // Chronic Training Load (fitness)
    const atl = wellness.atl; // Acute Training Load (fatigue)
    const tsb = ctl - atl; // Training Stress Balance (form)

    // Determine form level and color
    const isFresh = tsb > 5;
    const isFatigued = tsb < -10;

    const color = isFresh ? colors.success : isFatigued ? colors.error : colors.chartYellow;

    // Build context string
    let context: string | undefined;
    if (isFresh) {
      context = t('activity.form.fresh');
    } else if (isFatigued) {
      context = t('activity.form.fatigued');
    } else {
      context = t('activity.form.neutral');
    }

    // Build details array
    const details: StatDetail['details'] = [
      {
        label: t('activity.stats.yourFitness'),
        value: `${Math.round(ctl)}`,
      },
      {
        label: t('activity.stats.yourFatigue'),
        value: `${Math.round(atl)}`,
      },
    ];

    const icon = isFresh
      ? ('emoticon-happy' as const)
      : isFatigued
        ? ('emoticon-sad' as const)
        : ('emoticon-neutral' as const);

    return {
      title: t('activity.stats.yourForm'),
      value: tsb > 0 ? `+${Math.round(tsb)}` : `${Math.round(tsb)}`,
      icon,
      color,
      context,
      explanation: t('activity.explanations.yourForm'),
      details,
    };
  },

  getDeps: ({ wellness }) => [wellness?.ctl, wellness?.atl],
});
