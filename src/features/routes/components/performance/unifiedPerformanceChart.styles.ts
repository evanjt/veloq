import { StyleSheet } from 'react-native';

import { colors, darkColors } from '@/theme';

export const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    marginTop: 12,
    overflow: 'hidden',
  },
  containerDark: {
    backgroundColor: darkColors.surfaceCard,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 8,
  },
  title: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  legend: {
    flexDirection: 'row',
    gap: 8,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  legendDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  legendText: {
    fontSize: 10,
    color: colors.textMuted,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  summaryItem: {
    alignItems: 'center',
    flex: 1,
  },
  summaryValue: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  summaryLabel: {
    fontSize: 10,
    color: colors.textMuted,
    marginTop: 1,
  },
  tapTargetContainer: {
    ...StyleSheet.absoluteFill,
    paddingLeft: 40,
    paddingRight: 20,
  },
  yAxisOverlay: {
    position: 'absolute',
    left: 6,
    top: 16,
    bottom: 12,
    justifyContent: 'space-between',
  },
  timeAxis: {
    height: 32,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    position: 'relative',
  },
  timeAxisScroll: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  timeAxisContent: {
    height: 44,
    position: 'relative',
  },
  timeAxisLabel: {
    position: 'absolute',
    bottom: 8,
    fontSize: 9,
    color: colors.textMuted,
  },
  timeAxisDateLabel: {
    position: 'absolute',
    top: 4,
    width: 40,
    fontSize: 9,
    color: colors.textMuted,
    textAlign: 'center',
  },
  gapMarkerInAxisDark: {
    backgroundColor: darkColors.surfaceElevated,
    borderColor: darkColors.border,
  },
  gapMarkerInAxisBottom: {
    position: 'absolute',
    top: 18,
    width: 24,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 0,
    paddingHorizontal: 2,
    paddingVertical: 2,
    backgroundColor: colors.surface,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.border,
    opacity: 0.9,
  },
  gapMarkerExpanded: {
    position: 'absolute',
    top: 18,
    height: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: 4,
    backgroundColor: colors.surface,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.border,
    opacity: 0.9,
  },
  gapMarkerExpandedDark: {
    backgroundColor: darkColors.surfaceElevated,
    borderColor: darkColors.border,
  },
  gapMarkerExpandedText: {
    fontSize: 9,
    fontWeight: '500',
    color: colors.textMuted,
  },
  gapMarkerExpandedTextDark: {
    color: darkColors.textMuted,
  },
  gapLinesOverlay: {
    ...StyleSheet.absoluteFill,
    pointerEvents: 'none',
  },
  gapVerticalLine: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 0,
    borderLeftWidth: 1,
    borderLeftColor: colors.textMuted,
    opacity: 0.4,
  },
  gapVerticalLineDark: {
    borderLeftColor: '#888888',
    opacity: 0.5,
  },
  gapEdgeLine: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 2,
  },
  gapMarkerText: {
    fontSize: 8,
    color: colors.textMuted,
  },
  gapMarkerTextDark: {
    color: darkColors.textMuted,
  },
  timeAxisLabelFirst: {
    textAlign: 'left',
  },
  timeAxisLabelLast: {
    textAlign: 'right',
  },
  axisLabel: {
    fontSize: 9,
    color: colors.textMuted,
  },
  axisLabelDark: {
    color: darkColors.textMuted,
  },
  tooltipContainer: {
    minHeight: 52,
    paddingHorizontal: 12,
    paddingBottom: 10,
  },
  tooltipPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
    height: 44,
  },
  chartHint: {
    fontSize: 11,
    color: colors.textMuted,
    textAlign: 'center',
  },
  selectedTooltip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.background,
    padding: 10,
    borderRadius: 8,
  },
  selectedTooltipDark: {
    backgroundColor: darkColors.surfaceElevated,
  },
  tooltipLeft: {
    flex: 1,
    marginRight: 8,
  },
  tooltipName: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: 1,
  },
  tooltipMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  tooltipDate: {
    fontSize: 11,
    color: colors.textMuted,
  },
  reverseBadge: {
    padding: 1,
  },
  tooltipRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  tooltipSpeed: {
    fontSize: 14,
    fontWeight: '700',
  },
  textLight: {
    color: darkColors.textPrimary,
  },
  textMuted: {
    color: darkColors.textMuted,
  },
  crosshair: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 2,
    backgroundColor: colors.textPrimary,
    opacity: 0.6,
    marginLeft: -1, // Center the crosshair on the touch point
  },
  crosshairDark: {
    backgroundColor: darkColors.textPrimary,
  },
});
