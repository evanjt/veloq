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
  /** Initial sync period in days (3 months - GPS traces fetched for route matching) */
  INITIAL_DAYS: 90,
  /** Background sync history in days */
  BACKGROUND_DAYS: 365 * 2,
  /** Max history to sync in years */
  MAX_HISTORY_YEARS: 10,
} as const;

/**
 * UI layout constants
 */
export const UI = {
  /** Max height for routes list container */
  ROUTES_LIST_MAX_HEIGHT: 400,
} as const;

/**
 * API default values
 */
export const API_DEFAULTS = {
  /** Default activity fetch period in days */
  ACTIVITY_DAYS: 30,
  /** Default wellness fetch period in days */
  WELLNESS_DAYS: 90,
  /** Fallback date for finding oldest activity */
  OLDEST_DATE_FALLBACK: '2000-01-01',
} as const;

/**
 * OAuth configuration for intervals.icu
 * See oauth-proxy/README.md for registration details
 */
export const OAUTH = {
  /** OAuth client ID (public - safe to embed in app) */
  CLIENT_ID: '182',
  /** OAuth proxy URL (Cloudflare Worker that holds client_secret) */
  PROXY_URL: 'https://auth.veloq.fit',
  /** intervals.icu authorization endpoint */
  AUTH_ENDPOINT: 'https://intervals.icu/oauth/authorize',
  /** App's deep link scheme */
  APP_SCHEME: 'veloq',
  /** OAuth scopes */
  SCOPES: ['ACTIVITY:READ', 'WELLNESS:READ', 'CALENDAR:READ', 'SETTINGS:READ'],
} as const;

/**
 * External URLs for intervals.icu
 */
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
 * Section visualization styles for map rendering
 * Patterns use small, tight thatches (short dashes with small gaps)
 * to create distinct textures while appearing as continuous lines
 * Patterns cycle first, then colors (6 patterns x 3 colors = 18 unique styles)
 */
export const SECTION_PATTERNS: (number[] | undefined)[] = [
  undefined, // solid
  [4, 2], // tight thatches
  [2, 2], // very tight thatches (dotted look)
  [6, 2, 2, 2], // dash-dot pattern
  [3, 3], // even spacing thatches
  [8, 3], // slightly longer thatches
];

export const SECTION_COLORS = ['#00BCD4', '#009688', '#4CAF50'] as const;

/**
 * Get visual style for a section by index
 * Cycles through patterns first, then colors
 */
export function getSectionStyle(index: number) {
  const patternIndex = index % SECTION_PATTERNS.length;
  const colorIndex = Math.floor(index / SECTION_PATTERNS.length) % SECTION_COLORS.length;
  return {
    pattern: SECTION_PATTERNS[patternIndex],
    color: SECTION_COLORS[colorIndex],
    patternIndex,
    colorIndex,
  };
}
