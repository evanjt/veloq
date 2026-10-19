/**
 * The feed, drawn on fixed demo activities: a card per activity, newest first, each with its map
 * beside lines standing for its name and figures.
 */

import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { Path } from '@shopify/react-native-skia';
import { Canvas } from '@/shared/ui/SkiaCanvas';
import { useTheme } from '@/shared/app';
import { colors, darkColors, layout, spacing, colorWithOpacity, ink } from '@/theme';
import { tourPanelColour } from './tourPanel';
import { DEMO_TRACK_COUNT, demoTrackPath } from '../../lib/tourActivityDemo';

const MAP_SIZE = 56;
const PAD = 8;
const CARD_WIDTH = 220;
const LINE_HEIGHT = 8;
const TRACK_STROKE = 2;
/** The figure lines stand in for text, so they sit fainter than the name line above them. */
const LINE_ALPHA_DARK = 0.18;
const LINE_ALPHA_LIGHT = 0.12;
/** Each figure line's width as a fraction of the space beside the map. */
const LINE_WIDTHS = [0.8, 0.55, 0.65];
/** Older cards are drawn fainter, so the newest reads as the top of the list. */
const CARD_OPACITY = [1, 0.55];

export function FeedSlide() {
  const { isDark } = useTheme();
  const palette = isDark ? darkColors : colors;
  const background = tourPanelColour(isDark);
  const lineColour = isDark
    ? colorWithOpacity(ink.white, LINE_ALPHA_DARK)
    : colorWithOpacity(ink.black, LINE_ALPHA_LIGHT);
  const tracks = useMemo(
    () => Array.from({ length: DEMO_TRACK_COUNT }, (_, i) => demoTrackPath(i, MAP_SIZE, PAD)),
    []
  );

  return (
    <View style={styles.list} testID="tour-feed-picture">
      {tracks.map((track, i) => (
        <View
          key={i}
          style={[styles.card, { backgroundColor: background, opacity: CARD_OPACITY[i] ?? 1 }]}
        >
          <Canvas style={{ width: MAP_SIZE, height: MAP_SIZE }}>
            <Path
              path={track}
              style="stroke"
              strokeWidth={TRACK_STROKE}
              strokeJoin="round"
              strokeCap="round"
              color={palette.actionPrimary}
            />
          </Canvas>
          <View style={styles.lines}>
            {LINE_WIDTHS.map((width, j) => (
              <View
                key={j}
                style={[
                  styles.line,
                  {
                    width: `${width * 100}%`,
                    backgroundColor: j === 0 ? palette.textSecondary : lineColour,
                  },
                ]}
              />
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    alignItems: 'center',
    gap: spacing.sm,
  },
  card: {
    width: CARD_WIDTH,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: layout.borderRadiusMd,
    overflow: 'hidden',
    paddingRight: spacing.sm,
    gap: spacing.sm,
  },
  lines: {
    flex: 1,
    gap: spacing.xs,
  },
  line: {
    height: LINE_HEIGHT,
    borderRadius: layout.borderRadiusXs,
  },
});
