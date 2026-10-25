import type { TimeRange } from './timeRange';
import { periodOptions } from './period';
import { TIME } from './time';

export { TIME };

/** The fitness and training pickers' options, from the one period vocabulary. */
export const TIME_RANGES = periodOptions<TimeRange>(['7d', '1m', '3m', '6m', '1y']);

/**
 * Cache duration presets for TanStack Query
 */
export const CACHE = {
  /** 5 minutes - for frequently changing data */
  SHORT: TIME.MINUTE * 5,
  /** 15 minutes - for moderately changing data */
  MEDIUM: TIME.MINUTE * 15,
  /** 30 minutes - for slowly changing data */
  LONG: TIME.MINUTE * 30,
  /** 1 hour - for rarely changing data */
  HOUR: TIME.HOUR,
  /** 24 hours - for stable data */
  DAY: TIME.DAY,
  /** 30 days - for historical data */
  MONTH: TIME.DAY * 30,
} as const;

export const INTERVALS_URLS = {
  signup: 'https://intervals.icu',
  privacyPolicy: 'https://intervals.icu/privacy-policy.html',
  termsOfService: 'https://forum.intervals.icu/tos',
  apiTerms: 'https://forum.intervals.icu/t/intervals-icu-api-terms-and-conditions/114087',
  settings: 'https://intervals.icu/settings',
  /** Developer Settings section for API key */
  developerSettings: 'https://intervals.icu/settings#developer',
  /** Where the athlete turns intervals.icu's Garmin imports on and off. */
  connections: 'https://intervals.icu/settings/connections',
  fitnessPage: 'https://intervals.icu/fitness',
  subscription: 'https://intervals.icu/settings/subscription',
  athletePage: (athleteId: string) => `https://intervals.icu/athlete/${athleteId}/activities`,
  /** Built from the id its caller holds, which says nothing of the row's origin. */
  activityPage: (activityId: string) => `https://intervals.icu/activities/${activityId}`,
} as const;

/**
 * The pace-curve range whose critical speed is snapshotted for the pace
 * milestone, and so the only range that milestone compares.
 *
 * The pace curve screen snapshots whatever range it is showing, 7 days to a
 * year, and those rows are kept and not compared with these: a year curve's
 * critical speed is the athlete's best year where a six-week curve's is recent
 * form, and the difference between them is not an improvement. Agreed with
 * `SYNC_PACE_WINDOW_DAYS` in `persistence/fitness/derivations.rs`.
 */
export const PACE_SNAPSHOT_WINDOW_DAYS = 42;
