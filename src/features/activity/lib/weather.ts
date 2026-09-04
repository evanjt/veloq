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

export const FEELS_LIKE_THRESHOLD = 2;
