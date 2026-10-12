import type { ActivityType, RecordingMode, RecordingStatus } from '@/types';

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
  return Object.hasOwn(RECORDING_MODE_MAP, type) ? RECORDING_MODE_MAP[type] : 'manual';
}

/**
 * The sport a recording link names, or null when the recorder does not know
 * it. Any app or web page can open a recording link, so the sport is checked
 * against the map's own keys and never against what its prototype carries.
 */
export function parseRecordingType(raw: string | string[] | undefined): ActivityType | null {
  if (typeof raw !== 'string' || !Object.hasOwn(RECORDING_MODE_MAP, raw)) return null;
  return raw as ActivityType;
}

/** The planned event a recording link pairs with, when it names a positive whole number. */
export function parsePairedEventId(raw: string | string[] | undefined): number | undefined {
  if (typeof raw !== 'string' || !/^[1-9][0-9]*$/.test(raw)) return undefined;
  const id = Number(raw);
  return Number.isSafeInteger(id) ? id : undefined;
}

/**
 * The mode the recording screen lays out for. A started ride lays out for the
 * store's mode, which follows the sport across gps and indoor and never becomes
 * manual, since the session's GPS watch or indoor sampler runs on it. Before the
 * start the sport the athlete holds decides, and the route param is only what
 * they tapped.
 */
export function screenRecordingMode(
  store: { status: RecordingStatus; mode: RecordingMode | null; activityType: ActivityType | null },
  routeType: ActivityType
): RecordingMode {
  if (store.status !== 'idle' && store.mode) return store.mode;
  return getRecordingMode(store.activityType ?? routeType);
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
