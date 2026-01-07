import type { Activity } from '@/types';
import { demoRoutes, getRouteForActivity } from './routes';

// Activity templates with realistic data
const activityTemplates = [
  {
    type: 'Ride',
    name: 'Morning Ride',
    distance: 45000,
    movingTime: 5400,
    elevation: 450,
    avgSpeed: 30,
    avgHr: 145,
    avgWatts: 180,
    tss: 65,
  },
  {
    type: 'Ride',
    name: 'Endurance Ride',
    distance: 80000,
    movingTime: 10800,
    elevation: 800,
    avgSpeed: 27,
    avgHr: 135,
    avgWatts: 165,
    tss: 120,
  },
  {
    type: 'Ride',
    name: 'Hill Repeats',
    distance: 35000,
    movingTime: 4500,
    elevation: 650,
    avgSpeed: 28,
    avgHr: 155,
    avgWatts: 210,
    tss: 80,
  },
  {
    type: 'Run',
    name: 'Easy Run',
    distance: 8000,
    movingTime: 2700,
    elevation: 50,
    avgSpeed: 10.7,
    avgHr: 140,
    avgWatts: 0,
    tss: 35,
  },
  {
    type: 'Run',
    name: 'Long Run',
    distance: 15000,
    movingTime: 4800,
    elevation: 120,
    avgSpeed: 11.2,
    avgHr: 145,
    avgWatts: 0,
    tss: 70,
  },
  {
    type: 'VirtualRide',
    name: 'Virtual Cycle Session',
    distance: 12000,
    movingTime: 2400,
    elevation: 200,
    avgSpeed: 30,
    avgHr: 150,
    avgWatts: 195,
    tss: 55,
  },
  {
    type: 'Swim',
    name: 'Pool Swim',
    distance: 2500,
    movingTime: 3000,
    elevation: 0,
    avgSpeed: 3,
    avgHr: 130,
    avgWatts: 0,
    tss: 40,
  },
  {
    type: 'Swim',
    name: 'Open Water Swim',
    distance: 800,
    movingTime: 1200,
    elevation: 0,
    avgSpeed: 2.4,
    avgHr: 135,
    avgWatts: 0,
    tss: 25,
  },
  {
    type: 'Hike',
    name: 'Mountain Hike',
    distance: 10000,
    movingTime: 10800,
    elevation: 600,
    avgSpeed: 3.3,
    avgHr: 110,
    avgWatts: 0,
    tss: 50,
  },
];

// Seasonal variation multiplier (winter = less volume)
function getSeasonalMultiplier(date: Date): number {
  const month = date.getMonth();
  // Northern hemisphere winter = less training
  // Adjust for southern hemisphere if needed
  if (month >= 11 || month <= 1) return 0.7; // Dec-Feb: winter
  if (month >= 2 && month <= 4) return 0.9; // Mar-May: spring buildup
  if (month >= 5 && month <= 7) return 1.1; // Jun-Aug: peak season
  return 1.0; // Sep-Nov: transition
}

/**
 * Generate demo activities for the past year
 * This provides enough data for:
 * - Season comparison
 * - Full activity calendar
 * - Route matching
 * - Training trends
 */
function generateDemoActivities(): Activity[] {
  const activities: Activity[] = [];
  const now = new Date();

  // Track which routes have been used for route matching demo
  const routeUsage: Record<string, number> = {};

  let activityId = 1000;
  for (let daysAgo = 0; daysAgo < 365; daysAgo++) {
    const date = new Date(now);
    date.setDate(date.getDate() - daysAgo);
    date.setHours(7 + Math.floor(Math.random() * 3), Math.floor(Math.random() * 60), 0, 0);

    const seasonMultiplier = getSeasonalMultiplier(date);
    const dayOfWeek = date.getDay();

    // Rest day logic: ~2 days per week, more rest in winter
    const restDayChance =
      dayOfWeek === 1
        ? 0.8 // Monday: likely rest
        : dayOfWeek === 4
          ? 0.5 // Thursday: maybe rest
          : 0.15;
    if (Math.random() < restDayChance * (1 / seasonMultiplier)) continue;

    // Pick activity based on day pattern
    // Template indices: 0-2: Rides, 3-4: Runs, 5: VirtualRide, 6: Pool Swim, 7: Open Water Swim, 8: Hike
    let template;
    if (dayOfWeek === 0) {
      // Sunday - long ride, run, or occasionally hike
      const r = Math.random();
      if (r < 0.5) {
        template = activityTemplates[1]; // Endurance Ride
      } else if (r < 0.85) {
        template = activityTemplates[4]; // Long Run
      } else {
        template = activityTemplates[8]; // Mountain Hike
      }
    } else if (dayOfWeek === 6) {
      // Saturday - ride or hike
      const r = Math.random();
      if (r < 0.85) {
        template = activityTemplates[Math.floor(Math.random() * 3)]; // Rides
      } else {
        template = activityTemplates[8]; // Mountain Hike
      }
    } else if (dayOfWeek === 2 || dayOfWeek === 5) {
      // Tuesday/Friday - run, swim (pool or open water), or indoor
      const r = Math.random();
      if (r < 0.35) {
        template = activityTemplates[3]; // Easy Run
      } else if (r < 0.55) {
        template = activityTemplates[6]; // Pool Swim
      } else if (r < 0.7) {
        template = activityTemplates[7]; // Open Water Swim
      } else {
        template = activityTemplates[5]; // Virtual Cycle Session
      }
    } else {
      // Other days - mix with bias toward shorter activities
      template = activityTemplates[Math.floor(Math.random() * activityTemplates.length)];
    }

    // Add seasonal and random variation
    const variance = (0.85 + Math.random() * 0.3) * seasonMultiplier;

    // Match to a demo route if applicable
    const matchedRoute = getRouteForActivity(template.type, template.distance);
    if (matchedRoute) {
      routeUsage[matchedRoute.id] = (routeUsage[matchedRoute.id] || 0) + 1;
    }

    // Determine stream types based on activity type and whether it has GPS
    const hasGps = !!matchedRoute;
    let streamTypes: string[];
    if (template.type === 'Swim') {
      // Pool swims have no GPS, open water swims do
      streamTypes = hasGps ? ['latlng', 'heartrate', 'distance'] : ['heartrate', 'distance'];
    } else if (template.type === 'Hike') {
      streamTypes = hasGps ? ['latlng', 'heartrate', 'altitude'] : ['heartrate'];
    } else if (template.type === 'VirtualRide') {
      // Virtual rides now have GPS from real ROUVY routes
      streamTypes = hasGps
        ? ['latlng', 'heartrate', 'watts', 'altitude', 'cadence']
        : ['heartrate', 'watts', 'altitude', 'cadence'];
    } else {
      // Rides and Runs always have GPS if they have a route
      streamTypes = hasGps
        ? ['latlng', 'heartrate', 'watts', 'altitude', 'cadence']
        : ['heartrate', 'watts', 'altitude', 'cadence'];
    }

    const activity: Activity = {
      id: `demo-${activityId++}`,
      name: template.name,
      type: template.type,
      start_date_local: date.toISOString(),
      moving_time: Math.round(template.movingTime * variance),
      elapsed_time: Math.round(template.movingTime * variance * 1.05),
      distance: Math.round(template.distance * variance),
      total_elevation_gain: Math.round(template.elevation * variance),
      average_speed: template.avgSpeed * variance,
      icu_average_hr: Math.round(template.avgHr * (0.95 + Math.random() * 0.1)),
      icu_average_watts: template.avgWatts ? Math.round(template.avgWatts * variance) : undefined,
      icu_training_load: Math.round(template.tss * variance),
      stream_types: streamTypes,
      // Store route reference for map data
      _demoRouteId: matchedRoute?.id,
    } as Activity & { _demoRouteId?: string };

    activities.push(activity);
  }

  // Sort oldest first for proper display
  return activities.sort(
    (a, b) => new Date(a.start_date_local).getTime() - new Date(b.start_date_local).getTime()
  );
}

export const demoActivities = generateDemoActivities();

/**
 * Get activities with the matched route for demo purposes
 */
export function getDemoActivityRoute(activityId: string): string | undefined {
  const activity = demoActivities.find((a) => a.id === activityId) as Activity & {
    _demoRouteId?: string;
  };
  return activity?._demoRouteId;
}
