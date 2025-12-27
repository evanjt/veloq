import type { Activity } from '@/types';

// Generate demo activities for the last 90 days
function generateDemoActivities(): Activity[] {
  const activities: Activity[] = [];
  const now = new Date();

  // Activity templates with realistic data
  const templates = [
    {
      type: 'Ride',
      name: 'Morning Ride',
      distance: 45000, // 45km
      movingTime: 5400, // 1.5 hours
      elevation: 450,
      avgSpeed: 30,
      avgHr: 145,
      avgWatts: 180,
      tss: 65,
    },
    {
      type: 'Ride',
      name: 'Endurance Ride',
      distance: 80000, // 80km
      movingTime: 10800, // 3 hours
      elevation: 800,
      avgSpeed: 27,
      avgHr: 135,
      avgWatts: 165,
      tss: 120,
    },
    {
      type: 'Ride',
      name: 'Hill Repeats',
      distance: 35000, // 35km
      movingTime: 4500, // 1.25 hours
      elevation: 650,
      avgSpeed: 28,
      avgHr: 155,
      avgWatts: 210,
      tss: 80,
    },
    {
      type: 'Run',
      name: 'Easy Run',
      distance: 8000, // 8km
      movingTime: 2700, // 45 min
      elevation: 50,
      avgSpeed: 10.7,
      avgHr: 140,
      avgWatts: 0,
      tss: 35,
    },
    {
      type: 'Run',
      name: 'Long Run',
      distance: 15000, // 15km
      movingTime: 4800, // 80 min
      elevation: 120,
      avgSpeed: 11.2,
      avgHr: 145,
      avgWatts: 0,
      tss: 70,
    },
    {
      type: 'VirtualRide',
      name: 'Zwift Session',
      distance: 30000, // 30km
      movingTime: 3600, // 1 hour
      elevation: 350,
      avgSpeed: 30,
      avgHr: 150,
      avgWatts: 195,
      tss: 55,
    },
    {
      type: 'Swim',
      name: 'Pool Swim',
      distance: 2500, // 2.5km
      movingTime: 3000, // 50 min
      elevation: 0,
      avgSpeed: 3,
      avgHr: 130,
      avgWatts: 0,
      tss: 40,
    },
  ];

  // Generate activities for last 90 days with some rest days
  let activityId = 1000;
  for (let daysAgo = 0; daysAgo < 90; daysAgo++) {
    // Skip ~2 days per week as rest days
    if (daysAgo % 7 === 0 || daysAgo % 7 === 4) continue;

    const date = new Date(now);
    date.setDate(date.getDate() - daysAgo);
    date.setHours(7, 0, 0, 0);

    // Pick activity based on day pattern
    let template;
    const dayOfWeek = date.getDay();
    if (dayOfWeek === 0) {
      // Sunday - long ride or run
      template = Math.random() > 0.3 ? templates[1] : templates[4];
    } else if (dayOfWeek === 6) {
      // Saturday - ride
      template = templates[Math.floor(Math.random() * 3)];
    } else if (dayOfWeek === 2 || dayOfWeek === 5) {
      // Tuesday/Friday - run or swim
      template = Math.random() > 0.5 ? templates[3] : templates[6];
    } else {
      // Other days - mix
      template = templates[Math.floor(Math.random() * templates.length)];
    }

    // Add some variation
    const variance = 0.9 + Math.random() * 0.2;

    activities.push({
      id: `demo-${activityId++}`,
      name: template.name,
      type: template.type,
      start_date_local: date.toISOString(),
      moving_time: Math.round(template.movingTime * variance),
      elapsed_time: Math.round(template.movingTime * variance * 1.05),
      distance: Math.round(template.distance * variance),
      total_elevation_gain: Math.round(template.elevation * variance),
      average_speed: template.avgSpeed * variance,
      icu_average_hr: Math.round(template.avgHr * variance),
      icu_average_watts: template.avgWatts ? Math.round(template.avgWatts * variance) : undefined,
      icu_training_load: Math.round(template.tss * variance),
      locality: 'Demo City',
      country: 'AU',
      stream_types: ['latlng', 'heartrate', 'watts', 'altitude'],
    } as Activity);
  }

  return activities.reverse(); // Oldest first
}

export const demoActivities = generateDemoActivities();
