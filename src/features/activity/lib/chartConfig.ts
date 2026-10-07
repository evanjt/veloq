/**
 * Chart configuration types for activity detail screen
 */

import type { ActivityStreams, ActivityType } from '@/types';
import type { MaterialCommunityIcons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import {
  celsiusToFahrenheit,
  formatMinSec,
  KM_TO_MI,
  M_TO_FT,
  MPS_TO_KPH,
  YARDS_100_IN_METRES,
} from '@/shared/format/format';
import { isSwimmingActivity } from '@/shared/activity/activityUtils';
import { paceMinutesFromSample } from '@/shared/math/kinematics';
import { chartStreamColors, chartInkColor } from '@/theme';
import { DEFAULT_AUTO_PAUSE_KMH, stoppedSpeedMs } from '@/shared/recording';

// Used when no activity is loaded: the lowest stop speed, walking's.
const FLOOR_STOPPED_MS = DEFAULT_AUTO_PAUSE_KMH.walking / 3.6;

/** Icon name type from MaterialCommunityIcons */
type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

/** Available chart type IDs */
export type ChartTypeId =
  | 'power'
  | 'heartrate'
  | 'cadence'
  | 'speed'
  | 'pace'
  | 'gap'
  | 'elevation'
  | 'grade'
  | 'wbal'
  | 'distance'
  | 'temp'
  | 'moving_time'
  | 'elapsed_time';

/** Chart type configuration */
export interface ChartConfig {
  /** Unique identifier */
  id: ChartTypeId;
  /** Display label */
  label: string;
  /** Icon name (MaterialCommunityIcons) */
  icon: IconName;
  /** Display color */
  color: string;
  /** Ink drawn over the colour when it fills a chip */
  ink: string;
  /** Stream key in activity data */
  streamKey?: string;
  /** Unit (metric/imperial) */
  unit?: string;
  /** Imperial unit */
  unitImperial?: string;
  /** Metric unit */
  unitMetric?: string;
  /** Get stream from activity data */
  getStream?: (streams: ActivityStreams) => number[] | undefined;
  /** Convert value to imperial units */
  convertToImperial?: (value: number) => number;
  /** Format value for display */
  formatValue?: (value: number, metric: boolean) => string;
  /** How to compute the default chip value. Default: 'avg' */
  defaultMetric?: 'avg' | 'gain';
  /**
   * A speed series in km/h, or a pace series in minutes per `perMetres`. Its
   * average is taken over moving samples as the mean speed, and a pace series
   * also leaves stops out of its y extent, since a stop reads as pace 0.
   */
  motion?: ({ kind: 'speed' } | { kind: 'pace'; perMetres: number }) & {
    /** Speed (m/s) under which a sample is a stop. */
    stoppedBelowMs: number;
  };
}

/** Chart configuration registry - labels kept short for compact chip display */
export const CHART_CONFIGS: Record<ChartTypeId, ChartConfig> = {
  power: {
    id: 'power',
    label: 'Power',
    icon: 'lightning-bolt',
    color: chartStreamColors.power,
    ink: chartInkColor('power'),
    streamKey: 'watts',
    unit: 'W',
    getStream: (streams) => streams.watts,
    formatValue: (v) => Math.round(v).toString(),
  },
  heartrate: {
    id: 'heartrate',
    label: 'HR',
    icon: 'heart-pulse',
    color: chartStreamColors.heartrate,
    ink: chartInkColor('heartrate'),
    streamKey: 'heartrate',
    unit: 'bpm',
    getStream: (streams) => streams.heartrate,
    formatValue: (v) => Math.round(v).toString(),
  },
  cadence: {
    id: 'cadence',
    label: 'Cad',
    icon: 'rotate-3d',
    color: chartStreamColors.cadence, // Distinct from amber power
    ink: chartInkColor('cadence'),
    streamKey: 'cadence',
    unit: 'rpm',
    getStream: (streams) => streams.cadence,
    formatValue: (v) => Math.round(v).toString(),
  },
  speed: {
    id: 'speed',
    label: 'Speed',
    icon: 'speedometer',
    color: chartStreamColors.speed,
    ink: chartInkColor('speed'),
    streamKey: 'velocity_smooth',
    unit: 'km/h',
    unitImperial: 'mph',
    // velocity_smooth is in m/s
    getStream: (streams) => streams.velocity_smooth?.map((v) => v * MPS_TO_KPH),
    convertToImperial: (v) => v * KM_TO_MI, // km/h to mph
    formatValue: (v) => v.toFixed(1),
    motion: { kind: 'speed', stoppedBelowMs: FLOOR_STOPPED_MS },
  },
  pace: {
    id: 'pace',
    label: 'Pace',
    icon: 'clock-outline',
    color: chartStreamColors.pace, // Visible on dark backgrounds
    ink: chartInkColor('pace'),
    unit: '/km',
    unitImperial: '/mi',
    // Pace is derived from velocity_smooth (m/s -> min/km or min/mi)
    getStream: (streams) => {
      if (!streams.velocity_smooth) return undefined;
      return streams.velocity_smooth.map((v) => paceMinutesFromSample(v));
    },
    convertToImperial: (v) => v / KM_TO_MI, // min/km to min/mi
    formatValue: (v) => formatMinSec(v * 60),
    motion: { kind: 'pace', perMetres: 1000, stoppedBelowMs: FLOOR_STOPPED_MS },
  },
  elevation: {
    id: 'elevation',
    label: 'Elev',
    icon: 'terrain',
    color: chartStreamColors.elevation, // Pops on both light/dark
    ink: chartInkColor('elevation'),
    streamKey: 'altitude',
    unit: 'm',
    unitImperial: 'ft',
    getStream: (streams) => streams.altitude,
    convertToImperial: (v) => v * M_TO_FT,
    formatValue: (v) => Math.round(v).toString(),
    defaultMetric: 'gain',
  },
  grade: {
    id: 'grade',
    label: 'Grade',
    icon: 'slope-uphill',
    color: chartStreamColors.grade,
    ink: chartInkColor('grade'),
    streamKey: 'grade_smooth',
    unit: '%',
    getStream: (streams) => streams.grade_smooth,
    formatValue: (v) => v.toFixed(1),
  },
  wbal: {
    id: 'wbal',
    label: "W'bal",
    icon: 'flash-outline',
    color: chartStreamColors.wbal,
    ink: chartInkColor('wbal'),
    unit: 'kJ',
    // Sourced from intervals.icu's `w_bal` stream (joules). Displayed in kJ.
    getStream: (streams) => streams.wbal?.map((j) => j / 1000),
    formatValue: (v) => Math.round(v).toString(),
  },
  gap: {
    id: 'gap',
    label: 'GAP',
    icon: 'trending-up',
    color: chartStreamColors.gap,
    ink: chartInkColor('gap'),
    unit: '/km',
    unitImperial: '/mi',
    // Sourced from intervals.icu's `ga_velocity` stream (m/s), converted to
    // min/km at parse time.
    getStream: (streams) => streams.gap,
    convertToImperial: (v) => v / KM_TO_MI,
    formatValue: (v) => formatMinSec(v * 60),
    motion: { kind: 'pace', perMetres: 1000, stoppedBelowMs: FLOOR_STOPPED_MS },
  },
  distance: {
    id: 'distance',
    label: 'Dist',
    icon: 'map-marker-distance',
    color: chartStreamColors.distance,
    ink: chartInkColor('distance'),
    unit: 'km',
    unitImperial: 'mi',
    getStream: (streams) => streams.distance?.map((d) => d / 1000),
    convertToImperial: (v) => v * KM_TO_MI,
    formatValue: (v) => v.toFixed(2),
  },
  temp: {
    id: 'temp',
    label: 'Temp',
    icon: 'thermometer',
    color: chartStreamColors.temp,
    ink: chartInkColor('temp'),
    streamKey: 'temp',
    unit: '°C',
    unitImperial: '°F',
    getStream: (streams) => streams.temp,
    convertToImperial: celsiusToFahrenheit,
    formatValue: (v) => Math.round(v).toString(),
  },
  moving_time: {
    id: 'moving_time',
    label: 'Moving Time',
    icon: 'clock-outline',
    color: chartStreamColors.time,
    ink: chartInkColor('time'),
  },
  elapsed_time: {
    id: 'elapsed_time',
    label: 'Elapsed Time',
    icon: 'clock',
    color: chartStreamColors.time,
    ink: chartInkColor('time'),
  },
};

// Primary chart types to show in selector
const PRIMARY_CHART_IDS: ChartTypeId[] = [
  'power',
  'heartrate',
  'cadence',
  'speed',
  'pace',
  'gap',
  'elevation',
  'grade',
  'wbal',
  'temp',
];

/**
 * Get available chart types based on activity streams
 * Only returns primary charts that have actual data to display
 */
export function getAvailableCharts(streams: ActivityStreams): ChartConfig[] {
  const available: ChartConfig[] = [];

  // Only check primary chart types (excludes duplicates like watts, altitude)
  for (const chartId of PRIMARY_CHART_IDS) {
    const config = CHART_CONFIGS[chartId];
    if (!config) continue;

    // Use getStream to check if data exists
    if (config.getStream) {
      const data = config.getStream(streams);
      if (data && data.length > 0) {
        available.push(config);
      }
    } else if (config.streamKey) {
      // Fallback to streamKey check
      const data = streams[config.streamKey as keyof ActivityStreams];
      if (data && Array.isArray(data) && data.length > 0) {
        available.push(config);
      }
    }
  }

  return available;
}

/** Swim pace per 100 m, per 100 yd for an imperial athlete. */
const SWIM_PACE_CONFIG: ChartConfig = {
  ...CHART_CONFIGS.pace,
  unit: '/100m',
  unitImperial: '/100yd',
  getStream: (streams) => streams.velocity_smooth?.map((v) => paceMinutesFromSample(v, 100)),
  convertToImperial: (v) => (v * YARDS_100_IN_METRES) / 100,
  motion: { kind: 'pace', perMetres: 100, stoppedBelowMs: FLOOR_STOPPED_MS },
};

const SWIM_CHART_CONFIGS: Record<ChartTypeId, ChartConfig> = {
  ...CHART_CONFIGS,
  pace: SWIM_PACE_CONFIG,
};

function withStopSpeed(
  configs: Record<ChartTypeId, ChartConfig>,
  stoppedBelowMs: number
): Record<ChartTypeId, ChartConfig> {
  const out = { ...configs };
  for (const id of Object.keys(out) as ChartTypeId[]) {
    const motion = out[id].motion;
    if (motion) out[id] = { ...out[id], motion: { ...motion, stoppedBelowMs } };
  }
  return out;
}

const configsByStopSpeed = new Map<string, Record<ChartTypeId, ChartConfig>>();

/**
 * The chart configs for a sport: a swim reads pace per 100 rather than per km,
 * and the speed and pace series treat a sample under the sport's auto-pause
 * default as a stop. Memoised so the identity is stable across renders.
 */
export function chartConfigsFor(type: ActivityType): Record<ChartTypeId, ChartConfig> {
  const swim = isSwimmingActivity(type);
  const stoppedBelowMs = stoppedSpeedMs(type);
  const key = `${swim ? 'swim' : 'base'}:${stoppedBelowMs}`;
  let configs = configsByStopSpeed.get(key);
  if (!configs) {
    configs = withStopSpeed(swim ? SWIM_CHART_CONFIGS : CHART_CONFIGS, stoppedBelowMs);
    configsByStopSpeed.set(key, configs);
  }
  return configs;
}
