/**
 * @fileoverview usePowerMetrics - Power metrics for cycling
 *
 * Computes power statistics with FTP context, variability index,
 * efficiency factor, and decoupling.
 */

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { Activity, WellnessData } from "@/types";
import type { StatDetail } from "./types";
import { colors } from "@/theme/colors";

interface UsePowerMetricsOptions {
  activity: Activity;
  wellness?: WellnessData | null;
}

interface UsePowerMetricsResult {
  stat: StatDetail | null;
}

/**
 * Compute power metrics.
 *
 * Returns a StatDetail with:
 * - Primary value: Average watts
 * - Context: % of estimated FTP (eFTP)
 * - Details: VI (variability index), EF (efficiency factor), decoupling
 *
 * Only applies to activities with power data (typically cycling).
 *
 * @example
 * ```tsx
 * const power = usePowerMetrics({
 *   activity,
 *   wellness,
 * });
 *
 * if (power.stat) {
 *   return <StatCard stat={power.stat} />;
 * }
 * ```
 */
export function usePowerMetrics({
  activity,
  wellness,
}: UsePowerMetricsOptions): UsePowerMetricsResult {
  const { t } = useTranslation();

  const stat = useMemo(() => {
    // Require power data
    if (!activity.average_watts || activity.average_watts <= 0) {
      return null;
    }

    const avgPower = Math.round(activity.average_watts);
    const eFTP = wellness?.ftp || activity.icu_ftp || 200; // Default FTP
    const ftpPercent = Math.round((avgPower / eFTP) * 100);

    // Comparison vs FTP (higher is better for power)
    const comparison = {
      label: `${Math.round(eFTP)} ${t("activity.stats.ftp")}`,
      value: `${ftpPercent}%`,
      trend:
        ftpPercent > 75
          ? ("up" as const)
          : ftpPercent < 50
            ? ("down" as const)
            : ("same" as const),
      isGood: ftpPercent > 75, // >75% FTP is good
    };

    // Build details array
    const details: StatDetail["details"] = [];

    // Normalized power (if weighted power available)
    if (
      activity.weighted_average_watts &&
      activity.weighted_average_watts !== activity.average_watts
    ) {
      details.push({
        label: t("activity.stats.normalizedPower"),
        value: `${Math.round(activity.weighted_average_watts)} W`,
      });
    }

    // Variability Index (VI = NP / AP)
    if (activity.weighted_average_watts && activity.average_watts) {
      const vi = activity.weighted_average_watts / activity.average_watts;
      details.push({
        label: t("activity.stats.vi"),
        value: vi.toFixed(2),
      });
    }

    // Efficiency Factor (EF = NP / HR)
    if (activity.weighted_average_watts && activity.average_heartrate) {
      const ef = activity.weighted_average_watts / activity.average_heartrate;
      details.push({
        label: t("activity.stats.ef"),
        value: ef.toFixed(2),
      });
    }

    // Decoupling (if pacing data available)
    if (activity.pacing_index) {
      details.push({
        label: t("activity.stats.decoup"),
        value: activity.pacing_index.toFixed(2),
      });
    }

    return {
      title: "Power",
      value: `${avgPower} W`,
      icon: "lightning-bolt" as const,
      color: colors.success, // Green for power (higher is better)
      comparison,
      explanation: t("activity.explanations.power"),
      details: details.length > 0 ? details : undefined,
    };
  }, [activity, wellness, t]);

  return { stat };
}
