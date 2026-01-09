/**
 * @fileoverview useHeartRateStats - Heart rate metrics
 *
 * Computes heart rate statistics with % of max context,
 * comparison to user average, and related metrics.
 */

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { Activity, WellnessData } from "@/types";
import type { StatDetail } from "./types";
import { colors } from "@/theme/colors";

interface UseHeartRateStatsOptions {
  activity: Activity;
  wellness?: WellnessData | null;
  avgHR: number | null;
}

interface UseHeartRateStatsResult {
  stat: StatDetail | null;
}

/**
 * Compute heart rate metrics.
 *
 * Returns a StatDetail with:
 * - Primary value: Average HR with % of max context
 * - Comparison: vs user's typical HR (lower is better)
 * - Details: Peak HR, HR recovery, resting HR, HRV
 *
 * Color coding by % of max:
 * - Red (>90%): Very high intensity
 * - Amber (>80%): High intensity
 * - Pink (≤80%): Moderate/low intensity
 *
 * @example
 * ```tsx
 * const hrStats = useHeartRateStats({
 *   activity,
 *   wellness,
 *   avgHR: 145,
 * });
 *
 * if (hrStats.stat) {
 *   return <StatCard stat={hrStats.stat} />;
 * }
 * ```
 */
export function useHeartRateStats({
  activity,
  wellness,
  avgHR,
}: UseHeartRateStatsOptions): UseHeartRateStatsResult {
  const { t } = useTranslation();

  const stat = useMemo(() => {
    // Get average HR from multiple possible sources
    const hr = activity.average_heartrate || activity.icu_average_hr;
    if (!hr || hr <= 0) {
      return null;
    }

    // Get max HR from wellness or default
    const maxHR = wellness?.max_hr || 190;
    const hrPercent = Math.round((hr / maxHR) * 100);

    // Comparison vs average (lower is better for HR)
    const comparison =
      avgHR && avgHR > 0
        ? {
            label: t("activity.vsYourAvg"),
            value: `${Math.abs(Math.round(hr - avgHR))} bpm`,
            trend:
              hr < avgHR
                ? ("down" as const) // Lower is better
                : hr > avgHR
                  ? ("up" as const)
                  : ("same" as const),
            isGood: hr < avgHR, // Lower HR is better
          }
        : undefined;

    // Color by % of max
    const color =
      hrPercent > 90
        ? colors.error
        : hrPercent > 80
          ? "#F59E0B" // Amber-500
          : "#EC4899"; // Pink-500

    // Build details array
    const details: StatDetail["details"] = [
      ...(activity.max_heartrate
        ? [
            {
              label: t("activity.stats.peakHR"),
              value: `${Math.round(activity.max_heartrate)} bpm`,
            },
          ]
        : []),
      ...(wellness?.hrr
        ? [
            {
              label: t("activity.stats.hrRecovery"),
              value: `${Math.round(wellness.hrr)} bpm`,
            },
          ]
        : []),
      ...(wellness?.restingHR
        ? [
            {
              label: t("activity.stats.restingHR"),
              value: `${Math.round(wellness.restingHR)} bpm`,
            },
          ]
        : []),
      ...(wellness?.hrv
        ? [
            {
              label: t("activity.stats.hrv"),
              value: `${Math.round(wellness.hrv)} ms`,
            },
          ]
        : []),
    ];

    return {
      title: t("activity.stats.heartRate"),
      value: `${Math.round(hr)} bpm`,
      icon: "heart-pulse" as const,
      color,
      comparison,
      context: `${hrPercent}% ${t("activity.ofMax")}`,
      explanation: t("activity.explanations.heartRate"),
      details,
    };
  }, [activity, wellness, avgHR, t]);

  return { stat };
}
