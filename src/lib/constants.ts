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

/**
 * API rate limiting constants
 */
export const RATE_LIMIT = {
  /** Minimum ms between requests */
  MIN_INTERVAL: 50,
  /** Sliding window size in ms */
  WINDOW_SIZE: 10000,
  /** Max requests per window (API allows 132/10s, use 120 to be safe) */
  MAX_PER_WINDOW: 120,
  /** Default batch concurrency (API recommends 10/s for bulk, use 12) */
  DEFAULT_CONCURRENCY: 12,
} as const;

/**
 * Chart configuration constants
 */
export const CHART = {
  /** Default chart height */
  DEFAULT_HEIGHT: 200,
  /** Small chart height */
  SMALL_HEIGHT: 100,
  /** Default downsampling target */
  DOWNSAMPLE_TARGET: 500,
} as const;

/**
 * Sync configuration constants
 */
export const SYNC = {
  /** Initial sync period in days (1 year - GPS traces fetched for route matching) */
  INITIAL_DAYS: 365,
  /** Background sync history in days */
  BACKGROUND_DAYS: 365 * 2,
  /** Max history to sync in years */
  MAX_HISTORY_YEARS: 10,
} as const;
