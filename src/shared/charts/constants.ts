/**
 * Chart-related constants
 *
 * Gesture thresholds shared by the charts.
 */

/**
 * Chart gesture configuration.
 */
export const CHART_CONFIG = {
  /**
   * Movement that starts a drag-activated scrub.
   *
   * In pixels. Only used by charts that scrub on movement rather than on a
   * long press, where the same surface also answers a tap.
   *
   * @defaultValue 4
   */
  DRAG_SLOP: 4,

  /**
   * Longest touch still treated as a tap.
   *
   * In milliseconds. Anything held longer belongs to the scrub gesture.
   *
   * @defaultValue 200
   */
  TAP_MAX_DURATION: 200,
} as const;
