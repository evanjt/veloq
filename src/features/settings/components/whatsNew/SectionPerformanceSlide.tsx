/**
 * What the section page shows, drawn on fixed demo attempts: every attempt over time with its
 * trend and Pearson r, the spread of times, seconds ahead or behind along the section, and the
 * line coloured where the newest attempt gained or lost.
 */

import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { Canvas, Circle, Line, Path, Rect, vec } from '@shopify/react-native-skia';
import { useTheme } from '@/shared/app';
import { useMeasuredWidth } from '@/shared/charts';
import {
  colors,
  darkColors,
  layout,
  mapLayerColors,
  spacing,
  typography,
  colorWithOpacity,
  ink,
} from '@/theme';
import { tourPanelColour } from './tourPanel';
import {
  TOUR_DEMO_ATTEMPTS,
  demoDeltaCurves,
  demoHistogram,
  demoLineStretches,
  demoTrendEnds,
  demoTrendR,
  type StretchKind,
} from '../../lib/tourSectionDemo';
import { formatDecimal } from '@/shared/format';

const PANEL_HEIGHT = 64;
const PAD = 6;
const HISTOGRAM_BINS = 6;
const FAINT_OPACITY = 0.3;

const STRETCH_COLOURS: Record<StretchKind, string> = {
  won: mapLayerColors.deltaWon,
  lost: mapLayerColors.deltaLost,
  level: mapLayerColors.deltaNeutral,
};

function linePath(values: readonly number[], width: number, min: number, max: number): string {
  const range = max - min || 1;
  return values
    .map((v, i) => {
      const x = PAD + (i / (values.length - 1)) * (width - PAD * 2);
      const y = PAD + ((v - min) / range) * (PANEL_HEIGHT - PAD * 2);
      return `${i === 0 ? 'M' : 'L'}${x},${y}`;
    })
    .join(' ');
}

/** The section's shape for the coloured-line picture, as x and y in the panel. */
function sectionShape(along: number, width: number): { x: number; y: number } {
  return {
    x: PAD + along * (width - PAD * 2),
    y: PANEL_HEIGHT / 2 + Math.sin(along * Math.PI * 2.2) * (PANEL_HEIGHT / 2 - PAD * 2),
  };
}

function Panel({
  width,
  caption,
  captionColor,
  background,
  children,
  overlay,
}: {
  width: number;
  caption: string;
  captionColor: string;
  background: string;
  children: React.ReactNode;
  overlay?: React.ReactNode;
}) {
  return (
    <View style={{ width }}>
      <View style={[styles.panel, { backgroundColor: background }]}>
        <Canvas style={{ width, height: PANEL_HEIGHT }}>{children}</Canvas>
        {overlay}
      </View>
      <Text style={[styles.caption, { color: captionColor }]}>{caption}</Text>
    </View>
  );
}

export function SectionPerformanceSlide() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const { width: gridWidth, onLayout } = useMeasuredWidth();
  const palette = isDark ? darkColors : colors;
  const background = tourPanelColour(isDark);
  const gridColor = isDark ? colorWithOpacity(ink.white, 0.25) : colorWithOpacity(ink.black, 0.2);
  // Two panels to a row of the slide's own width, with the grid's gap between them.
  const panelWidth = Math.max(0, Math.floor((gridWidth - spacing.sm) / 2));
  const inner = panelWidth - PAD * 2;

  const pictures = useMemo(() => {
    const times = TOUR_DEMO_ATTEMPTS.map((a) => a.timeSecs);
    const slowest = Math.max(...times);
    const fastest = Math.min(...times);
    // Faster is higher, as the section page draws it.
    const timeY = (secs: number) =>
      PAD + ((secs - fastest) / (slowest - fastest)) * (PANEL_HEIGHT - PAD * 2);
    const points = times.map((secs, i) => ({
      x: PAD + (i / (times.length - 1)) * inner,
      y: timeY(secs),
    }));
    const [trendFirst, trendLast] = demoTrendEnds();

    const bins = demoHistogram(HISTOGRAM_BINS);
    const tallest = Math.max(...bins);
    const barWidth = inner / HISTOGRAM_BINS;

    const curves = demoDeltaCurves();
    const deltaMax = Math.max(...curves.flat().map(Math.abs));
    // Ahead of the reference is drawn below the zero line, as the delta chart does.
    const deltaPaths = curves.map((curve) =>
      linePath(
        curve.map((secs) => -secs),
        panelWidth,
        -deltaMax,
        deltaMax
      )
    );

    const stretches = demoLineStretches().map((stretch) => ({
      ...stretch,
      p1: sectionShape(stretch.from, panelWidth),
      p2: sectionShape(stretch.to, panelWidth),
    }));

    return {
      points,
      trendStart: vec(PAD, timeY(trendFirst)),
      trendEnd: vec(PAD + inner, timeY(trendLast)),
      bars: bins.map((count, i) => ({
        x: PAD + i * barWidth + 1,
        width: barWidth - 2,
        height: (count / tallest) * (PANEL_HEIGHT - PAD * 2),
      })),
      deltaPaths,
      stretches,
    };
  }, [inner, panelWidth]);

  const r = demoTrendR();
  const captionColor = palette.textSecondary;

  return (
    <View style={styles.grid} testID="tour-section-pictures" onLayout={onLayout}>
      {panelWidth > 0 && (
        <>
          <Panel
            width={panelWidth}
            caption={t('whatsNew.v040.sectionPageTrend')}
            captionColor={captionColor}
            background={background}
            overlay={
              <Text style={[styles.rLabel, { color: palette.textPrimary }]}>
                {t('whatsNew.v040.sectionPageTrendR', { r: r === null ? '' : formatDecimal(r, 2) })}
              </Text>
            }
          >
            {pictures.points.map((p, i) => (
              <Circle key={i} cx={p.x} cy={p.y} r={2.5} color={palette.primary} />
            ))}
            <Line
              p1={pictures.trendStart}
              p2={pictures.trendEnd}
              color={palette.textPrimary}
              strokeWidth={1.5}
            />
          </Panel>
          <Panel
            width={panelWidth}
            caption={t('whatsNew.v040.sectionPageHistogram')}
            captionColor={captionColor}
            background={background}
          >
            {pictures.bars.map((bar, i) => (
              <Rect
                key={i}
                x={bar.x}
                y={PANEL_HEIGHT - PAD - bar.height}
                width={bar.width}
                height={bar.height}
                color={palette.primary}
              />
            ))}
          </Panel>
          <Panel
            width={panelWidth}
            caption={t('whatsNew.v040.sectionPageDelta')}
            captionColor={captionColor}
            background={background}
          >
            <Line
              p1={vec(PAD, PANEL_HEIGHT / 2)}
              p2={vec(panelWidth - PAD, PANEL_HEIGHT / 2)}
              color={gridColor}
              strokeWidth={1}
            />
            {pictures.deltaPaths.map((path, i) => {
              const newest = i === pictures.deltaPaths.length - 1;
              return (
                <Path
                  key={i}
                  path={path}
                  style="stroke"
                  strokeWidth={newest ? 2 : 1}
                  strokeJoin="round"
                  color={
                    newest ? palette.primary : colorWithOpacity(palette.primary, FAINT_OPACITY)
                  }
                />
              );
            })}
          </Panel>
          <Panel
            width={panelWidth}
            caption={t('whatsNew.v040.sectionPageLine')}
            captionColor={captionColor}
            background={background}
          >
            {pictures.stretches.map((stretch, i) => (
              <Line
                key={i}
                p1={vec(stretch.p1.x, stretch.p1.y)}
                p2={vec(stretch.p2.x, stretch.p2.y)}
                color={STRETCH_COLOURS[stretch.kind]}
                strokeWidth={4}
                strokeCap="round"
              />
            ))}
          </Panel>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  panel: {
    borderRadius: layout.borderRadiusMd,
    overflow: 'hidden',
  },
  caption: {
    ...typography.caption,
    marginTop: spacing.xs,
  },
  rLabel: {
    ...typography.micro,
    position: 'absolute',
    right: spacing.xs,
    bottom: spacing.xs,
  },
});
