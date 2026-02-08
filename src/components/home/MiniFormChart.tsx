/**
 * Mini Form chart with colored zones for the Summary Card.
 * Shows 7-day form trend with zone backgrounds (Fresh, Grey, Optimal, etc.)
 */
import React, { memo, useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { CartesianChart, Line } from 'victory-native';
import { Rect, Shadow } from '@shopify/react-native-skia';
import { useTheme } from '@/hooks';

// Form zone backgrounds (matching intervals.icu and FitnessFormChart)
const FORM_ZONES = {
  highRisk: { min: -Infinity, max: -30, color: 'rgba(239, 83, 80, 0.3)' },
  optimal: { min: -30, max: -10, color: 'rgba(76, 175, 80, 0.3)' },
  grey: { min: -10, max: 5, color: 'rgba(158, 158, 158, 0.2)' },
  fresh: { min: 5, max: 25, color: 'rgba(129, 199, 132, 0.3)' },
  transition: { min: 25, max: Infinity, color: 'rgba(100, 181, 246, 0.25)' },
};

// Get form line color based on current value
function getFormLineColor(form: number): string {
  if (form < -30) return '#EF5350'; // High Risk - Red
  if (form < -10) return '#66BB6A'; // Optimal - Green
  if (form < 5) return '#9E9E9E'; // Grey Zone - Grey
  if (form < 25) return '#81C784'; // Fresh - Light Green
  return '#64B5F6'; // Transition - Blue
}

interface MiniFormChartProps {
  /** Array of form values (oldest to newest, typically 7 days) */
  data: number[];
  /** Chart width */
  width?: number;
  /** Chart height */
  height?: number;
}

interface ChartDataPoint {
  x: number;
  form: number;
  [key: string]: number;
}

const CHART_PADDING = { left: 0, right: 0, top: 2, bottom: 2 } as const;

export const MiniFormChart = memo(function MiniFormChart({
  data,
  width = 140,
  height = 50,
}: MiniFormChartProps) {
  const { isDark } = useTheme();

  // Process data for the chart
  const { chartData, minForm, maxForm, currentForm } = useMemo(() => {
    if (!data || data.length === 0) {
      return { chartData: [], minForm: -30, maxForm: 25, currentForm: 0 };
    }

    const points: ChartDataPoint[] = data.map((form, idx) => ({
      x: idx,
      form,
    }));

    const min = Math.min(...data);
    const max = Math.max(...data);
    const current = data[data.length - 1];

    return {
      chartData: points,
      minForm: Math.min(min, -35),
      maxForm: Math.max(max, 30),
      currentForm: current,
    };
  }, [data]);

  if (chartData.length === 0) {
    return <View style={[styles.container, { width, height }]} />;
  }

  // Calculate form domain with padding
  const formDomain = {
    y: [Math.min(-35, minForm - 5), Math.max(30, maxForm + 5)] as [number, number],
  };

  const lineColor = getFormLineColor(currentForm);

  return (
    <View style={[styles.container, { width, height }]}>
      <CartesianChart
        data={chartData}
        xKey="x"
        yKeys={['form']}
        domain={formDomain}
        padding={CHART_PADDING}
      >
        {({ points, chartBounds }) => {
          const chartHeight = chartBounds.bottom - chartBounds.top;
          const yRange = formDomain.y[1] - formDomain.y[0];

          // Calculate y position for a form value
          const getY = (val: number) => {
            const ratio = (formDomain.y[1] - val) / yRange;
            return chartBounds.top + ratio * chartHeight;
          };

          return (
            <>
              {/* Zone backgrounds */}
              {/* High Risk zone (< -30) */}
              <Rect
                x={chartBounds.left}
                y={getY(-30)}
                width={chartBounds.right - chartBounds.left}
                height={chartBounds.bottom - getY(-30)}
                color={FORM_ZONES.highRisk.color}
              />
              {/* Optimal zone (-30 to -10) */}
              <Rect
                x={chartBounds.left}
                y={getY(-10)}
                width={chartBounds.right - chartBounds.left}
                height={getY(-30) - getY(-10)}
                color={FORM_ZONES.optimal.color}
              />
              {/* Grey zone (-10 to 5) */}
              <Rect
                x={chartBounds.left}
                y={getY(5)}
                width={chartBounds.right - chartBounds.left}
                height={getY(-10) - getY(5)}
                color={FORM_ZONES.grey.color}
              />
              {/* Fresh zone (5 to 25) */}
              <Rect
                x={chartBounds.left}
                y={getY(25)}
                width={chartBounds.right - chartBounds.left}
                height={getY(5) - getY(25)}
                color={FORM_ZONES.fresh.color}
              />
              {/* Transition zone (> 25) */}
              <Rect
                x={chartBounds.left}
                y={chartBounds.top}
                width={chartBounds.right - chartBounds.left}
                height={getY(25) - chartBounds.top}
                color={FORM_ZONES.transition.color}
              />

              {/* Zero line */}
              <Rect
                x={chartBounds.left}
                y={getY(0) - 0.5}
                width={chartBounds.right - chartBounds.left}
                height={1}
                color={isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.15)'}
              />

              {/* Form line with glow */}
              <Line points={points.form} color={lineColor} strokeWidth={2.5} curveType="natural">
                <Shadow dx={0} dy={0} blur={4} color={lineColor + '80'} />
              </Line>
            </>
          );
        }}
      </CartesianChart>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    borderRadius: 6,
    overflow: 'hidden',
  },
});
