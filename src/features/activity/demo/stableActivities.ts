import type { ApiActivity } from './types';
import { getDemoReferenceDate, formatLocalISOString } from '@/data/demo/random';

// Permanent demo-test-N ids so e2e flows can target activities regardless of reference date.
export function generateStableTestActivities(): (ApiActivity & { _routeId: string | null })[] {
  const referenceDate = getDemoReferenceDate();

  // Create activities for recent days with stable IDs
  const stableActivities: (ApiActivity & { _routeId: string | null })[] = [
    // demo-test-0: Yesterday's ride
    {
      id: 'demo-test-0',
      start_date_local: (() => {
        const d = new Date(referenceDate);
        d.setDate(d.getDate() - 1);
        d.setHours(8, 30, 0, 0);
        return formatLocalISOString(d);
      })(),
      type: 'Ride',
      name: 'Morning Alpine Ride',
      description:
        "Great conditions today! Rode up through the valley with fresh legs after yesterday's rest day. Hit some good power numbers on the main climb and the descent was fast. Roads were dry and mostly empty.",
      distance: 45000,
      moving_time: 5400,
      elapsed_time: 5700,
      total_elevation_gain: 850,
      total_elevation_loss: 820,
      average_speed: 8.3,
      max_speed: 14.2,
      average_heartrate: 142,
      max_heartrate: 168,
      average_cadence: 88,
      average_temp: 18,
      calories: 1200,
      device_name: 'Demo Device',
      trainer: false,
      commute: false,
      average_watts: 195,
      weighted_average_watts: 208,
      icu_training_load: 85,
      icu_intensity: 78,
      icu_ftp: 250,
      icu_atl: 45,
      icu_ctl: 42,
      icu_hr_zones: [130, 145, 160, 170, 180, 190],
      icu_power_zones: [125, 170, 210, 250, 290, 350],
      icu_zone_times: [
        { id: 'Z1', secs: 540 },
        { id: 'Z2', secs: 1890 },
        { id: 'Z3', secs: 1350 },
        { id: 'Z4', secs: 810 },
        { id: 'Z5', secs: 540 },
        { id: 'Z6', secs: 216 },
        { id: 'Z7', secs: 54 },
      ],
      stream_types: [
        'time',
        'latlng',
        'heartrate',
        'altitude',
        'cadence',
        'watts',
        'velocity_smooth',
        'grade_smooth',
      ],
      locality: 'Valais',
      country: 'Switzerland',
      _routeId: 'route-valais-ride-2',
    },
    // demo-test-1: 2 days ago run
    {
      id: 'demo-test-1',
      start_date_local: (() => {
        const d = new Date(referenceDate);
        d.setDate(d.getDate() - 2);
        d.setHours(7, 0, 0, 0);
        return formatLocalISOString(d);
      })(),
      type: 'Run',
      name: 'Easy Morning Run',
      description:
        'Recovery run along the beachfront. Kept the pace easy and HR in zone 2. Legs felt a bit heavy from the ride but loosened up after the first km.',
      distance: 8500,
      moving_time: 2700,
      elapsed_time: 2850,
      total_elevation_gain: 45,
      total_elevation_loss: 42,
      average_speed: 3.15,
      max_speed: 4.2,
      average_heartrate: 138,
      max_heartrate: 155,
      average_cadence: 172,
      average_temp: 16,
      calories: 520,
      device_name: 'Demo Device',
      trainer: false,
      commute: false,
      average_watts: null,
      weighted_average_watts: null,
      icu_training_load: 42,
      icu_intensity: 65,
      icu_ftp: 250,
      icu_atl: 48,
      icu_ctl: 41,
      icu_hr_zones: [130, 145, 160, 170, 180, 190],
      icu_power_zones: [125, 170, 210, 250, 290, 350],
      icu_zone_times: null,
      stream_types: [
        'time',
        'latlng',
        'heartrate',
        'altitude',
        'cadence',
        'velocity_smooth',
        'grade_smooth',
      ],
      locality: 'Rio de Janeiro',
      country: 'Brazil',
      _routeId: 'route-rio-run-1',
    },
    // demo-test-2: 3 days ago virtual ride
    {
      id: 'demo-test-2',
      start_date_local: (() => {
        const d = new Date(referenceDate);
        d.setDate(d.getDate() - 3);
        d.setHours(18, 30, 0, 0);
        return formatLocalISOString(d);
      })(),
      type: 'VirtualRide',
      name: 'Evening Virtual Ride - Swiss Alps',
      description:
        'Virtual ride through Grindelwald. Focused on threshold intervals on the climb sections. The scenery helps with motivation on the harder efforts.',
      distance: 25000,
      moving_time: 3600,
      elapsed_time: 3650,
      total_elevation_gain: 650,
      total_elevation_loss: 620,
      average_speed: 6.9,
      max_speed: 11.5,
      average_heartrate: 155,
      max_heartrate: 175,
      average_cadence: 82,
      average_temp: 20,
      calories: 780,
      device_name: 'Demo Device',
      trainer: true,
      commute: false,
      average_watts: 205,
      weighted_average_watts: 218,
      icu_training_load: 72,
      icu_intensity: 82,
      icu_ftp: 250,
      icu_atl: 52,
      icu_ctl: 40,
      icu_hr_zones: [130, 145, 160, 170, 180, 190],
      icu_power_zones: [125, 170, 210, 250, 290, 350],
      icu_zone_times: [
        { id: 'Z1', secs: 360 },
        { id: 'Z2', secs: 1260 },
        { id: 'Z3', secs: 900 },
        { id: 'Z4', secs: 540 },
        { id: 'Z5', secs: 360 },
        { id: 'Z6', secs: 144 },
        { id: 'Z7', secs: 36 },
      ],
      stream_types: [
        'time',
        'latlng',
        'heartrate',
        'altitude',
        'cadence',
        'watts',
        'velocity_smooth',
        'grade_smooth',
      ],
      locality: 'Grindelwald',
      country: 'Switzerland',
      _routeId: 'route-rouvy-grindelwald',
    },
    // demo-test-3: 4 days ago hike
    {
      id: 'demo-test-3',
      start_date_local: (() => {
        const d = new Date(referenceDate);
        d.setDate(d.getDate() - 4);
        d.setHours(9, 0, 0, 0);
        return formatLocalISOString(d);
      })(),
      type: 'Hike',
      name: 'Mountain Valley Hike',
      description: null,
      distance: 6500,
      moving_time: 7200,
      elapsed_time: 8100,
      total_elevation_gain: 380,
      total_elevation_loss: 350,
      average_speed: 0.9,
      max_speed: 1.4,
      average_heartrate: 115,
      max_heartrate: 142,
      average_cadence: null,
      average_temp: 14,
      calories: 450,
      device_name: 'Demo Device',
      trainer: false,
      commute: false,
      average_watts: null,
      weighted_average_watts: null,
      icu_training_load: 35,
      icu_intensity: 55,
      icu_ftp: 250,
      icu_atl: 42,
      icu_ctl: 39,
      icu_hr_zones: [130, 145, 160, 170, 180, 190],
      icu_power_zones: [125, 170, 210, 250, 290, 350],
      icu_zone_times: null,
      stream_types: ['time', 'latlng', 'heartrate', 'altitude', 'grade_smooth'],
      locality: 'Lauterbrunnen',
      country: 'Switzerland',
      _routeId: 'route-lauterbrunnen-hike-2',
    },
    // demo-test-4: 5 days ago swim
    {
      id: 'demo-test-4',
      start_date_local: (() => {
        const d = new Date(referenceDate);
        d.setDate(d.getDate() - 5);
        d.setHours(7, 30, 0, 0);
        return formatLocalISOString(d);
      })(),
      type: 'Swim',
      name: 'Open Water Swim',
      description: null,
      distance: 2000,
      moving_time: 2400,
      elapsed_time: 2700,
      total_elevation_gain: 0,
      total_elevation_loss: 0,
      average_speed: 0.83,
      max_speed: 1.1,
      average_heartrate: 135,
      max_heartrate: 158,
      average_cadence: null,
      average_temp: 22,
      calories: 380,
      device_name: 'Demo Device',
      trainer: false,
      commute: false,
      average_watts: null,
      weighted_average_watts: null,
      icu_training_load: 45,
      icu_intensity: 70,
      icu_ftp: 250,
      icu_atl: 38,
      icu_ctl: 38,
      icu_hr_zones: [130, 145, 160, 170, 180, 190],
      icu_power_zones: [125, 170, 210, 250, 290, 350],
      icu_zone_times: null,
      stream_types: ['time', 'latlng', 'heartrate', 'distance'],
      locality: 'La Orotava',
      country: 'Spain',
      _routeId: 'route-la-orotava-swim-1',
    },
    // demo-test-5: 6 days ago out-and-back run on the rio route.
    // Section detection sees the shared polyline traversed forward then
    // reverse, producing the two (section, direction) pairs US-S1 asserts.
    {
      id: 'demo-test-5',
      start_date_local: (() => {
        const d = new Date(referenceDate);
        d.setDate(d.getDate() - 6);
        d.setHours(6, 45, 0, 0);
        return formatLocalISOString(d);
      })(),
      type: 'Run',
      name: 'Out and Back Beach Run',
      description: null,
      distance: 6000,
      moving_time: 1920,
      elapsed_time: 2040,
      total_elevation_gain: 85,
      total_elevation_loss: 85,
      average_speed: 3.13,
      max_speed: 4.2,
      average_heartrate: 140,
      max_heartrate: 158,
      average_cadence: 174,
      average_temp: 22,
      calories: 380,
      device_name: 'Demo Device',
      trainer: false,
      commute: false,
      average_watts: null,
      weighted_average_watts: null,
      icu_training_load: 48,
      icu_intensity: 68,
      icu_ftp: 250,
      icu_atl: 42,
      icu_ctl: 38,
      icu_hr_zones: [130, 145, 160, 170, 180, 190],
      icu_power_zones: [125, 170, 210, 250, 290, 350],
      icu_zone_times: null,
      stream_types: [
        'time',
        'latlng',
        'heartrate',
        'altitude',
        'cadence',
        'velocity_smooth',
        'grade_smooth',
      ],
      locality: 'Rio de Janeiro',
      country: 'Brazil',
      _routeId: 'route-rio-run-1-outback',
    },
    // demo-test-6: 7 days ago strength session. No GPS - WeightTraining
    // activities don't have a track. Exercise sets are seeded via
    // engine.bulkInsertExerciseSets() from src/data/demo/strengthSets.ts the
    // first time the Strength tab is viewed.
    {
      id: 'demo-test-6',
      start_date_local: (() => {
        const d = new Date(referenceDate);
        d.setDate(d.getDate() - 7);
        d.setHours(18, 0, 0, 0);
        return formatLocalISOString(d);
      })(),
      type: 'WeightTraining',
      name: 'Strength Session',
      description: 'Bench / squat / deadlift.',
      distance: 0,
      moving_time: 3600,
      elapsed_time: 4200,
      total_elevation_gain: 0,
      total_elevation_loss: 0,
      average_speed: 0,
      max_speed: 0,
      average_heartrate: 118,
      max_heartrate: 148,
      average_cadence: null,
      average_temp: 20,
      calories: 320,
      device_name: 'Demo Device',
      trainer: false,
      commute: false,
      average_watts: null,
      weighted_average_watts: null,
      icu_training_load: 55,
      icu_intensity: null,
      icu_ftp: 250,
      icu_atl: 40,
      icu_ctl: 38,
      icu_hr_zones: [130, 145, 160, 170, 180, 190],
      icu_power_zones: [125, 170, 210, 250, 290, 350],
      icu_zone_times: null,
      stream_types: ['time', 'heartrate'],
      locality: 'Valais',
      country: 'Switzerland',
      _routeId: null,
    },
  ];

  return stableActivities;
}
