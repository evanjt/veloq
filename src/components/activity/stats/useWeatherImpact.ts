/**
 * @fileoverview useWeatherImpact - Weather/conditions metrics
 *
 * Computes weather impact with temperature, feels like, wind, and humidity.
 */

import type { Activity } from '@/types';
import type { StatDetail } from './types';
import { colors } from '@/theme/colors';
import { TEMPERATURE_THRESHOLDS, FEELS_LIKE_THRESHOLD } from '@/constants';
import { WIND_THRESHOLDS } from '@/constants';
import { createMetricHook } from './createMetricHook';

interface UseWeatherImpactOptions {
  activity: Activity;
}

/**
 * Compute weather impact metrics.
 *
 * Returns a StatDetail with:
 * - Primary value: Average temperature
 * - Context: Feels like, wind speed, humidity
 * - Details: Weather conditions
 *
 * Temperature color coding:
 * - Amber (>28C): Hot
 * - Blue (<10C): Cold
 * - Default: Neutral
 *
 * @example
 * ```tsx
 * const weather = useWeatherImpact({ activity });
 *
 * if (weather.stat) {
 *   return <StatCard stat={weather.stat} />;
 * }
 * ```
 */
export const useWeatherImpact = createMetricHook<UseWeatherImpactOptions>({
  name: 'useWeatherImpact',

  compute: ({ activity }, t) => {
    // Get temperature from device or API
    const temp = activity.average_weather_temp || activity.average_temp;
    if (temp === null || temp === undefined) {
      return null;
    }

    const tempRounded = Math.round(temp);
    const feelsLike = activity.apparent_temperature || activity.average_temp_feels_like;

    // Determine color based on temperature
    const isHot = temp > TEMPERATURE_THRESHOLDS.HOT;
    const isCold = temp < TEMPERATURE_THRESHOLDS.COLD;
    const color = isHot ? '#F59E0B' : isCold ? '#3B82F6' : colors.textPrimary;

    // Build context string
    const contextParts: string[] = [];
    if (isHot) contextParts.push(t('activity.conditions.hot'));
    if (isCold) contextParts.push(t('activity.conditions.cold'));

    // Build details array
    const details: StatDetail['details'] = [];

    // Add feels like if significantly different
    if (feelsLike && feelsLike !== temp && Math.abs(feelsLike - temp) > FEELS_LIKE_THRESHOLD) {
      details.push({
        label: t('activity.stats.feelsLike'),
        value: `${Math.round(feelsLike)}°C`,
      });
    }

    // Add wind if significant
    const avgWind = activity.average_wind_speed;
    if (avgWind && avgWind > WIND_THRESHOLDS.DISPLAY_MIN) {
      details.push({
        label: t('activity.stats.wind'),
        value: `${Math.round(avgWind)} m/s`,
      });
    }

    // Add humidity if available
    if (activity.average_weather_humidity) {
      details.push({
        label: t('activity.stats.humidity'),
        value: `${Math.round(activity.average_weather_humidity)}%`,
      });
    }

    const icon = isHot
      ? ('weather-sunny' as const)
      : isCold
        ? ('snowflake' as const)
        : ('thermometer' as const);

    return {
      title: t('activity.stats.conditions'),
      value: `${tempRounded}°C`,
      icon,
      color,
      context: contextParts.length > 0 ? contextParts.join(', ') : undefined,
      explanation: t('activity.explanations.conditions'),
      details: details.length > 0 ? details : undefined,
    };
  },

  getDeps: ({ activity }) => [
    activity.average_weather_temp,
    activity.average_temp,
    activity.apparent_temperature,
    activity.average_temp_feels_like,
    activity.average_wind_speed,
    activity.average_weather_humidity,
  ],
});
