import type { PowerCurve, PaceCurve } from '@/types';
import { DEMO_REFERENCE_DATE, getDemoReferenceDate, formatDateId } from '@/data/demo/random';

// Calculate deterministic date range (42 days before reference date)
const referenceDate = getDemoReferenceDate();
const startDate = new Date(referenceDate);
startDate.setDate(startDate.getDate() - 42);
const paceCurveStartDate = formatDateId(startDate);

// Generate demo activity IDs for curve best efforts
function demoDateOffset(daysBack: number): string {
  const d = new Date(referenceDate);
  d.setDate(d.getDate() - daysBack);
  return formatDateId(d);
}

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
  activity_ids: [
    `demo-${demoDateOffset(3)}-0`,
    `demo-${demoDateOffset(3)}-0`,
    `demo-${demoDateOffset(5)}-0`,
    `demo-${demoDateOffset(5)}-0`,
    `demo-${demoDateOffset(7)}-0`,
    `demo-${demoDateOffset(7)}-0`,
    `demo-${demoDateOffset(10)}-0`,
    `demo-${demoDateOffset(10)}-0`,
    `demo-${demoDateOffset(12)}-0`,
    `demo-${demoDateOffset(12)}-0`,
    `demo-${demoDateOffset(14)}-0`,
    `demo-${demoDateOffset(14)}-0`,
    `demo-${demoDateOffset(16)}-0`,
    `demo-${demoDateOffset(16)}-0`,
    `demo-${demoDateOffset(18)}-0`,
    `demo-${demoDateOffset(18)}-0`,
    `demo-${demoDateOffset(21)}-0`,
    `demo-${demoDateOffset(21)}-0`,
    `demo-${demoDateOffset(25)}-0`,
    `demo-${demoDateOffset(25)}-0`,
    `demo-${demoDateOffset(30)}-0`,
    `demo-${demoDateOffset(35)}-0`,
    `demo-${demoDateOffset(40)}-0`,
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
  activity_ids: [
    `demo-${demoDateOffset(2)}-1`,
    `demo-${demoDateOffset(2)}-1`,
    `demo-${demoDateOffset(4)}-1`,
    `demo-${demoDateOffset(6)}-1`,
    `demo-${demoDateOffset(8)}-1`,
    `demo-${demoDateOffset(11)}-1`,
    `demo-${demoDateOffset(13)}-1`,
    `demo-${demoDateOffset(17)}-1`,
    `demo-${demoDateOffset(20)}-1`,
    `demo-${demoDateOffset(28)}-1`,
    `demo-${demoDateOffset(38)}-1`,
  ],
  criticalSpeed: 3.45, // ~4:50/km
  dPrime: 200,
  r2: 0.98,
  startDate: paceCurveStartDate,
  endDate: DEMO_REFERENCE_DATE,
  days: 42,
};

/**
 * Demo sport settings, in the shape the athlete endpoint sends: heart rate
 * zones as the upper bpm edge of each, power zones as the upper edge in percent
 * of FTP with 999 for the open top zone, and threshold pace in m/s.
 */
export const demoSportSettings = [
  {
    id: 'Ride',
    types: ['Ride', 'VirtualRide'],
    other: false,
    ftp: 250,
    power_zones: [55, 75, 90, 105, 120, 150, 999],
    lthr: 165,
    max_hr: 190,
    hr_zones: [130, 145, 160, 170, 180, 190],
  },
  {
    id: 'Run',
    types: ['Run', 'TrailRun'],
    other: false,
    // 5:00 per km
    threshold_pace: 1000 / 300,
    lthr: 170,
    max_hr: 190,
    hr_zones: [135, 150, 163, 172, 181, 190],
  },
];
