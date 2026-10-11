import type { EdgeInsets } from 'react-native-safe-area-context';
import { spacing } from '@/theme';

export interface FullscreenPlotFrame {
  /** Container padding: the margin, or the system inset on that edge where it is deeper. */
  padding: EdgeInsets;
  /** The close button's absolute position, at the padded top-leading corner. */
  closeButton: { top: number; left: number };
  /** What the frame leaves for the plot under the chrome and above the bottom padding. */
  plotHeight: number;
}

/**
 * Geometry of the landscape full-screen plot, from the full-screen window's own
 * insets and height and the measured height of the controls row above the plot.
 * In landscape the sensor housing and a three-button navigation bar sit on a
 * side edge and the home indicator along the bottom, so every edge keeps clear
 * of its own inset, and the plot takes the height its chrome leaves rather than
 * a fixed share of the window.
 */
export function fullscreenPlotFrame(
  insets: EdgeInsets,
  frameHeight: number,
  chromeHeight: number
): FullscreenPlotFrame {
  const padding = {
    top: Math.max(insets.top, spacing.md),
    right: Math.max(insets.right, spacing.md),
    bottom: Math.max(insets.bottom, spacing.md),
    left: Math.max(insets.left, spacing.md),
  };
  return {
    padding,
    closeButton: { top: padding.top, left: padding.left },
    plotHeight: Math.max(0, frameHeight - padding.top - chromeHeight - padding.bottom),
  };
}
