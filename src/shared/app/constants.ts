import type { TimeRange } from './timeRange';
import { periodOptions } from './period';

/** The fitness and training pickers' options, from the one period vocabulary. */
export const TIME_RANGES = periodOptions<TimeRange>(['7d', '1m', '3m', '6m', '1y']);

/**
 * Time constants in milliseconds for cache and query configuration
 */
export const TIME = {
  /** One second in ms */
  SECOND: 1000,
  /** One minute in ms */
  MINUTE: 1000 * 60,
  /** One hour in ms */
  HOUR: 1000 * 60 * 60,
  /** One day in ms */
  DAY: 1000 * 60 * 60 * 24,
} as const;

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

export const CHART = {
  /** Default chart height */
  DEFAULT_HEIGHT: 200,
  /** Small chart height */
  SMALL_HEIGHT: 100,
  /** Default downsampling target */
  DOWNSAMPLE_TARGET: 500,
} as const;

export const UI = {
  /** Max height for routes list container */
  ROUTES_LIST_MAX_HEIGHT: 400,
} as const;

export const INTERVALS_URLS = {
  signup: 'https://intervals.icu',
  privacyPolicy: 'https://intervals.icu/privacy-policy.html',
  termsOfService: 'https://forum.intervals.icu/tos',
  apiTerms: 'https://forum.intervals.icu/t/intervals-icu-api-terms-and-conditions/114087',
  settings: 'https://intervals.icu/settings',
  /** Developer Settings section for API key */
  developerSettings: 'https://intervals.icu/settings#developer',
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
