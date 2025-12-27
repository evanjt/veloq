import type { ActivityStreams } from '@/types';
import type { MaterialIconName } from './activityUtils';

export type ChartTypeId = 'elevation' | 'heartrate' | 'power' | 'pace' | 'cadence' | 'speed' | 'grade';

export interface ChartConfig {
  id: ChartTypeId;
  label: string;
  unit: string;
  unitImperial?: string;
  icon: MaterialIconName;
  color: string;
  getStream: (streams: ActivityStreams) => number[] | undefined;
  formatValue?: (value: number, isMetric: boolean) => string;
  convertToImperial?: (value: number) => number;
}

// Calculate instantaneous pace from distance and time streams
// Returns pace in seconds per kilometer
function calculatePaceStream(streams: ActivityStreams): number[] | undefined {
  const { distance, time } = streams;
  if (!distance || !time || distance.length < 2) return undefined;

  const paceData: number[] = [];
  const windowSize = 5; // Smooth over 5 points to reduce noise

  for (let i = 0; i < distance.length; i++) {
    // Use a rolling window for smoother pace
    const startIdx = Math.max(0, i - windowSize);
    const endIdx = Math.min(distance.length - 1, i + windowSize);

    const distDelta = distance[endIdx] - distance[startIdx]; // meters
    const timeDelta = time[endIdx] - time[startIdx]; // seconds

    if (distDelta > 0 && timeDelta > 0) {
      // Convert to seconds per kilometer
      const paceSecsPerKm = (timeDelta / distDelta) * 1000;
      // Cap at reasonable values (2-20 min/km)
      paceData.push(Math.min(1200, Math.max(120, paceSecsPerKm)));
    } else {
      // Use previous value or default
      paceData.push(paceData.length > 0 ? paceData[paceData.length - 1] : 360);
    }
  }

  return paceData;
}

// Calculate grade/gradient from altitude and distance streams
// Returns grade as percentage
function calculateGradeStream(streams: ActivityStreams): number[] | undefined {
  const { altitude, distance } = streams;
  if (!altitude || !distance || altitude.length < 2) return undefined;

  const gradeData: number[] = [];
  const windowSize = 10; // Larger window for smoother grade

  for (let i = 0; i < altitude.length; i++) {
    const startIdx = Math.max(0, i - windowSize);
    const endIdx = Math.min(altitude.length - 1, i + windowSize);

    const altDelta = altitude[endIdx] - altitude[startIdx]; // meters
    const distDelta = distance[endIdx] - distance[startIdx]; // meters

    if (distDelta > 5) { // Need at least 5m to calculate meaningful grade
      const grade = (altDelta / distDelta) * 100;
      // Cap at reasonable values (-30% to +30%)
      gradeData.push(Math.min(30, Math.max(-30, grade)));
    } else {
      gradeData.push(gradeData.length > 0 ? gradeData[gradeData.length - 1] : 0);
    }
  }

  return gradeData;
}

// Format pace as mm:ss
function formatPace(secsPerKm: number, isMetric: boolean): string {
  const secsPerUnit = isMetric ? secsPerKm : secsPerKm * 1.60934;
  const mins = Math.floor(secsPerUnit / 60);
  const secs = Math.round(secsPerUnit % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Format speed in km/h or mph
function formatSpeed(mps: number, isMetric: boolean): string {
  const speed = isMetric ? mps * 3.6 : mps * 2.23694;
  return speed.toFixed(1);
}

// Format grade as percentage
function formatGrade(grade: number): string {
  const sign = grade >= 0 ? '+' : '';
  return `${sign}${grade.toFixed(1)}`;
}

export const CHART_CONFIGS: Record<ChartTypeId, ChartConfig> = {
  elevation: {
    id: 'elevation',
    label: 'Elevation',
    unit: 'm',
    unitImperial: 'ft',
    icon: 'trending-up',
    color: '#4CAF50',
    getStream: (s) => s.altitude,
    convertToImperial: (m) => m * 3.28084,
  },
  heartrate: {
    id: 'heartrate',
    label: 'Heart Rate',
    unit: 'bpm',
    icon: 'heart-pulse',
    color: '#E91E63',
    getStream: (s) => s.heartrate,
  },
  power: {
    id: 'power',
    label: 'Power',
    unit: 'W',
    icon: 'lightning-bolt',
    color: '#FF9800',
    getStream: (s) => s.watts,
  },
  pace: {
    id: 'pace',
    label: 'Pace',
    unit: 'min/km',
    unitImperial: 'min/mi',
    icon: 'speedometer',
    color: '#2196F3',
    getStream: calculatePaceStream,
    formatValue: formatPace,
    // Note: pace conversion is handled in formatValue
  },
  cadence: {
    id: 'cadence',
    label: 'Cadence',
    unit: 'rpm',
    icon: 'rotate-right',
    color: '#9C27B0',
    getStream: (s) => s.cadence,
  },
  speed: {
    id: 'speed',
    label: 'Speed',
    unit: 'km/h',
    unitImperial: 'mph',
    icon: 'speedometer-medium',
    color: '#00BCD4',
    getStream: (s) => s.velocity_smooth,
    formatValue: formatSpeed,
    convertToImperial: (mps) => mps * 2.23694 / 3.6, // Keep in mps for conversion
  },
  grade: {
    id: 'grade',
    label: 'Grade',
    unit: '%',
    icon: 'slope-uphill',
    color: '#795548',
    getStream: calculateGradeStream,
    formatValue: formatGrade,
  },
};

// Get available chart types based on stream data
export function getAvailableCharts(streams: ActivityStreams | undefined): ChartConfig[] {
  if (!streams) return [];

  return Object.values(CHART_CONFIGS).filter((config) => {
    const data = config.getStream(streams);
    return data && data.length > 0;
  });
}
