import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import {
  Canvas,
  RoundedRect,
  Path,
  Circle,
  Line,
  vec,
  DashPathEffect,
} from '@shopify/react-native-skia';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/hooks';
import { colors, darkColors, spacing } from '@/theme';

const COLS = 7;
const ROWS = 5;
const CELL_SIZE = 16;
const GAP = 3;

// Dark theme intensity colors (GitHub-style green scale)
const INTENSITY_COLORS = [
  '#161B22', // No activity
  '#0E4429', // Light
  '#006D32', // Medium-light
  '#26A641', // Medium
  '#39D353', // High
];

// Light theme intensity colors
const INTENSITY_COLORS_LIGHT = [
  '#EBEDF0', // No activity
  '#9BE9A8', // Light
  '#40C463', // Medium-light
  '#30A14E', // Medium
  '#216E39', // High
];

// Hardcoded intensity grid (5 rows x 7 cols)
const GRID: number[][] = [
  [0, 1, 2, 0, 3, 1, 0],
  [1, 3, 0, 2, 4, 0, 1],
  [0, 2, 4, 1, 0, 3, 2],
  [2, 0, 1, 3, 2, 4, 0],
  [1, 4, 0, 2, 1, 0, 3],
];

// Selected cell position (row 2, col 2 — a high-intensity day)
const SELECTED_ROW = 2;
const SELECTED_COL = 2;

const HEATMAP_WIDTH = COLS * (CELL_SIZE + GAP) - GAP;
const HEATMAP_HEIGHT = ROWS * (CELL_SIZE + GAP) - GAP;

// HRV sparkline data (illustrative, ~30 days)
const HRV_VALUES = [
  38, 42, 35, 48, 44, 40, 52, 45, 39, 55, 50, 43, 47, 58, 42, 53, 48, 44, 60, 55, 50, 46, 52, 48,
  56, 51, 45, 62, 58, 52,
];
const SPARKLINE_WIDTH = HEATMAP_WIDTH;
const SPARKLINE_HEIGHT = 40;
const SPARKLINE_PADDING = 4;

// RHR sparkline data (illustrative, ~30 days)
const RHR_VALUES = [
  58, 56, 59, 55, 57, 60, 54, 56, 58, 53, 55, 57, 52, 54, 58, 53, 55, 57, 51, 53, 55, 57, 54, 56,
  52, 54, 57, 50, 52, 54,
];

// Build Skia path from values
function buildSparklinePath(
  values: number[],
  width: number,
  height: number,
  padX: number,
  padY: number
): string {
  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const range = maxVal - minVal || 1;
  const drawW = width - padX * 2;
  const drawH = height - padY * 2;

  return values
    .map((v, i) => {
      const x = padX + (i / (values.length - 1)) * drawW;
      const y = padY + drawH - ((v - minVal) / range) * drawH;
      return `${i === 0 ? 'M' : 'L'}${x},${y}`;
    })
    .join(' ');
}

// Compute selected point position on sparkline
function getPointPos(
  values: number[],
  index: number,
  width: number,
  height: number,
  padX: number,
  padY: number
) {
  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const range = maxVal - minVal || 1;
  const drawW = width - padX * 2;
  const drawH = height - padY * 2;
  const x = padX + (index / (values.length - 1)) * drawW;
  const y = padY + drawH - ((values[index] - minVal) / range) * drawH;
  return { x, y };
}

// Which data point corresponds to the selected heatmap cell
const SELECTED_DATA_INDEX = 18;

const HRV_COLOR = '#EC4899'; // Pink
const RHR_COLOR = '#EF4444'; // Red

export function HeatmapSlide() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const palette = isDark ? INTENSITY_COLORS : INTENSITY_COLORS_LIGHT;
  const primaryColor = isDark ? darkColors.primary : colors.primary;
  const mutedColor = isDark ? darkColors.textMuted : colors.textMuted;
  const dashLineColor = isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.15)';

  const selectedCellX = SELECTED_COL * (CELL_SIZE + GAP);
  const selectedCellY = SELECTED_ROW * (CELL_SIZE + GAP);

  const hrvPath = buildSparklinePath(
    HRV_VALUES,
    SPARKLINE_WIDTH,
    SPARKLINE_HEIGHT,
    SPARKLINE_PADDING,
    SPARKLINE_PADDING
  );
  const rhrPath = buildSparklinePath(
    RHR_VALUES,
    SPARKLINE_WIDTH,
    SPARKLINE_HEIGHT,
    SPARKLINE_PADDING,
    SPARKLINE_PADDING
  );

  const hrvPoint = getPointPos(
    HRV_VALUES,
    SELECTED_DATA_INDEX,
    SPARKLINE_WIDTH,
    SPARKLINE_HEIGHT,
    SPARKLINE_PADDING,
    SPARKLINE_PADDING
  );
  const rhrPoint = getPointPos(
    RHR_VALUES,
    SELECTED_DATA_INDEX,
    SPARKLINE_WIDTH,
    SPARKLINE_HEIGHT,
    SPARKLINE_PADDING,
    SPARKLINE_PADDING
  );

  const totalHeight = HEATMAP_HEIGHT + 8 + SPARKLINE_HEIGHT + 4 + SPARKLINE_HEIGHT;

  return (
    <View style={styles.container}>
      <Canvas style={{ width: HEATMAP_WIDTH, height: totalHeight }}>
        {/* Heatmap grid */}
        {GRID.flatMap((row, rowIdx) =>
          row.map((intensity, colIdx) => (
            <RoundedRect
              key={`cell-${rowIdx}-${colIdx}`}
              x={colIdx * (CELL_SIZE + GAP)}
              y={rowIdx * (CELL_SIZE + GAP)}
              width={CELL_SIZE}
              height={CELL_SIZE}
              r={3}
              color={palette[intensity]}
            />
          ))
        )}

        {/* Selected cell outline */}
        <RoundedRect
          x={selectedCellX - 1.5}
          y={selectedCellY - 1.5}
          width={CELL_SIZE + 3}
          height={CELL_SIZE + 3}
          r={4}
          color="transparent"
          style="stroke"
          strokeWidth={2}
        >
          {/* Workaround: use the color prop for stroke color via a nested approach */}
        </RoundedRect>
        {/* Outline as a separate stroked rect with primary color */}
        <RoundedRect
          x={selectedCellX - 1.5}
          y={selectedCellY - 1.5}
          width={CELL_SIZE + 3}
          height={CELL_SIZE + 3}
          r={4}
          color={primaryColor}
          style="stroke"
          strokeWidth={2}
        />

        {/* Vertical dashed line from selected cell to sparklines */}
        <Line
          p1={vec(hrvPoint.x, HEATMAP_HEIGHT + 4)}
          p2={vec(hrvPoint.x, totalHeight)}
          color={dashLineColor}
          strokeWidth={1}
        >
          <DashPathEffect intervals={[3, 3]} />
        </Line>

        {/* HRV sparkline */}
        <Path
          path={hrvPath}
          color={HRV_COLOR}
          style="stroke"
          strokeWidth={2}
          strokeCap="round"
          strokeJoin="round"
          transform={[{ translateY: HEATMAP_HEIGHT + 8 }]}
        />
        {/* HRV selected point */}
        <Circle cx={hrvPoint.x} cy={hrvPoint.y + HEATMAP_HEIGHT + 8} r={4} color={HRV_COLOR} />
        <Circle
          cx={hrvPoint.x}
          cy={hrvPoint.y + HEATMAP_HEIGHT + 8}
          r={2}
          color={isDark ? darkColors.surface : colors.surface}
        />

        {/* RHR sparkline */}
        <Path
          path={rhrPath}
          color={RHR_COLOR}
          style="stroke"
          strokeWidth={2}
          strokeCap="round"
          strokeJoin="round"
          transform={[{ translateY: HEATMAP_HEIGHT + 8 + SPARKLINE_HEIGHT + 4 }]}
        />
        {/* RHR selected point */}
        <Circle
          cx={rhrPoint.x}
          cy={rhrPoint.y + HEATMAP_HEIGHT + 8 + SPARKLINE_HEIGHT + 4}
          r={4}
          color={RHR_COLOR}
        />
        <Circle
          cx={rhrPoint.x}
          cy={rhrPoint.y + HEATMAP_HEIGHT + 8 + SPARKLINE_HEIGHT + 4}
          r={2}
          color={isDark ? darkColors.surface : colors.surface}
        />
      </Canvas>

      {/* Sparkline labels */}
      <View style={styles.labels}>
        <View style={styles.labelRow}>
          <View style={[styles.dot, { backgroundColor: HRV_COLOR }]} />
          <Text style={[styles.labelText, { color: mutedColor }]}>HRV</Text>
          <Text style={[styles.valueText, { color: HRV_COLOR }]}>
            {HRV_VALUES[SELECTED_DATA_INDEX]} ms
          </Text>
        </View>
        <View style={styles.labelRow}>
          <View style={[styles.dot, { backgroundColor: RHR_COLOR }]} />
          <Text style={[styles.labelText, { color: mutedColor }]}>
            {t('wellness.restingHR' as never)}
          </Text>
          <Text style={[styles.valueText, { color: RHR_COLOR }]}>
            {RHR_VALUES[SELECTED_DATA_INDEX]} bpm
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingVertical: 4,
    gap: spacing.sm,
  },
  labels: {
    gap: 4,
    alignSelf: 'stretch',
    paddingHorizontal: spacing.md,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  labelText: {
    fontSize: 12,
    fontWeight: '500',
    flex: 1,
  },
  valueText: {
    fontSize: 12,
    fontWeight: '600',
  },
});
