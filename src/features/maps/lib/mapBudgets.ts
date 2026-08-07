/**
 * Performance budgets for the map surfaces.
 *
 * These numbers were tuned against real traces on mid-range Android hardware.
 * They live together so a change is a deliberate, reviewable edit rather than a
 * magic number buried in a component.
 */

/** Chart-scrub highlight updates. One frame at 60fps. */
export const HIGHLIGHT_THROTTLE_MS = 16;

/** Camera reporting while a gesture is still in flight. */
export const REGION_CHANGE_DEBOUNCE_MS = 200;
