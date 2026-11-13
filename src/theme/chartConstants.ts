// Plain numbers the charts share. No platform import, so the connect page's theme subset reads
// them without react-native.

/**
 * The height every view of a section or route performance panel draws its plot at: over time,
 * spread and ahead or behind. The densest of them, over time, sets it, so the panel's plot keeps
 * the same height when the view changes.
 */
export const PERFORMANCE_PLOT_HEIGHT = 220;

/**
 * The least height the region under the plot takes, in every view, so the panel's total does not
 * move when the view changes. It is zero until a device measurement of each view's total sizes it
 * to the tallest view.
 */
export const PERFORMANCE_BELOW_PLOT_HEIGHT = 0;
