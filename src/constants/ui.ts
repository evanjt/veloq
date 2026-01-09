/**
 * @fileoverview UI-related constants
 *
 * Dimension constraints and sizing thresholds for UI components.
 */

/**
 * Maximum dimensions for UI elements.
 *
 * Prevents components from taking excessive space.
 */
export const DIMENSIONS = {
  /**
   * Maximum height for route card.
   *
   * Prevents route cards from expanding too far vertically
   * and pushing content below the fold.
   *
   * @defaultValue 400px
   */
  MAX_ROUTE_CARD_HEIGHT: 400,

  /**
   * Maximum width for modal dialogs.
   *
   * Ensures modals don't become too wide on large screens.
   *
   * @defaultValue 600px
   */
  MAX_MODAL_WIDTH: 600,

  /**
   * Maximum height for bottom sheets.
   *
   * Allows bottom sheet to expand but not cover entire screen.
   *
   * @defaultValue 80% of screen height
   */
  MAX_BOTTOM_SHEET_HEIGHT: 0.8,
} as const;

/**
 * Minimum tap target sizes.
 *
 * Ensures touch targets meet accessibility guidelines.
 */
export const TAP_TARGET = {
  /**
   * Minimum size for touchable elements.
   *
   * Matches WCAG AAA guidelines and iOS Human Interface Guidelines.
   *
   * @defaultValue 44px
   */
  MIN_SIZE: 44,

  /**
   * Recommended size for primary actions.
   *
   * Larger targets for frequently used or critical actions.
   *
   * @defaultValue 48px
   */
  RECOMMENDED_SIZE: 48,
} as const;

/**
 * Screen size breakpoints for responsive design.
 *
 * Used for layout adjustments across device sizes.
 */
export const BREAKPOINTS = {
  /**
   * Small screen breakpoint.
   *
   * Typical phone screen width.
   *
   * @defaultValue 375px
   */
  SMALL: 375,

  /**
   * Medium screen breakpoint.
   *
   * Large phones, small tablets.
   *
   * @defaultValue 768px
   */
  MEDIUM: 768,

  /**
   * Large screen breakpoint.
   *
   * Tablets and larger.
   *
   * @defaultValue 1024px
   */
  LARGE: 1024,
} as const;

/**
 * Animation duration constants.
 *
 * Standard timing for UI animations.
 */
export const ANIMATION_DURATION = {
  /** Quick transition (100ms) */
  FAST: 100,

  /** Standard transition (300ms) */
  NORMAL: 300,

  /** Slow transition (500ms) */
  SLOW: 500,
} as const;
