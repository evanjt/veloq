import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { CartesianChart, Area } from 'victory-native';
import {
  LinearGradient,
  vec,
  Line as SkiaLine,
  DashPathEffect,
  Rect,
} from '@shopify/react-native-skia';
import { POWER_ZONE_COLORS, HR_ZONE_COLORS } from '@/hooks';
import { isCyclingActivity } from '@/lib';
import { ChartErrorBoundary } from '@/components/ui';
import { CHART_CONFIG } from '@/constants';
import { colors, darkColors, spacing, layout } from '@/theme';
import type { ActivityStreams, ActivityInterval, ActivityType } from '@/types';

const CHART_PADDING = { left: 0, right: 0, top: 4, bottom: 4 } as const;
const NORMALIZED_DOMAIN = { y: [0, 1] as [number, number] };

interface IntervalsChartProps {
  streams: ActivityStreams;
  intervals: ActivityInterval[];
  activityType: ActivityType;
  isDark: boolean;
  height?: number;
}

interface IntervalBand {
  startX: number;
  endX: number;
  color: string;
  opacity: number;
  avgY: number | null; // normalized 0-1, null if no avg line
  isWork: boolean;
}

// Z7 is near-black (#1A1A1A) — invisible on dark backgrounds
const Z7_DARK_OVERRIDE = '#B0B0B0';

function getIntervalColor(
  interval: ActivityInterval,
  isCycling: boolean,
  isDark: boolean
): { color: string; opacity: number } {
  const isWork = interval.type === 'WORK';
  const isRecovery = interval.type === 'RECOVERY' || interval.type === 'REST';

  if (isWork) {
    if (interval.zone != null && interval.zone >= 1) {
      const zoneColors = isCycling ? POWER_ZONE_COLORS : HR_ZONE_COLORS;
      const idx = Math.min(interval.zone - 1, zoneColors.length - 1);
      let color = zoneColors[idx];
      if (isDark && interval.zone === 7) color = Z7_DARK_OVERRIDE;
      return { color, opacity: 0.25 };
    }
    return { color: colors.primary, opacity: 0.2 };
  }

  if (isRecovery) {
    return { color: '#808080', opacity: 0.12 };
  }

  if (interval.type === 'WARMUP') {
    return { color: '#22C55E', opacity: 0.18 };
  }

  if (interval.type === 'COOLDOWN') {
    return { color: '#8B5CF6', opacity: 0.18 };
  }

  return { color: '#808080', opacity: 0.1 };
}

export function IntervalsChart({
  streams,
  intervals,
  activityType,
  isDark,
  height = 200,
}: IntervalsChartProps) {
  const isCycling = isCyclingActivity(activityType);

  // Pick primary stream: power for cycling, HR for running/other
  const primaryStream = useMemo(() => {
    if (isCycling && streams.watts?.length) return streams.watts;
    if (streams.heartrate?.length) return streams.heartrate;
    if (streams.watts?.length) return streams.watts;
    return null;
  }, [isCycling, streams.watts, streams.heartrate]);

  const primaryColor = useMemo(() => {
    if (isCycling && streams.watts?.length) return colors.chartPurple;
    if (streams.heartrate?.length) return colors.chartPink;
    return colors.chartPurple;
  }, [isCycling, streams.watts, streams.heartrate]);

  // Downsample + normalize
  const { chartData, rawMin, rawMax, timeArray } = useMemo(() => {
    if (!primaryStream || !streams.time?.length) {
      return { chartData: [], rawMin: 0, rawMax: 1, timeArray: [] };
    }

    const time = streams.time;
    const maxPoints = CHART_CONFIG.MAX_DATA_POINTS;
    const step = Math.max(1, Math.floor(time.length / maxPoints));

    // Calculate range
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < primaryStream.length; i++) {
      const v = primaryStream[i];
      if (isFinite(v)) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    if (!isFinite(min)) min = 0;
    if (!isFinite(max) || max === min) max = min + 1;
    const range = max - min;

    const data: { x: number; primary: number }[] = [];
    for (let i = 0; i < time.length; i += step) {
      const raw = primaryStream[i] ?? 0;
      const normalized = Math.max(0, Math.min(1, (raw - min) / range));
      data.push({ x: time[i], primary: normalized });
    }

    return { chartData: data, rawMin: min, rawMax: max, timeArray: time };
  }, [primaryStream, streams.time]);

  // Compute interval bands
  const bands = useMemo((): IntervalBand[] => {
    if (!timeArray.length || chartData.length === 0) return [];

    const rawMin2 = rawMin;
    const rawMax2 = rawMax;
    const range = rawMax2 - rawMin2 || 1;

    return intervals.map((interval) => {
      const startIdx = Math.max(0, Math.min(interval.start_index, timeArray.length - 1));
      const endIdx = Math.max(0, Math.min(interval.end_index, timeArray.length - 1));
      const startX = timeArray[startIdx];
      const endX = timeArray[endIdx];
      const { color, opacity } = getIntervalColor(interval, isCycling, isDark);
      const isWork = interval.type === 'WORK';

      let avgY: number | null = null;
      if (isWork) {
        const avgValue = isCycling ? interval.average_watts : interval.average_heartrate;
        if (avgValue != null && isFinite(avgValue)) {
          avgY = Math.max(0, Math.min(1, (avgValue - rawMin2) / range));
        }
      }

      return { startX, endX, color, opacity, avgY, isWork };
    });
  }, [intervals, timeArray, chartData.length, rawMin, rawMax, isCycling]);

  if (chartData.length === 0 || !primaryStream) return null;

  const minX = chartData[0].x;
  const maxX = chartData[chartData.length - 1].x;
  const xRange = maxX - minX || 1;

  return (
    <ChartErrorBoundary height={height} label="Intervals">
      <View style={{ height }}>
        <CartesianChart
          data={chartData}
          xKey="x"
          yKeys={['primary']}
          domain={NORMALIZED_DOMAIN}
          padding={CHART_PADDING}
        >
          {({
            points,
            chartBounds,
          }: {
            points: Record<string, Array<{ x: number }>>;
            chartBounds: { left: number; right: number; top: number; bottom: number };
          }) => {
            const chartWidth = chartBounds.right - chartBounds.left;
            const chartHeight = chartBounds.bottom - chartBounds.top;

            const xPixel = (xVal: number) => {
              const ratio = (xVal - minX) / xRange;
              return chartBounds.left + ratio * chartWidth;
            };

            const yPixel = (normVal: number) => {
              return chartBounds.top + (1 - normVal) * chartHeight;
            };

            return (
              <>
                {/* Interval bands */}
                {bands.map((band, i) => {
                  const x1 = xPixel(band.startX);
                  const x2 = xPixel(band.endX);
                  const w = Math.max(1, x2 - x1);
                  return (
                    <Rect
                      key={`band-${i}`}
                      x={x1}
                      y={chartBounds.top}
                      width={w}
                      height={chartHeight}
                      color={band.color}
                      opacity={band.opacity}
                    />
                  );
                })}

                {/* Primary stream area */}
                <Area
                  points={points.primary as Parameters<typeof Area>[0]['points']}
                  y0={chartBounds.bottom}
                  curveType="natural"
                  opacity={0.85}
                >
                  <LinearGradient
                    start={vec(0, chartBounds.top)}
                    end={vec(0, chartBounds.bottom)}
                    colors={[primaryColor + 'AA', primaryColor + '20']}
                  />
                </Area>

                {/* Dashed avg lines per WORK interval */}
                {bands.map((band, i) => {
                  if (!band.isWork || band.avgY == null) return null;
                  const x1 = xPixel(band.startX);
                  const x2 = xPixel(band.endX);
                  const y = yPixel(band.avgY);
                  return (
                    <SkiaLine
                      key={`avg-${i}`}
                      p1={vec(x1, y)}
                      p2={vec(x2, y)}
                      color={band.color}
                      strokeWidth={1.5}
                      opacity={0.7}
                    >
                      <DashPathEffect intervals={[4, 3]} />
                    </SkiaLine>
                  );
                })}
              </>
            );
          }}
        </CartesianChart>
      </View>
    </ChartErrorBoundary>
  );
}
