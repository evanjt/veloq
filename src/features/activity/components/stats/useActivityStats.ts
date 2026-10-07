/**
 * The stat cards on the activity detail screen: training load, heart rate,
 * energy, conditions, form and power.
 *
 * Each card carries a context line under its value. A metric with no data is
 * left out rather than shown empty, so two activities rarely carry the same
 * set of cards.
 */
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { getApparentTemperature } from '@/shared/activity/activityUtils';
import {
  formatDuration,
  formatHeartRate,
  formatSpeed,
  formatTemperature,
} from '@/shared/format/format';
import { getFormZone, formatForm, formZoneTextColor, formZoneLabel } from '@/features/fitness';
import { storedDecoupling } from '@/features/activity/lib/decoupling';
import type { Activity, WellnessData } from '@/types';
import type { ActivityFitnessImpact } from 'veloqrs';
import type { StatDetail } from './types';
import { colors, darkColors } from '@/theme';
import { TEMPERATURE_THRESHOLDS, FEELS_LIKE_THRESHOLD } from '@/constants';
import { formAsPercent } from '@/shared/app/FormPreferenceStore';
import { formFromLoads } from '@/shared/math';

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
  wellness?: WellnessData | null | undefined;
  /**
   * The theme, for the card marks. Passed in rather than read from the app
   * shell: this hook is data, and reaching the shell for a colour pulls the
   * native module into every test that renders a stat.
   */
  isDark?: boolean | undefined;
  /**
   * The athlete's unit system, for temperature and wind. Required, so a caller
   * that forgets it is a type error rather than a metric card.
   */
  isMetric: boolean;
  /** The max HR the zones chart divides by, from the detail screen read. */
  maxHR: number;
  fitnessImpact?: ActivityFitnessImpact | null | undefined;
}

interface UseActivityStatsResult {
  stats: StatDetail[];
}

export function useActivityStats({
  activity,
  wellness,
  isDark = false,
  isMetric,
  maxHR,
  fitnessImpact,
}: UseActivityStatsOptions): UseActivityStatsResult {
  const { t } = useTranslation();
  // The card marks are icons and text on the card surface, so they take the
  // theme's mark tone rather than the fill tone, which is 2.28:1 on white.
  const green = isDark ? darkColors.successDeep : colors.successDeep;
  const amber = isDark ? darkColors.warningAmber : colors.warningAmber;

  // Build insightful stats (memoized to prevent rebuild on every render)
  const stats = useMemo(() => {
    const result: StatDetail[] = [];

    // Training Load with context
    if (activity.icu_training_load && activity.icu_training_load > 0) {
      const load = activity.icu_training_load;
      // The icon's colour bands the session, and colour alone cannot say which
      // band it is, so the context line names it and the icon is decoration.
      const intensity = activity.icu_intensity || 0;
      const loadColor =
        intensity > 100
          ? colors.error
          : intensity > 85
            ? amber
            : intensity > 70
              ? colors.chartYellow
              : green;
      const intensityBand =
        intensity > 100
          ? t('activity.stats.intensityVeryHard')
          : intensity > 85
            ? t('activity.stats.intensityHard')
            : intensity > 70
              ? t('activity.stats.intensityModerate')
              : t('activity.stats.intensityEasy');

      result.push({
        title: t('activity.stats.trainingLoad'),
        value: `${Math.round(load)}`,
        icon: 'lightning-bolt',
        color: loadColor,
        context: `IF ${Math.round(intensity)}% · ${intensityBand}`,
        explanation: t(METRIC_EXPLANATION_KEYS['Training Load'] as never),
        details: [
          {
            label: t('activity.stats.intensityFactor'),
            value: `${Math.round(activity.icu_intensity || 0)}%`,
          },
          activity.trimp
            ? {
                label: t('activity.stats.trimp'),
                value: `${Math.round(activity.trimp)}`,
              }
            : null,
          activity.strain_score
            ? {
                label: t('activity.stats.strain'),
                value: `${Math.round(activity.strain_score)}`,
              }
            : null,
          wellness?.ctl
            ? {
                label: t('activity.stats.yourFitness'),
                value: `${Math.round(wellness.ctl)}`,
              }
            : null,
          wellness?.atl
            ? {
                label: t('activity.stats.yourFatigue'),
                value: `${Math.round(wellness.atl)}`,
              }
            : null,
        ].filter(Boolean) as { label: string; value: string }[],
      });
    }

    if (fitnessImpact) {
      const signed = (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(1)}`;
      result.push({
        title: t('activity.stats.fitnessImpact'),
        value: signed(fitnessImpact.fitness),
        icon: 'chart-line',
        color: green,
        context: t('activity.stats.fitnessImpactContext'),
        explanation: t('activity.explanations.fitnessImpact'),
        details: [
          { label: t('activity.stats.fitnessCTL'), value: signed(fitnessImpact.fitness) },
          { label: t('activity.stats.fatigueATL'), value: signed(fitnessImpact.fatigue) },
          { label: t('activity.stats.formTSB'), value: signed(fitnessImpact.form) },
        ],
      });
    }

    // Heart Rate with % of max context
    const avgHRValue = activity.average_heartrate;
    const maxHRValue = activity.max_heartrate;
    if (avgHRValue) {
      const hrPercent = Math.round((avgHRValue / maxHR) * 100);

      result.push({
        title: t('activity.heartRate'),
        value: `${Math.round(avgHRValue)}`,
        icon: 'heart-pulse',
        color:
          hrPercent > 90
            ? isDark
              ? darkColors.errorDeep
              : colors.errorDeep
            : hrPercent > 80
              ? amber
              : isDark
                ? darkColors.chartPinkText
                : colors.chartPinkText,
        context: t('activity.stats.percentOfMaxHR', { percent: hrPercent }),
        explanation: t(METRIC_EXPLANATION_KEYS['Heart Rate'] as never),
        details: [
          {
            label: t('activity.stats.average'),
            value: formatHeartRate(avgHRValue),
          },
          maxHRValue
            ? {
                label: t('activity.stats.peak'),
                value: formatHeartRate(maxHRValue),
              }
            : null,
          {
            label: t('activity.stats.percentOfMaxHRLabel'),
            value: `${hrPercent}%`,
          },
          activity.icu_hrr
            ? {
                label: t('activity.stats.hrRecovery'),
                value: t('activity.stats.bpmDrop', {
                  value: activity.icu_hrr.hrr,
                }),
              }
            : null,
          wellness?.restingHR
            ? {
                label: t('activity.stats.restingHRToday'),
                value: formatHeartRate(wellness.restingHR),
              }
            : null,
          wellness?.hrv
            ? {
                label: t('activity.stats.hrvToday'),
                value: `${Math.round(wellness.hrv)} ms`,
              }
            : null,
        ].filter(Boolean) as { label: string; value: string }[],
      });
    }

    // Calories
    if (activity.calories && activity.calories > 0) {
      // moving_time can be 0 (manual indoor entries), so gate the burn rate to
      // avoid rendering "Infinity kcal/hr".
      const calPerHour =
        activity.moving_time > 0
          ? Math.round((activity.calories / activity.moving_time) * 3600)
          : null;
      const burnRate = calPerHour != null ? `${calPerHour} kcal/hr` : undefined;
      result.push({
        title: t('activity.stats.energy'),
        value: `${Math.round(activity.calories)}`,
        icon: 'fire',
        color: amber,
        context: burnRate,
        explanation: t(METRIC_EXPLANATION_KEYS['Energy'] as never),
        details: [
          {
            label: t('activity.stats.caloriesBurned'),
            value: `${Math.round(activity.calories)} kcal`,
          },
          {
            label: t('activity.duration'),
            value: formatDuration(activity.moving_time),
          },
          ...(burnRate ? [{ label: t('activity.stats.burnRate'), value: burnRate }] : []),
        ],
      });
    }

    // Temperature/Conditions
    const temp = activity.average_weather_temp ?? activity.average_temp;
    if (temp != null) {
      const isHot = temp > TEMPERATURE_THRESHOLDS.HOT;
      const isCold = temp < TEMPERATURE_THRESHOLDS.COLD;
      // Build context from available weather data
      const conditionParts: string[] = [];
      const feelsLike = getApparentTemperature(activity);
      if (feelsLike != null && Math.abs(feelsLike - temp) >= FEELS_LIKE_THRESHOLD) {
        conditionParts.push(
          t('activity.stats.feelsLike', {
            temp: formatTemperature(feelsLike, isMetric),
          })
        );
      }
      if (activity.average_wind_speed != null && activity.average_wind_speed > 2) {
        conditionParts.push(
          t('activity.stats.windSpeed', {
            speed: formatSpeed(activity.average_wind_speed, isMetric),
          })
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
        value: formatTemperature(temp, isMetric),
        icon: activity.has_weather ? 'weather-partly-cloudy' : 'thermometer',
        color: isHot ? amber : isCold ? colors.secondary : green,
        context: contextStr,
        explanation: t(METRIC_EXPLANATION_KEYS['Conditions'] as never),
        details: [
          {
            label: t('activity.stats.temperature'),
            value: formatTemperature(temp, isMetric),
          },
          feelsLike != null
            ? {
                label: t('activity.stats.feelsLikeLabel'),
                value: formatTemperature(feelsLike, isMetric),
              }
            : null,
          activity.average_wind_speed != null
            ? {
                label: t('activity.stats.wind'),
                value: formatSpeed(activity.average_wind_speed, isMetric),
              }
            : null,
        ].filter(Boolean) as { label: string; value: string }[],
      });
    }

    // Form from wellness (TSB = CTL - ATL)
    if (wellness?.ctl != null && wellness?.atl != null) {
      const tsb = wellness.ctl - wellness.atl;
      const asPercent = formAsPercent();
      const formZone = getFormZone(tsb, wellness.ctl, asPercent);
      const formColor = formZone
        ? formZoneTextColor(formZone, isDark)
        : isDark
          ? darkColors.textPrimary
          : colors.textPrimary;
      const form = formFromLoads(wellness.ctl, wellness.atl);
      const formText = `${form > 0 ? '+' : ''}${form}`;
      const formValue = formatForm(form, wellness.ctl, asPercent) ?? '';

      result.push({
        title: t('activity.stats.yourForm'),
        value: formValue,
        icon: 'account-heart',
        color: formColor,
        // The zone is what the colour says, so the context says it in words.
        context: formZone ? formZoneLabel(formZone) : undefined,
        explanation: t(METRIC_EXPLANATION_KEYS['Your Form'] as never),
        details: [
          {
            label: t('activity.stats.formTSB'),
            value: formText,
          },
          {
            label: t('activity.stats.fitnessCTL'),
            value: `${Math.round(wellness.ctl)}`,
          },
          {
            label: t('activity.stats.fatigueATL'),
            value: `${Math.round(wellness.atl)}`,
          },
          wellness.hrv
            ? {
                label: t('metrics.hrv'),
                value: `${Math.round(wellness.hrv)} ms`,
              }
            : null,
          wellness.sleepScore
            ? {
                label: t('activity.stats.sleepScore'),
                value: `${wellness.sleepScore}%`,
              }
            : null,
        ].filter(Boolean) as { label: string; value: string }[],
      });
    }

    // Power - Average watts (includes eFTP, decoupling, efficiency in details)
    const avgPower = activity.icu_average_watts;
    if (avgPower && avgPower > 0) {
      const eftp = activity.icu_pm_ftp_watts;
      const decoupling = storedDecoupling(activity);
      result.push({
        title: t('activity.power'),
        value: `${Math.round(avgPower)}`,
        icon: 'lightning-bolt-circle',
        color: isDark ? darkColors.chartPurpleText : colors.chartPurpleText,
        context: eftp
          ? `eFTP ${Math.round(eftp)}W`
          : activity.icu_pm_p_max
            ? t('activity.stats.max', {
                value: Math.round(activity.icu_pm_p_max),
              }) + 'W'
            : undefined,
        explanation: t(METRIC_EXPLANATION_KEYS['Power'] as never),
        details: [
          {
            label: t('activity.stats.average'),
            value: `${Math.round(avgPower)}W`,
          },
          activity.icu_pm_p_max
            ? {
                label: t('activity.stats.maxLabel'),
                value: `${Math.round(activity.icu_pm_p_max)}W`,
              }
            : null,
          activity.icu_ftp
            ? {
                label: t('activity.stats.percentOfFTP'),
                value: `${Math.round((avgPower / activity.icu_ftp) * 100)}%`,
              }
            : null,
          eftp
            ? {
                label: t('activity.stats.eftpEstimated'),
                value: `${Math.round(eftp)}W`,
              }
            : null,
          activity.icu_efficiency_factor
            ? {
                label: t('activity.stats.efficiencyFactor'),
                value: activity.icu_efficiency_factor.toFixed(2),
              }
            : null,
          decoupling !== null
            ? {
                label: t('activity.stats.decoupling'),
                value: `${decoupling.toFixed(1)}%`,
              }
            : null,
        ].filter(Boolean) as { label: string; value: string }[],
      });
    }

    return result;
  }, [activity, wellness, fitnessImpact, t, green, amber, isDark, isMetric, maxHR]);

  return { stats };
}
