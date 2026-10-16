/**
 * What an activity holds, drawn on one fixed demo activity: its map, and its elevation with the
 * hard intervals marked along it.
 */

import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { Canvas, Path, Rect } from '@shopify/react-native-skia';
import { useTheme } from '@/shared/app';
import { colors, darkColors, layout, spacing, colorWithOpacity } from '@/theme';
import { tourPanelColour } from './tourPanel';
import { DEMO_INTERVALS, demoElevationPath, demoTrackPath } from '../../lib/tourActivityDemo';

const MAP_SIZE = 96;
const CHART_WIDTH = 140;
const PAD = 10;
const AREA_OPACITY = 0.18;
const INTERVAL_OPACITY = 0.22;
const TRACK_STROKE = 2.5;
const ELEVATION_STROKE = 1.5;

export function ActivitySlide() {
  const { isDark } = useTheme();
  const palette = isDark ? darkColors : colors;
  const background = tourPanelColour(isDark);

  const picture = useMemo(() => {
    const usable = CHART_WIDTH - PAD * 2;
    return {
      track: demoTrackPath(0, MAP_SIZE, PAD),
      area: demoElevationPath(CHART_WIDTH, MAP_SIZE, PAD, true),
      line: demoElevationPath(CHART_WIDTH, MAP_SIZE, PAD, false),
      intervals: DEMO_INTERVALS.map(({ start, end }) => ({
        x: PAD + start * usable,
        width: (end - start) * usable,
      })),
    };
  }, []);

  return (
    <View style={styles.row} testID="tour-activity-picture">
      <View style={[styles.panel, { backgroundColor: background }]}>
        <Canvas style={{ width: MAP_SIZE, height: MAP_SIZE }}>
          <Path
            path={picture.track}
            style="stroke"
            strokeWidth={TRACK_STROKE}
            strokeJoin="round"
            strokeCap="round"
            color={palette.primary}
          />
        </Canvas>
      </View>
      <View style={[styles.panel, { backgroundColor: background }]}>
        <Canvas style={{ width: CHART_WIDTH, height: MAP_SIZE }}>
          {picture.intervals.map((interval, i) => (
            <Rect
              key={i}
              x={interval.x}
              y={PAD}
              width={interval.width}
              height={MAP_SIZE - PAD * 2}
              color={colorWithOpacity(colors.chartAmber, INTERVAL_OPACITY)}
            />
          ))}
          <Path path={picture.area} color={colorWithOpacity(palette.primary, AREA_OPACITY)} />
          <Path
            path={picture.line}
            style="stroke"
            strokeWidth={ELEVATION_STROKE}
            strokeJoin="round"
            color={palette.primary}
          />
        </Canvas>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  panel: {
    borderRadius: layout.borderRadiusMd,
    overflow: 'hidden',
  },
});
