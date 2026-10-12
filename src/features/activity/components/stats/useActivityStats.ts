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
  formatCalorieRate,
  formatCalories,
  formatDuration,
  formatHeartRate,
  formatHrv,
  formatPower,
  formatSpeed,
  formatTemperature,
} from '@/shared/format/format';
import {
  formZoneFromLoads,
  formatForm,
  formZoneTextColor,
  formZoneLabel,
} from '@/features/fitness';
import { storedDecoupling } from '@/features/activity/lib/decoupling';
import type { Activity, WellnessData } from '@/types';
import { MaxHrSource, type ActivityFitnessImpact } from 'veloqrs';
import type { StatDetail } from './types';
import type { ActivityNewGround } from '../../hooks/useActivitySectionHighlights';
import { colors, darkColors } from '@/theme';
import { FEELS_LIKE_THRESHOLD } from '@/constants';
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
  /**
   * The max HR the zones chart divides by, from the detail screen read. Without
   * one the heart rate card carries no percent of max.
   */
  maxHR?: number | undefined;
  /**
   * Where `maxHR` came from. A percent against the engine's default is named
   * as one, so it never reads as the athlete's own.
   */
  maxHrSource?: MaxHrSource | undefined;
  fitnessImpact?: ActivityFitnessImpact | null | undefined;
  /** Tile coverage against earlier activities; the card is left out without it. */
  newGround?: ActivityNewGround | undefined;
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
  maxHrSource,
  fitnessImpact,
  newGround,
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
      // The intensity factor is stated, never graded: a band word or a colour
      // per band would be a judgement the data source does not make.
      const intensity = activity.icu_intensity;

      result.push({
        title: t('metrics.trainingLoad'),
        value: `${Math.round(load)}`,
        icon: 'lightning-bolt',
        color: isDark ? darkColors.chartGoldText : colors.chartGoldText,
        context:
          intensity == null
            ? undefined
            : t('activity.stats.intensityContext', { percent: Math.round(intensity) }),
        explanation: t(METRIC_EXPLANATION_KEYS['Training Load'] as never),
        details: [
          intensity == null
            ? null
            : {
                label: t('activity.stats.intensityFactor'),
                value: `${Math.round(intensity)}%`,
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
                label: t('activity.stats.fitnessThatDay'),
                value: `${Math.round(wellness.ctl)}`,
              }
            : null,
          wellness?.atl
            ? {
                label: t('activity.stats.fatigueThatDay'),
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

    // What it measures is tile coverage, so the card says that and never
    // metres of new road.
    if (newGround) {
      result.push({
        title: t('activity.stats.newGround'),
        // Floored, so a ride one tile short of entirely new does not read 100%.
        value: `${Math.floor(newGround.fraction * 100)}%`,
        icon: 'compass-outline',
        color: green,
        context: t('activity.stats.newGroundContext'),
        explanation: t('activity.explanations.newGround'),
        details: [
          { label: t('activity.stats.newGroundTiles'), value: `${newGround.tiles}` },
          { label: t('activity.stats.newGroundNewTiles'), value: `${newGround.newTiles}` },
        ],
      });
    }

    // Heart Rate with % of max context
    const avgHRValue = activity.average_heartrate;
    const maxHRValue = activity.max_heartrate;
    if (avgHRValue) {
      const hrPercent = maxHR ? Math.round((avgHRValue / maxHR) * 100) : null;
      const ownMax =
        maxHrSource === MaxHrSource.ActivityZones || maxHrSource === MaxHrSource.SportSettings;

      result.push({
        title: t('activity.heartRate'),
        value: `${Math.round(avgHRValue)}`,
        unit: t('units.bpm'),
        icon: 'heart-pulse',
        color: isDark ? darkColors.chartPinkText : colors.chartPinkText,
        context:
          hrPercent === null
            ? undefined
            : ownMax
              ? t('activity.stats.percentOfMaxHR', { percent: hrPercent })
              : t('activity.stats.percentOfDefaultMaxHR', { percent: hrPercent, value: maxHR }),
        explanation: t(METRIC_EXPLANATION_KEYS['Heart Rate'] as never),
        details: [
          {
            label: t('activity.stats.average'),
            value: formatHeartRate(avgHRValue),
          },
          maxHRValue
            ? {
                label: t('activity.stats.maxLabel'),
                value: formatHeartRate(maxHRValue),
              }
            : null,
          hrPercent === null
            ? null
            : {
                label: ownMax
                  ? t('activity.stats.percentOfMaxHRLabel')
                  : t('activity.stats.percentOfDefaultMaxHRLabel', { value: maxHR }),
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
                label: t('activity.stats.restingHRThatDay'),
                value: formatHeartRate(wellness.restingHR),
              }
            : null,
          wellness?.hrv
            ? {
                label: t('activity.stats.hrvThatDay'),
                value: formatHrv(wellness.hrv),
              }
            : null,
        ].filter(Boolean) as { label: string; value: string }[],
      });
    }

    // Calories
    if (activity.calories && activity.calories > 0) {
      // moving_time can be 0 (manual indoor entries), so gate the burn rate to
      // avoid rendering "Infinity kcal/h".
      const burnRate =
        activity.moving_time > 0
          ? formatCalorieRate((activity.calories / activity.moving_time) * 3600)
          : undefined;
      result.push({
        title: t('activity.stats.energy'),
        value: `${Math.round(activity.calories)}`,
        unit: t('units.kcal'),
        icon: 'fire',
        color: amber,
        context: burnRate,
        explanation: t(METRIC_EXPLANATION_KEYS['Energy'] as never),
        details: [
          {
            label: t('activity.stats.caloriesBurned'),
            value: formatCalories(activity.calories),
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
        color: isDark ? darkColors.infoText : colors.infoText,
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
      const form = formFromLoads(wellness.ctl, wellness.atl);
      const fitness = Math.round(wellness.ctl);
      const asPercent = formAsPercent();
      const formZone = formZoneFromLoads(wellness.ctl, wellness.atl, asPercent);
      const formColor = formZone
        ? formZoneTextColor(formZone, isDark)
        : isDark
          ? darkColors.textPrimary
          : colors.textPrimary;
      const formText = `${form > 0 ? '+' : ''}${form}`;
      const formValue = formatForm(form, fitness, asPercent) ?? '';

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
            value: `${fitness}`,
          },
          {
            label: t('activity.stats.fatigueATL'),
            value: `${Math.round(wellness.atl)}`,
          },
          wellness.hrv
            ? {
                label: t('metrics.hrv'),
                value: formatHrv(wellness.hrv),
              }
            : null,
          wellness.sleepScore
            ? {
                label: t('activity.stats.sleepScore'),
                value: `${Math.round(wellness.sleepScore)}`,
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
        unit: t('units.watts'),
        icon: 'lightning-bolt-circle',
        color: isDark ? darkColors.chartPurpleText : colors.chartPurpleText,
        context: eftp
          ? t('activity.stats.eftpContext', { value: formatPower(eftp) })
          : activity.icu_pm_p_max
            ? t('activity.stats.max', { value: formatPower(activity.icu_pm_p_max) })
            : undefined,
        explanation: eftp
          ? `${t(METRIC_EXPLANATION_KEYS['Power'] as never)} ${t('activity.explanations.activityEftp')}`
          : t(METRIC_EXPLANATION_KEYS['Power'] as never),
        details: [
          {
            label: t('activity.stats.average'),
            value: formatPower(avgPower),
          },
          activity.icu_pm_p_max
            ? {
                label: t('activity.stats.maxLabel'),
                value: formatPower(activity.icu_pm_p_max),
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
                value: formatPower(eftp),
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
  }, [
    activity,
    wellness,
    fitnessImpact,
    newGround,
    t,
    green,
    amber,
    isDark,
    isMetric,
    maxHR,
    maxHrSource,
  ]);

  return { stats };
}
