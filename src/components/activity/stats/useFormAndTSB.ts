/**
 * @fileoverview useFormAndTSB - Training Stress Balance (Form) metrics
 *
 * Computes TSB (Training Stress Balance) from CTL (fitness) and ATL (fatigue).
 * TSB = CTL - ATL, indicating freshness (+) vs fatigue (-).
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { WellnessData } from '@/types';
import type { StatDetail } from './types';
import { colors } from '@/theme/colors';

interface UseFormAndTSBOptions {
  wellness?: WellnessData | null;
}

interface UseFormAndTSBResult {
  stat: StatDetail | null;
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
export function useFormAndTSB({
  wellness,
}: UseFormAndTSBOptions): UseFormAndTSBResult {
  const { t } = useTranslation();

  const stat = useMemo(() => {
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
    const isNeutral = !isFresh && !isFatigued;

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

    return {
      title: t('activity.stats.yourForm'),
      value: tsb > 0 ? `+${Math.round(tsb)}` : `${Math.round(tsb)}`,
      icon: isFresh ? 'emoticon-happy' : isFatigued ? 'emoticon-sad' : 'emoticon-neutral',
      color,
      context,
      explanation: t('activity.explanations.yourForm'),
      details,
    };
  }, [wellness, t]);

  return { stat };
}
