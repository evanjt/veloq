/**
 * Chart configuration types for activity detail screen
 */

import type { ActivityStreams } from '@/types';
import type { MaterialCommunityIcons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';

/** Icon name type from MaterialCommunityIcons */
type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

/** Available chart type IDs */
export type ChartTypeId =
  | 'power'
  | 'heartrate'
  | 'cadence'
  | 'speed'
  | 'pace'
  | 'elevation'
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
}

/** Chart configuration registry - labels kept short for compact chip display */
export const CHART_CONFIGS: Record<ChartTypeId, ChartConfig> = {
  power: {
    id: 'power',
    label: 'Power',
    icon: 'lightning-bolt',
    color: '#FBBF24', // Amber (power)
    streamKey: 'watts',
    unit: 'W',
    getStream: (streams) => streams.watts,
    formatValue: (v) => Math.round(v).toString(),
  },
  heartrate: {
    id: 'heartrate',
    label: 'HR',
    icon: 'heart-pulse',
    color: '#E63946',
    streamKey: 'heartrate',
    unit: 'bpm',
    getStream: (streams) => streams.heartrate,
    formatValue: (v) => Math.round(v).toString(),
  },
  cadence: {
    id: 'cadence',
    label: 'Cad',
    icon: 'rotate-3d',
    color: '#F4A261',
    streamKey: 'cadence',
    unit: 'rpm',
    getStream: (streams) => streams.cadence,
    formatValue: (v) => Math.round(v).toString(),
  },
  speed: {
    id: 'speed',
    label: 'Speed',
    icon: 'speedometer',
    color: '#2A9D8F',
    streamKey: 'velocity_smooth',
    unit: 'km/h',
    unitImperial: 'mph',
    // velocity_smooth is in m/s, convert to km/h (* 3.6)
    getStream: (streams) => streams.velocity_smooth?.map((v) => v * 3.6),
    convertToImperial: (v) => v * 0.621371, // km/h to mph
    formatValue: (v) => v.toFixed(1),
  },
  pace: {
    id: 'pace',
    label: 'Pace',
    icon: 'clock-outline',
    color: '#264653',
    unit: '/km',
    unitImperial: '/mi',
    // Pace is derived from velocity_smooth (m/s -> min/km or min/mi)
    getStream: (streams) => {
      if (!streams.velocity_smooth) return undefined;
      return streams.velocity_smooth.map((v) => (v > 0 ? 1000 / v / 60 : 0));
    },
    convertToImperial: (v) => v * 1.60934, // min/km to min/mi
    formatValue: (v) => {
      const mins = Math.floor(v);
      const secs = Math.round((v - mins) * 60);
      return `${mins}:${secs.toString().padStart(2, '0')}`;
    },
  },
  elevation: {
    id: 'elevation',
    label: 'Elev',
    icon: 'terrain',
    color: '#8B7355',
    streamKey: 'altitude',
    unit: 'm',
    unitImperial: 'ft',
    getStream: (streams) => streams.altitude,
    convertToImperial: (v) => v * 3.28084,
    formatValue: (v) => Math.round(v).toString(),
  },
  distance: {
    id: 'distance',
    label: 'Dist',
    icon: 'map-marker-distance',
    color: '#457B9D',
    unit: 'km',
    unitImperial: 'mi',
    getStream: (streams) => streams.distance?.map((d) => d / 1000),
    convertToImperial: (v) => v * 0.621371,
    formatValue: (v) => v.toFixed(2),
  },
  temp: {
    id: 'temp',
    label: 'Temp',
    icon: 'thermometer',
    color: '#E76F51',
    unit: '°C',
    unitImperial: '°F',
    convertToImperial: (v) => v * 1.8 + 32,
    formatValue: (v) => Math.round(v).toString(),
  },
  moving_time: {
    id: 'moving_time',
    label: 'Moving Time',
    icon: 'clock-outline',
    color: '#6C757D',
  },
  elapsed_time: {
    id: 'elapsed_time',
    label: 'Elapsed Time',
    icon: 'clock',
    color: '#6C757D',
  },
};

// Primary chart types to show in selector
const PRIMARY_CHART_IDS: ChartTypeId[] = [
  'power',
  'heartrate',
  'cadence',
  'speed',
  'pace',
  'elevation',
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
