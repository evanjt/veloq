/**
 * Chart base infrastructure components.
 *
 * Provides unified chart interaction and styling:
 * - useChartGestures: Gesture handling hook
 * - ChartContainer: Wrapper with loading/error states
 * - ChartCrosshair: Vertical indicator line
 * - ChartTooltip: Data value display
 */

export { useChartGestures } from './useChartGestures';
export type {
  ChartPoint,
  ChartBounds,
  ChartGestureOptions,
  ChartGestureResult,
} from './useChartGestures';

export { ChartContainer } from './ChartContainer';
export type { ChartContainerProps, ChartPadding } from './ChartContainer';

export { ChartCrosshair } from './ChartCrosshair';
export type { ChartCrosshairProps } from './ChartCrosshair';

export { ChartTooltip } from './ChartTooltip';
export type { ChartTooltipProps, TooltipValue } from './ChartTooltip';
