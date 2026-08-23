import type { TimeRange } from './timeRange';

/**
 * Shared time range picker options (used by fitness and training screens)
 */
export const TIME_RANGES: { id: TimeRange; label: string }[] = [
  { id: '7d', label: '1W' },
  { id: '1m', label: '1M' },
  { id: '3m', label: '3M' },
  { id: '6m', label: '6M' },
  { id: '1y', label: '1Y' },
];

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
