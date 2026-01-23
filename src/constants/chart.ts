/**
 * @fileoverview Chart-related constants
 *
 * Centralized configuration for chart performance, gesture handling,
 * and visualization parameters.
 */

/**
 * Chart performance configuration.
 *
 * Controls downsampling and data point limits to maintain
 * smooth performance on mobile devices.
 */
export const CHART_CONFIG = {
  /**
   * Maximum number of data points to display.
   *
   * Data is downsampled to this limit using interval-based sampling.
   * 200 points provides good balance between detail and performance.
   *
   * @defaultValue 200
   */
  MAX_DATA_POINTS: 200,

  /**
   * Long press duration for gesture activation.
   *
   * Duration in milliseconds to distinguish between scroll and long-press gestures.
   * 500ms matches iOS default long-press duration for discoverability.
   *
   * @defaultValue 500
   */
  LONG_PRESS_DURATION: 500,

  /**
   * Minimum distance for pan gesture.
   *
   * Minimum movement in pixels before pan gesture is recognized.
   * Prevents accidental pans from finger tremors.
   *
   * @defaultValue 10
   */
  PAN_THRESHOLD: 10,
} as const;

/**
 * Chart gesture velocity thresholds.
 *
 * Controls swipe/fling gesture recognition.
 */
export const GESTURE_VELOCITY = {
  /**
   * Minimum velocity for swipe gesture.
   *
   * In points per second. Below this threshold, gesture
   * is treated as a drag instead of a swipe.
   *
   * @defaultValue 400
   */
  SWIPE_THRESHOLD: 400,

  /**
   * Screen width percentage for swipe detection.
   *
   * Swipe must cover at least this percentage of screen width.
   *
   * @defaultValue 0.2 (20%)
   */
  SCREEN_COVERAGE: 0.2,
} as const;

/**
 * Chart animation durations.
 *
 * Timing constants for chart transitions and animations.
 */
export const CHART_ANIMATION_DURATION = {
  /** Crossfade duration when switching metrics (ms) */
  CROSSFADE: 300,

  /** Tooltip animation duration (ms) */
  TOOLTIP: 200,

  /** Data point highlight animation duration (ms) */
  HIGHLIGHT: 150,
} as const;
