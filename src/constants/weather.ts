/**
 * @fileoverview Weather-related constants
 *
 * Temperature thresholds and weather condition classifications
 * for activity statistics and UI display.
 */

/**
 * Temperature thresholds in Celsius.
 *
 * Used for color-coding temperature display and
 * categorizing weather conditions.
 */
export const TEMPERATURE_THRESHOLDS = {
  /**
   * Hot threshold.
   *
   * Temperatures above this value are considered "hot"
   * for athletic activities. Displayed with amber color.
   *
   * @defaultValue 28°C (82°F)
   */
  HOT: 28,

  /**
   * Cold threshold.
   *
   * Temperatures below this value are considered "cold"
   * for athletic activities. Displayed with blue color.
   *
   * @defaultValue 10°C (50°F)
   */
  COLD: 10,

  /**
   * Freezing threshold.
   *
   * Temperatures at or below freezing point.
   *
   * @defaultValue 0°C (32°F)
   */
  FREEZING: 0,
} as const;

/**
 * Wind speed thresholds in meters per second.
 *
 * Used to determine when to display wind information
 * and classify wind conditions.
 */
export const WIND_THRESHOLDS = {
  /**
   * Minimum wind speed for display.
   *
   * Wind speeds below this threshold are not shown
   * to avoid cluttering the UI with negligible data.
   *
   * @defaultValue 2 m/s (~4.5 mph / 7 km/h)
   */
  DISPLAY_MIN: 2,

  /**
   * Breeze threshold.
   *
   * Wind speeds above this are noticeable during activity.
   *
   * @defaultValue 5 m/s (~11 mph / 18 km/h)
   */
  BREEZE: 5,

  /**
   * Strong wind threshold.
   *
   * Wind speeds above this significantly impact activity.
   *
   * @defaultValue 10 m/s (~22 mph / 36 km/h)
   */
  STRONG: 10,
} as const;

/**
 * "Feels like" temperature delta threshold.
 *
 * Minimum difference between actual temperature and
 * "feels like" temperature before showing theFeels like value.
 *
 * @defaultValue 2°C
 */
export const FEELS_LIKE_THRESHOLD = 2;

/**
 * Humidity thresholds.
 *
 * Classifications for humidity levels.
 */
export const HUMIDITY_THRESHOLDS = {
  /** High humidity threshold */
  HIGH: 70, // %

  /** Low humidity threshold */
  LOW: 30, // %
} as const;
