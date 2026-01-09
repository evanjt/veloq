/**
 * @fileoverview useTrainingLoad - Training load metrics
 *
 * Computes training load statistics with intensity factor (IF),
 * comparison to user average, and related metrics (TRIMP, strain, fitness).
 */

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { Activity, WellnessData } from "@/types";
import type { StatDetail } from "./types";
import { colors } from "@/theme/colors";

interface UseTrainingLoadOptions {
  activity: Activity;
  wellness?: WellnessData | null;
  avgLoad: number | null;
}

interface UseTrainingLoadResult {
  stat: StatDetail | null;
}

/**
 * Compute training load metrics.
 *
 * Returns a StatDetail with:
 * - Primary value: ICU training load
 * - Comparison: vs user's recent average
 * - Context: Intensity factor (IF)
 * - Details: TRIMP, strain, fitness (CTL), fatigue (ATL)
 *
 * Color coding by intensity:
 * - Red (>100): Very high intensity
 * - Amber (>85): High intensity
 * - Yellow (>70): Moderate intensity
 * - Green (≤70): Low intensity
 *
 * @example
 * ```tsx
 * const trainingLoad = useTrainingLoad({
 *   activity,
 *   wellness,
 *   avgLoad: 150,
 * });
 *
 * if (trainingLoad.stat) {
 *   return <StatCard stat={trainingLoad.stat} />;
 * }
 * ```
 */
export function useTrainingLoad({
  activity,
  wellness,
  avgLoad,
}: UseTrainingLoadOptions): UseTrainingLoadResult {
  const { t } = useTranslation();

  const stat = useMemo(() => {
    // Require training load data
    if (!activity.icu_training_load || activity.icu_training_load <= 0) {
      return null;
    }

    const load = activity.icu_training_load;
    const intensity = activity.icu_intensity || 0;

    // Comparison vs user average
    const comparison =
      avgLoad && avgLoad > 0
        ? {
            label: t("activity.vsYourAvg"),
            value: `${load > avgLoad ? "+" : ""}${Math.round(((load - avgLoad) / avgLoad) * 100)}%`,
            trend:
              load > avgLoad
                ? ("up" as const)
                : load < avgLoad
                  ? ("down" as const)
                  : ("same" as const),
            isGood: undefined, // Load being higher isn't inherently good or bad
          }
        : undefined;

    // Color by intensity
    const color =
      intensity > 100
        ? colors.error
        : intensity > 85
          ? "#F59E0B" // Amber-500
          : intensity > 70
            ? colors.chartYellow
            : colors.success;

    // Build details array
    const details: StatDetail["details"] = [
      {
        label: t("activity.stats.intensityFactor"),
        value: `${Math.round(intensity)}%`,
      },
      activity.trimp
        ? {
            label: t("activity.stats.trimp"),
            value: `${Math.round(activity.trimp)}`,
          }
        : null,
      activity.strain_score
        ? {
            label: t("activity.stats.strain"),
            value: `${Math.round(activity.strain_score)}`,
          }
        : null,
      wellness?.ctl
        ? {
            label: t("activity.stats.yourFitness"),
            value: `${Math.round(wellness.ctl)}`,
          }
        : null,
      wellness?.atl
        ? {
            label: t("activity.stats.yourFatigue"),
            value: `${Math.round(wellness.atl)}`,
          }
        : null,
    ].filter(Boolean);

    return {
      title: t("activity.stats.trainingLoad"),
      value: `${Math.round(load)}`,
      icon: "lightning-bolt",
      color,
      comparison,
      context: `IF ${Math.round(intensity)}%`,
      explanation: t("activity.explanations.trainingLoad"),
      details,
    };
  }, [activity, wellness, avgLoad, t]);

  return { stat };
}
