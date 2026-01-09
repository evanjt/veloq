/**
 * Chart configuration types for activity detail screen
 */

import type { ActivityStreams } from '@/types';

/** Available chart type IDs */
export type ChartTypeId =
  | 'power'
  | 'heartrate'
  | 'cadence'
  | 'speed'
  | 'pace'
  | 'elevation'
  | 'distance'
  | 'altitude'
  | 'temp'
  | 'watts'
  | 'moving_time'
  | 'elapsed_time';

/** Chart type configuration */
export interface ChartConfig {
  /** Unique identifier */
  id: ChartTypeId;
  /** Display label */
  label: string;
  /** Icon name (MaterialCommunityIcons) */
  icon: any; // Using any to avoid icon type errors
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

/** Chart configuration registry */
export const CHART_CONFIGS: Record<ChartTypeId, ChartConfig> = {
  power: {
    id: 'power',
    label: 'Power',
    icon: 'lightning-bolt',
    color: '#FBBF24',
    streamKey: 'watts',
  },
  heartrate: {
    id: 'heartrate',
    label: 'Heart Rate',
    icon: 'heart-pulse',
    color: '#E63946',
    streamKey: 'heartrate',
  },
  cadence: {
    id: 'cadence',
    label: 'Cadence',
    icon: 'rotate-3d',
    color: '#F4A261',
    streamKey: 'cadence',
  },
  speed: {
    id: 'speed',
    label: 'Speed',
    icon: 'speedometer',
    color: '#2A9D8F',
    streamKey: 'velocity_smooth',
  },
  pace: {
    id: 'pace',
    label: 'Pace',
    icon: 'clock-outline',
    color: '#264653',
  },
  elevation: {
    id: 'elevation',
    label: 'Elevation',
    icon: 'terrain',
    color: '#8B7355',
    streamKey: 'altitude',
  },
  distance: {
    id: 'distance',
    label: 'Distance',
    icon: 'map-marker-distance',
    color: '#457B9D',
  },
  altitude: {
    id: 'altitude',
    label: 'Altitude',
    icon: 'image-filter-hdr',
    color: '#8B7355',
    streamKey: 'altitude',
  },
  temp: {
    id: 'temp',
    label: 'Temperature',
    icon: 'thermometer',
    color: '#E76F51',
  },
  watts: {
    id: 'watts',
    label: 'Watts',
    icon: 'lightning-bolt',
    color: '#FBBF24',
    streamKey: 'watts',
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

/**
 * Get available chart types based on activity streams
 */
export function getAvailableCharts(streams: ActivityStreams): ChartConfig[] {
  const available: ChartConfig[] = [];

  // Check each chart type
  Object.values(CHART_CONFIGS).forEach((config) => {
    // If stream key is defined, check if data exists
    if (config.streamKey) {
      const data = streams[config.streamKey as keyof ActivityStreams];
      if (data && data.length > 0) {
        available.push(config);
      }
    } else {
      // Chart types without stream key (derived metrics) are always available
      available.push(config);
    }
  });

  return available;
}
