/**
 * Hook for computing insightful stats from activity data.
 * Extracts the stats computation logic from InsightfulStats component.
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDuration } from '@/lib';
import type { Activity, WellnessData } from '@/types';
import type { StatDetail } from './types';
import { colors } from '@/theme';

// Explanation keys for each metric - educational, not interpretive
const METRIC_EXPLANATION_KEYS: Record<string, string> = {
  'Training Load': 'activity.explanations.trainingLoad',
  'Heart Rate': 'activity.explanations.heartRate',
  Energy: 'activity.explanations.energy',
  Conditions: 'activity.explanations.conditions',
  'Your Form': 'activity.explanations.yourForm',
  Power: 'activity.explanations.power',
};

interface UseActivityStatsOptions {
  activity: Activity;
  wellness?: WellnessData | null;
  recentActivities?: Activity[];
}

interface UseActivityStatsResult {
  stats: StatDetail[];
  avgLoad: number | null;
  avgIntensity: number | null;
  avgHR: number | null;
}

export function useActivityStats({
  activity,
  wellness,
  recentActivities = [],
}: UseActivityStatsOptions): UseActivityStatsResult {
  const { t } = useTranslation();

  // Calculate averages from recent activities of same type (memoized)
  const { avgLoad, avgIntensity, avgHR } = useMemo(() => {
    const sameType = recentActivities.filter((a) => a.type === activity.type);
    if (sameType.length === 0) {
      return { avgLoad: null, avgIntensity: null, avgHR: null };
    }
    return {
      avgLoad: sameType.reduce((sum, a) => sum + (a.icu_training_load || 0), 0) / sameType.length,
      avgIntensity: sameType.reduce((sum, a) => sum + (a.icu_intensity || 0), 0) / sameType.length,
      avgHR:
        sameType.reduce((sum, a) => sum + (a.average_heartrate || a.icu_average_hr || 0), 0) /
        sameType.length,
    };
  }, [recentActivities, activity.type]);

  // Build insightful stats (memoized to prevent rebuild on every render)
  const stats = useMemo(() => {
    const result: StatDetail[] = [];

    // Training Load with context
    if (activity.icu_training_load && activity.icu_training_load > 0) {
      const load = activity.icu_training_load;
      const loadComparison =
        avgLoad && avgLoad > 0
          ? {
              label: t('activity.vsYourAvg'),
              value: `${load > avgLoad ? '+' : ''}${Math.round(((load - avgLoad) / avgLoad) * 100)}%`,
              trend:
                load > avgLoad
                  ? ('up' as const)
                  : load < avgLoad
                    ? ('down' as const)
                    : ('same' as const),
              isGood: undefined, // Load being higher isn't inherently good or bad
            }
          : undefined;

      // Determine intensity level for color
      const intensity = activity.icu_intensity || 0;
      const loadColor =
        intensity > 100
          ? colors.error
          : intensity > 85
            ? '#F59E0B' // Amber-500 
            : intensity > 70
              ? colors.chartYellow
              : colors.success;

      result.push({
        title: t('activity.stats.trainingLoad'),
        value: `${Math.round(load)}`,
        icon: 'lightning-bolt',
        color: loadColor,
        comparison: loadComparison,
        context: `IF ${Math.round(intensity)}%`,
        explanation: t(METRIC_EXPLANATION_KEYS['Training Load'] as never),
        details: [
          {
            label: t('activity.stats.intensityFactor'),
            value: `${Math.round(activity.icu_intensity || 0)}%`,
          },
          activity.trimp
            ? { label: t('activity.stats.trimp'), value: `${Math.round(activity.trimp)}` }
            : null,
          activity.strain_score
            ? { label: t('activity.stats.strain'), value: `${Math.round(activity.strain_score)}` }
            : null,
          wellness?.ctl
            ? { label: t('activity.stats.yourFitness'), value: `${Math.round(wellness.ctl)}` }
            : null,
          wellness?.atl
            ? { label: t('activity.stats.yourFatigue'), value: `${Math.round(wellness.atl)}` }
            : null,
        ].filter(Boolean) as { label: string; value: string }[],
      });
    }

    // Heart Rate with % of max context
    const avgHRValue = activity.average_heartrate || activity.icu_average_hr;
    const maxHRValue = activity.max_heartrate || activity.icu_max_hr;
    if (avgHRValue) {
      // Get athlete max HR from zones if available
      const athleteMaxHR = activity.icu_hr_zones?.[activity.icu_hr_zones.length - 1] || 200;
      const hrPercent = Math.round((avgHRValue / athleteMaxHR) * 100);

      const hrComparison =
        avgHR && avgHR > 0
          ? {
              label: t('activity.vsTypical'),
              value: `${avgHRValue > avgHR ? '+' : ''}${Math.round(avgHRValue - avgHR)} bpm`,
              trend:
                avgHRValue > avgHR
                  ? ('up' as const)
                  : avgHRValue < avgHR
                    ? ('down' as const)
                    : ('same' as const),
              isGood: avgHRValue < avgHR, // Lower HR for same effort = fitter
            }
          : undefined;

      result.push({
        title: t('activity.heartRate'),
        value: `${Math.round(avgHRValue)}`,
        icon: 'heart-pulse',
        color: hrPercent > 90 ? colors.error : hrPercent > 80 ? '#F59E0B' : '#EC4899', // Amber + Pink
        comparison: hrComparison,
        context: t('activity.stats.percentOfMaxHR', { percent: hrPercent }),
        explanation: t(METRIC_EXPLANATION_KEYS['Heart Rate'] as never),
        details: [
          { label: t('activity.stats.average'), value: `${Math.round(avgHRValue)} bpm` },
          maxHRValue
            ? { label: t('activity.stats.peak'), value: `${Math.round(maxHRValue)} bpm` }
            : null,
          { label: t('activity.stats.percentOfMaxHRLabel'), value: `${hrPercent}%` },
          activity.icu_hrr
            ? {
                label: t('activity.stats.hrRecovery'),
                value: t('activity.stats.bpmDrop', { value: activity.icu_hrr.hrr }),
              }
            : null,
          wellness?.restingHR
            ? { label: t('activity.stats.restingHRToday'), value: `${wellness.restingHR} bpm` }
            : null,
          wellness?.hrv
            ? { label: t('activity.stats.hrvToday'), value: `${Math.round(wellness.hrv)} ms` }
            : null,
        ].filter(Boolean) as { label: string; value: string }[],
      });
    }

    // Calories
    if (activity.calories && activity.calories > 0) {
      const calPerHour = Math.round((activity.calories / activity.moving_time) * 3600);
      result.push({
        title: t('activity.stats.energy'),
        value: `${Math.round(activity.calories)}`,
        icon: 'fire',
        color: '#FBBF24', // Amber-400
        context: `${calPerHour} kcal/hr`,
        explanation: t(METRIC_EXPLANATION_KEYS['Energy'] as never),
        details: [
          {
            label: t('activity.stats.caloriesBurned'),
            value: `${Math.round(activity.calories)} kcal`,
          },
          { label: t('activity.duration'), value: formatDuration(activity.moving_time) },
          { label: t('activity.stats.burnRate'), value: `${calPerHour} kcal/hr` },
        ],
      });
    }

    // Temperature/Conditions
    const temp = activity.average_weather_temp ?? activity.average_temp;
    if (temp != null) {
      const isHot = temp > 28;
      const isCold = temp < 10;
      // Build context from available weather data
      const conditionParts: string[] = [];
      if (
        activity.average_feels_like != null &&
        Math.abs(activity.average_feels_like - temp) >= 2
      ) {
        conditionParts.push(
          t('activity.stats.feelsLike', { temp: Math.round(activity.average_feels_like) })
        );
      }
      if (activity.average_wind_speed != null && activity.average_wind_speed > 2) {
        conditionParts.push(
          t('activity.stats.windSpeed', { speed: (activity.average_wind_speed * 3.6).toFixed(0) })
        );
      }
      const contextStr =
        conditionParts.length > 0
          ? conditionParts.join(', ')
          : activity.has_weather
            ? t('activity.stats.weatherData')
            : t('activity.stats.deviceSensor');

      result.push({
        title: t('activity.stats.conditions'),
        value: `${Math.round(temp)}°`,
        icon: activity.has_weather ? 'weather-partly-cloudy' : 'thermometer',
        color: isHot ? '#F59E0B' : isCold ? colors.secondary : colors.success, // Amber for hot
        context: contextStr,
        explanation: t(METRIC_EXPLANATION_KEYS['Conditions'] as never),
        details: [
          { label: t('activity.stats.temperature'), value: `${Math.round(temp)}°C` },
          activity.average_feels_like != null
            ? {
                label: t('activity.stats.feelsLikeLabel'),
                value: `${Math.round(activity.average_feels_like)}°C`,
              }
            : null,
          activity.average_wind_speed != null
            ? {
                label: t('activity.stats.wind'),
                value: `${(activity.average_wind_speed * 3.6).toFixed(0)} km/h`,
              }
            : null,
        ].filter(Boolean) as { label: string; value: string }[],
      });
    }

    // Form from wellness (TSB = CTL - ATL)
    if (wellness?.ctl != null && wellness?.atl != null) {
      const tsb = wellness.ctl - wellness.atl;
      const formColor = tsb > 5 ? colors.success : tsb > -10 ? colors.chartYellow : colors.error;

      result.push({
        title: t('activity.stats.yourForm'),
        value: `${tsb > 0 ? '+' : ''}${Math.round(tsb)}`,
        icon: 'account-heart',
        color: formColor,
        context: t('activity.stats.dailyValue'),
        explanation: t(METRIC_EXPLANATION_KEYS['Your Form'] as never),
        details: [
          { label: t('activity.stats.formTSB'), value: `${tsb > 0 ? '+' : ''}${Math.round(tsb)}` },
          { label: t('activity.stats.fitnessCTL'), value: `${Math.round(wellness.ctl)}` },
          { label: t('activity.stats.fatigueATL'), value: `${Math.round(wellness.atl)}` },
          wellness.hrv
            ? { label: t('metrics.hrv'), value: `${Math.round(wellness.hrv)} ms` }
            : null,
          wellness.sleepScore
            ? { label: t('activity.stats.sleepScore'), value: `${wellness.sleepScore}%` }
            : null,
        ].filter(Boolean) as { label: string; value: string }[],
      });
    }

    // Power - Average watts (includes eFTP, decoupling, efficiency in details)
    const avgPower = activity.average_watts || activity.icu_average_watts;
    if (avgPower && avgPower > 0) {
      const eftp = activity.icu_pm_ftp_watts;
      result.push({
        title: t('activity.power'),
        value: `${Math.round(avgPower)}`,
        icon: 'lightning-bolt-circle',
        color: '#9C27B0',
        context: eftp
          ? `eFTP ${Math.round(eftp)}W`
          : activity.max_watts
            ? t('activity.stats.max', { value: Math.round(activity.max_watts) }) + 'W'
            : undefined,
        explanation: t(METRIC_EXPLANATION_KEYS['Power'] as never),
        details: [
          { label: t('activity.stats.average'), value: `${Math.round(avgPower)}W` },
          activity.max_watts
            ? { label: t('activity.stats.maxLabel'), value: `${Math.round(activity.max_watts)}W` }
            : null,
          activity.icu_ftp
            ? {
                label: t('activity.stats.percentOfFTP'),
                value: `${Math.round((avgPower / activity.icu_ftp) * 100)}%`,
              }
            : null,
          eftp ? { label: t('activity.stats.eftpEstimated'), value: `${Math.round(eftp)}W` } : null,
          activity.icu_efficiency_factor
            ? {
                label: t('activity.stats.efficiencyFactor'),
                value: activity.icu_efficiency_factor.toFixed(2),
              }
            : null,
          activity.decoupling != null
            ? { label: t('activity.stats.decoupling'), value: `${activity.decoupling.toFixed(1)}%` }
            : null,
        ].filter(Boolean) as { label: string; value: string }[],
      });
    }

    return result;
  }, [activity, wellness, avgLoad, avgHR, t]);

  return { stats, avgLoad, avgIntensity, avgHR };
}
