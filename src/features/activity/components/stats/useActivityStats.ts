/**
 * The stat cards on the activity detail screen: training load, speed or pace,
 * heart rate, cadence, energy, conditions, form and power.
 *
 * Each card carries a context line under its value. A metric with no data is
 * left out rather than shown empty, so two activities rarely carry the same
 * set of cards.
 */
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { isPaceSport, isSwimmingActivity } from '@/shared/activity/activityUtils';
import {
  formatCalorieRate,
  formatCalories,
  formatDuration,
  formatHeartRate,
  formatHrv,
  formatPower,
  formatSpeed,
  formatSportSpeed,
  formatTemperature,
} from '@/shared/format/format';
import { formZoneFromLoads, formatForm, formZoneLabel } from '@/features/fitness';
import { cadenceUnitLabel } from '@/features/activity/lib/cadenceUnit';
import { toActivityType, type WellnessData } from '@/types';
import {
  MaxHrSource,
  type ActivityFitnessImpact,
  type ActivityRecord,
  type ActivitySummary,
} from 'veloqrs';
import type { StatDetail } from './types';
import type { ActivityNewGround } from '../../hooks/useActivitySectionHighlights';
import { FEELS_LIKE_THRESHOLD } from '@/constants';
import { useFormPreference } from '@/shared/app/FormPreferenceStore';
import { formFromLoads } from '@/shared/math';
import { formatDecimal, formatPercent, formatSigned } from '@/shared/format';

// Explanation keys for each metric - educational, not interpretive
const METRIC_EXPLANATION_KEYS: Record<string, string> = {
  'Training Load': 'activity.explanations.trainingLoad',
  'Heart Rate': 'activity.explanations.heartRate',
  Speed: 'activity.explanations.speed',
  Pace: 'activity.explanations.pace',
  Cadence: 'activity.explanations.cadence',
  Energy: 'activity.explanations.energy',
  Conditions: 'activity.explanations.conditions',
  'Your Form': 'activity.explanations.yourForm',
  Power: 'activity.explanations.power',
};

interface UseActivityStatsOptions {
  activity: ActivityRecord;
  wellness?: WellnessData | null | undefined;
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
  /**
   * The summary the detail read took from the stored activity: speed, times and
   * cadence. The cards it feeds are left out until the read lands.
   */
  summary?: ActivitySummary | undefined;
}

interface UseActivityStatsResult {
  stats: StatDetail[];
}

export function useActivityStats({
  activity,
  wellness,
  isMetric,
  maxHR,
  maxHrSource,
  fitnessImpact,
  newGround,
  summary,
}: UseActivityStatsOptions): UseActivityStatsResult {
  const { t } = useTranslation();
  // Subscribed, so the form card follows the setting when the athlete record
  // lands after this screen has mounted.
  const asPercent = useFormPreference((s) => s.formAsPercent) === true;

  // Build insightful stats (memoized to prevent rebuild on every render)
  const stats = useMemo(() => {
    const result: StatDetail[] = [];

    // Training Load with context
    if (activity.trainingLoad && activity.trainingLoad > 0) {
      const load = activity.trainingLoad;
      // The intensity factor is stated, never graded: a band word or a colour
      // per band would be a judgement the data source does not make.
      const intensity = activity.intensity;

      result.push({
        title: t('metrics.trainingLoad'),
        value: `${Math.round(load)}`,
        icon: 'lightning-bolt',
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
          activity.strainScore
            ? {
                label: t('activity.stats.strain'),
                value: `${Math.round(activity.strainScore)}`,
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
      result.push({
        title: t('activity.stats.fitnessImpact'),
        value: formatSigned(fitnessImpact.fitness, 1),
        icon: 'chart-line',
        context: t('activity.stats.fitnessImpactContext'),
        explanation: t('activity.explanations.fitnessImpact', {
          fitnessDays: fitnessImpact.fitnessDays,
          fatigueDays: fitnessImpact.fatigueDays,
        }),
        details: [
          { label: t('activity.stats.fitnessCTL'), value: formatSigned(fitnessImpact.fitness, 1) },
          { label: t('activity.stats.fatigueATL'), value: formatSigned(fitnessImpact.fatigue, 1) },
          { label: t('activity.stats.formTSB'), value: formatSigned(fitnessImpact.form, 1) },
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
        context: t('activity.stats.newGroundContext'),
        explanation: t('activity.explanations.newGround'),
        details: [
          { label: t('activity.stats.newGroundTiles'), value: `${newGround.tiles}` },
          { label: t('activity.stats.newGroundNewTiles'), value: `${newGround.newTiles}` },
        ],
      });
    }

    // Speed, or pace for a sport read in pace. Both come from the stored
    // summary, so a ride whose streams were never fetched still shows them.
    const avgSpeed = summary?.averageSpeed;
    if (avgSpeed != null) {
      const maxSpeed = summary?.maxSpeed;
      const sport = toActivityType(activity.sportType);
      // The sports `formatSportSpeed` reads as a pace.
      const metric = isPaceSport(sport) || isSwimmingActivity(sport) ? 'Pace' : 'Speed';
      const formatted = (speed: number) => formatSportSpeed(speed, sport, isMetric);
      result.push({
        title: metric === 'Speed' ? t('activity.stats.speed') : t('activity.stats.pace'),
        value: formatted(avgSpeed),
        icon: 'speedometer',
        stream: metric === 'Speed' ? 'speed' : 'pace',
        context:
          maxSpeed == null ? undefined : t('activity.stats.max', { value: formatted(maxSpeed) }),
        explanation: t(METRIC_EXPLANATION_KEYS[metric] as never),
        details: [
          { label: t('activity.stats.average'), value: formatted(avgSpeed) },
          maxSpeed == null
            ? null
            : { label: t('activity.stats.maxLabel'), value: formatted(maxSpeed) },
          summary?.movingTime == null
            ? null
            : {
                label: t('activity.stats.movingTime'),
                value: formatDuration(summary.movingTime),
              },
          summary?.elapsedTime == null
            ? null
            : {
                label: t('activity.stats.elapsedTime'),
                value: formatDuration(summary.elapsedTime),
              },
        ].filter(Boolean) as { label: string; value: string }[],
      });
    }

    // Heart Rate with % of max context
    const avgHRValue = activity.avgHr;
    const maxHRValue = activity.maxHr;
    if (avgHRValue) {
      const hrPercent = maxHR ? Math.round((avgHRValue / maxHR) * 100) : null;
      const ownMax =
        maxHrSource === MaxHrSource.ActivityZones || maxHrSource === MaxHrSource.SportSettings;

      result.push({
        title: t('activity.heartRate'),
        value: `${Math.round(avgHRValue)}`,
        unit: t('units.bpm'),
        icon: 'heart-pulse',
        stream: 'heartrate',
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
          activity.hrRecovery != null
            ? {
                label: t('activity.stats.hrRecovery'),
                value: t('activity.stats.bpmDrop', {
                  value: activity.hrRecovery,
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

    // Cadence comes in the unit the engine gives the sport's cadence in.
    const cadence = summary?.averageCadence;
    if (summary && cadence != null) {
      const cadenceUnit =
        cadenceUnitLabel(summary.cadenceUnit) === 'rpm' ? t('units.rpm') : t('units.spm');
      result.push({
        title: t('activity.stats.cadence'),
        value: `${Math.round(cadence)}`,
        unit: cadenceUnit,
        icon: 'rotate-3d',
        stream: 'cadence',
        explanation: t(METRIC_EXPLANATION_KEYS['Cadence'] as never),
        details: [
          { label: t('activity.stats.average'), value: `${Math.round(cadence)} ${cadenceUnit}` },
        ],
      });
    }

    // Calories
    if (activity.calories && activity.calories > 0) {
      // moving_time can be 0 (manual indoor entries), so gate the burn rate to
      // avoid rendering "Infinity kcal/h".
      const burnRate =
        activity.movingTime > 0
          ? formatCalorieRate((activity.calories / activity.movingTime) * 3600)
          : undefined;
      result.push({
        title: t('activity.stats.energy'),
        value: `${Math.round(activity.calories)}`,
        unit: t('units.kcal'),
        icon: 'fire',
        context: burnRate,
        explanation: t(METRIC_EXPLANATION_KEYS['Energy'] as never),
        details: [
          {
            label: t('activity.stats.caloriesBurned'),
            value: formatCalories(activity.calories),
          },
          {
            label: t('activity.stats.movingTime'),
            value: formatDuration(activity.movingTime),
          },
          ...(summary?.elapsedTime != null
            ? [
                {
                  label: t('activity.stats.elapsedTime'),
                  value: formatDuration(summary.elapsedTime),
                },
              ]
            : []),
          ...(burnRate ? [{ label: t('activity.stats.burnRate'), value: burnRate }] : []),
        ],
      });
    }

    // Temperature/Conditions
    const temp = activity.weatherTemp ?? activity.sensorTemp;
    if (temp != null) {
      // Build context from available weather data
      const conditionParts: string[] = [];
      const feelsLike = activity.feelsLike;
      if (feelsLike != null && Math.abs(feelsLike - temp) >= FEELS_LIKE_THRESHOLD) {
        conditionParts.push(
          t('activity.stats.feelsLike', {
            temp: formatTemperature(feelsLike, isMetric),
          })
        );
      }
      if (activity.windSpeed != null && activity.windSpeed > 2) {
        conditionParts.push(
          t('activity.stats.windSpeed', {
            speed: formatSpeed(activity.windSpeed, isMetric),
          })
        );
      }
      const contextStr =
        conditionParts.length > 0
          ? conditionParts.join(', ')
          : activity.hasWeather
            ? t('activity.stats.weatherData')
            : t('activity.stats.deviceSensor');

      result.push({
        title: t('activity.stats.conditions'),
        value: formatTemperature(temp, isMetric),
        icon: activity.hasWeather ? 'weather-partly-cloudy' : 'thermometer',
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
          activity.windSpeed != null
            ? {
                label: t('activity.stats.wind'),
                value: formatSpeed(activity.windSpeed, isMetric),
              }
            : null,
        ].filter(Boolean) as { label: string; value: string }[],
      });
    }

    // Form from wellness (TSB = CTL - ATL)
    if (wellness?.ctl != null && wellness?.atl != null) {
      const form = formFromLoads(wellness.ctl, wellness.atl);
      const fitness = Math.round(wellness.ctl);
      const formZone = formZoneFromLoads(wellness.ctl, wellness.atl, asPercent);
      const formText = `${form > 0 ? '+' : ''}${form}`;
      const formValue = formatForm(form, fitness, asPercent) ?? '';

      result.push({
        title: t('activity.stats.yourForm'),
        value: formValue,
        icon: 'account-heart',
        // The tile carries no zone colour, so the context names the zone.
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
    const avgPower = activity.avgPower;
    if (avgPower && avgPower > 0) {
      const eftp = activity.eftp;
      const decoupling = activity.decoupling;
      result.push({
        title: t('activity.power'),
        value: `${Math.round(avgPower)}`,
        unit: t('units.watts'),
        icon: 'lightning-bolt-circle',
        stream: 'power',
        context: eftp
          ? t('activity.stats.eftpContext', { value: formatPower(eftp) })
          : activity.maxPower
            ? t('activity.stats.max', { value: formatPower(activity.maxPower) })
            : undefined,
        explanation: eftp
          ? t('common.sentencePair', {
              first: t(METRIC_EXPLANATION_KEYS['Power'] as never),
              second: t('activity.explanations.activityEftp'),
            })
          : t(METRIC_EXPLANATION_KEYS['Power'] as never),
        details: [
          {
            label: t('activity.stats.average'),
            value: formatPower(avgPower),
          },
          activity.maxPower
            ? {
                label: t('activity.stats.maxLabel'),
                value: formatPower(activity.maxPower),
              }
            : null,
          activity.ftp
            ? {
                label: t('activity.stats.percentOfFTP'),
                value: `${Math.round((avgPower / activity.ftp) * 100)}%`,
              }
            : null,
          eftp
            ? {
                label: t('activity.stats.eftpEstimated'),
                value: formatPower(eftp),
              }
            : null,
          activity.efficiencyFactor
            ? {
                label: t('activity.stats.efficiencyFactor'),
                value: formatDecimal(activity.efficiencyFactor, 2),
              }
            : null,
          decoupling != null
            ? {
                label: t('activity.stats.decoupling'),
                value: formatPercent(decoupling, 1),
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
    summary,
    t,
    isMetric,
    maxHR,
    maxHrSource,
    asPercent,
  ]);

  return { stats };
}
