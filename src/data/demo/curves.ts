import type { PowerCurve, PaceCurve } from '@/types';
import { DEMO_REFERENCE_DATE, getDemoReferenceDate, formatDateId } from './random';

// Calculate deterministic date range (42 days before reference date)
const referenceDate = getDemoReferenceDate();
const startDate = new Date(referenceDate);
startDate.setDate(startDate.getDate() - 42);
const paceCurveStartDate = formatDateId(startDate);

// Realistic power curve for a ~250W FTP rider
export const demoPowerCurve: PowerCurve = {
  type: 'power',
  sport: 'Ride',
  secs: [
    1, 2, 5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 300, 360, 480, 600, 900, 1200, 1800, 2400, 3600,
    5400, 7200,
  ],
  watts: [
    950, 900, 750, 600, 520, 460, 410, 370, 340, 315, 300, 285, 270, 265, 258, 252, 248, 245, 240,
    235, 228, 220, 210,
  ],
};

// Realistic pace curve for a ~5:00/km runner
export const demoPaceCurve: PaceCurve = {
  type: 'pace',
  sport: 'Run',
  // Distances in meters
  distances: [100, 200, 400, 800, 1000, 1500, 2000, 3000, 5000, 10000, 21097],
  // Times in seconds to complete each distance
  times: [18, 38, 82, 180, 235, 375, 520, 840, 1500, 3200, 7200],
  // Pace in m/s at each distance
  pace: [5.56, 5.26, 4.88, 4.44, 4.26, 4.0, 3.85, 3.57, 3.33, 3.13, 2.93],
  criticalSpeed: 3.45, // ~4:50/km
  dPrime: 200,
  r2: 0.98,
  startDate: paceCurveStartDate,
  endDate: DEMO_REFERENCE_DATE,
  days: 42,
};

// Demo sport settings with zones
export const demoSportSettings = [
  {
    id: 'Ride',
    types: ['Ride', 'VirtualRide'],
    ftp: 250,
    icu_power_zones: [
      { id: 1, name: 'Recovery', min: 0, max: 55, color: '#808080' },
      { id: 2, name: 'Endurance', min: 55, max: 75, color: '#00BFFF' },
      { id: 3, name: 'Tempo', min: 75, max: 90, color: '#32CD32' },
      { id: 4, name: 'Threshold', min: 90, max: 105, color: '#FFD700' },
      { id: 5, name: 'VO2max', min: 105, max: 120, color: '#FF4500' },
      { id: 6, name: 'Anaerobic', min: 120, max: 150, color: '#FF0000' },
      { id: 7, name: 'Neuromuscular', min: 150, max: null, color: '#8B0000' },
    ],
    threshold_hr: 165,
    icu_hr_zones: [
      { id: 1, name: 'Recovery', min: 0, max: 60, color: '#808080' },
      { id: 2, name: 'Endurance', min: 60, max: 70, color: '#00BFFF' },
      { id: 3, name: 'Tempo', min: 70, max: 80, color: '#32CD32' },
      { id: 4, name: 'Threshold', min: 80, max: 90, color: '#FFD700' },
      { id: 5, name: 'VO2max', min: 90, max: 100, color: '#FF4500' },
    ],
  },
  {
    id: 'Run',
    types: ['Run', 'TrailRun'],
    threshold_pace: 300, // 5:00/km in seconds per km
    threshold_hr: 170,
    icu_hr_zones: [
      { id: 1, name: 'Recovery', min: 0, max: 65, color: '#808080' },
      { id: 2, name: 'Endurance', min: 65, max: 75, color: '#00BFFF' },
      { id: 3, name: 'Tempo', min: 75, max: 85, color: '#32CD32' },
      { id: 4, name: 'Threshold', min: 85, max: 92, color: '#FFD700' },
      { id: 5, name: 'VO2max', min: 92, max: 100, color: '#FF4500' },
    ],
  },
];
