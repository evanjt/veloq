/**
 * Performance budgets for the map surfaces.
 *
 * These numbers were tuned against real traces on mid-range Android hardware.
 * They live together so a change is a deliberate, reviewable edit rather than a
 * magic number buried in a component.
 */

/** Chart-scrub highlight updates. One frame at 60fps. */
export const HIGHLIGHT_THROTTLE_MS = 16;

/**
 * Section trim map updates. The Reanimated slider stays on the UI thread at
 * 60fps and emits sparsely, so the map only has to keep up coarsely.
 */
export const TRIM_UPDATE_THROTTLE_MS = 100;

/** Camera reporting while a gesture is still in flight. */
export const REGION_CHANGE_DEBOUNCE_MS = 200;

/** Work deferred until a gesture has settled, such as recomputing attribution. */
export const REGION_SETTLE_DEBOUNCE_MS = 300;

/**
 * Activity count above which the regional map culls to the viewport. Below it
 * the whole set is drawn, because filtering costs more than it saves.
 */
export const VIEWPORT_CULLING_THRESHOLD = 2000;

/** Zoom at which the regional map starts drawing per-activity detail. */
export const TRACE_ZOOM_THRESHOLD = 11;

/**
 * How long the 3D terrain page may take to report itself ready before it is
 * treated as failed. The page arms this before it touches maplibregl, so a
 * missing CDN bundle or a style that never loads still ends somewhere instead
 * of leaving the hero on a spinner.
 */
export const MAP_3D_READY_TIMEOUT_MS = 15000;

/**
 * How long a 2D map page may take to report itself ready before it is treated
 * as failed. The page arms this before it touches maplibregl, so a renderer
 * that never arrives from the CDN leaves a message rather than a blank
 * rectangle.
 */
export const MAP_SURFACE_READY_TIMEOUT_MS = 15000;
