import type { ActivityType } from '@/types';
import type { RecordingMode } from '@/types';

const GPS_TYPES: ActivityType[] = [
  'Ride',
  'Run',
  'Walk',
  'Hike',
  'MountainBikeRide',
  'GravelRide',
  'EBikeRide',
  'TrailRun',
  'AlpineSki',
  'NordicSki',
  'BackcountrySki',
  'Kayaking',
  'Rowing',
  'OpenWaterSwim',
  'Snowboard',
  'Snowshoe',
  'RollerSki',
  'Canoeing',
  'Surfing',
  'Kitesurf',
  'Windsurf',
  'StandUpPaddling',
  'Sail',
  'IceSkate',
  'InlineSkate',
  'Skateboard',
  'Handcycle',
  'Velomobile',
  'Wheelchair',
  'Golf',
  'Soccer',
];

const INDOOR_TYPES: ActivityType[] = [
  'VirtualRide',
  'VirtualRun',
  'Treadmill',
  'Swim',
  'Elliptical',
  'StairStepper',
  'VirtualRow',
  'HighIntensityIntervalTraining',
];

export const RECORDING_MODE_MAP: Record<ActivityType, RecordingMode> = Object.fromEntries([
  ...GPS_TYPES.map((t) => [t, 'gps' as const]),
  ...INDOOR_TYPES.map((t) => [t, 'indoor' as const]),
  ...(
    [
      'WeightTraining',
      'Yoga',
      'Pilates',
      'Crossfit',
      'Tennis',
      'Badminton',
      'Pickleball',
      'Racquetball',
      'Squash',
      'TableTennis',
      'RockClimbing',
      'Workout',
      'Other',
    ] as ActivityType[]
  ).map((t) => [t, 'manual' as const]),
]) as Record<ActivityType, RecordingMode>;

export function getRecordingMode(type: ActivityType): RecordingMode {
  return RECORDING_MODE_MAP[type] ?? 'manual';
}

export const ACTIVITY_CATEGORIES = {
  cycling: [
    'Ride',
    'GravelRide',
    'MountainBikeRide',
    'EBikeRide',
    'VirtualRide',
    'Velomobile',
    'Handcycle',
  ],
  running: ['Run', 'TrailRun', 'VirtualRun', 'Treadmill'],
  swimming: ['Swim', 'OpenWaterSwim'],
  winter: ['AlpineSki', 'NordicSki', 'BackcountrySki', 'Snowboard', 'Snowshoe', 'RollerSki'],
  water: [
    'Rowing',
    'VirtualRow',
    'Kayaking',
    'Canoeing',
    'Surfing',
    'Kitesurf',
    'Windsurf',
    'StandUpPaddling',
    'Sail',
  ],
  gym: [
    'WeightTraining',
    'Yoga',
    'Pilates',
    'Crossfit',
    'Elliptical',
    'StairStepper',
    'HighIntensityIntervalTraining',
    'Workout',
  ],
  racket: ['Tennis', 'Badminton', 'Pickleball', 'Racquetball', 'Squash', 'TableTennis'],
  other: [
    'Walk',
    'Hike',
    'RockClimbing',
    'Golf',
    'Soccer',
    'IceSkate',
    'InlineSkate',
    'Skateboard',
    'Wheelchair',
    'Other',
  ],
} as const;
