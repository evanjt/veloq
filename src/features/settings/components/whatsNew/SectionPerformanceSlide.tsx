/**
 * What the section page shows, drawn on fixed demo attempts and captioned with the panel's own
 * view names: every attempt over time with its trend and Pearson r, the spread of times, seconds
 * ahead or behind along the section, and the line coloured where the newest attempt gained or
 * lost.
 */

import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { Canvas, Line, Path, Rect, vec } from '@shopify/react-native-skia';
import { useTheme } from '@/shared/app';
import {
  ChartDot,
  RecordRing,
  RecordStaircase,
  RETICLE_REACH,
  ReticleMark,
  chartStroke,
  useMeasuredWidth,
} from '@/shared/charts';
import { directionColour, PLOT_LABEL_KEYS } from '@/features/routes';
import {
  colors,
  darkColors,
  layout,
  mapPalette,
  spacing,
  typography,
  colorWithOpacity,
  ink,
  opacity,
  type MapDivStep,
} from '@/theme';
import { tourPanelColour } from './tourPanel';
import {
  TOUR_DEMO_ATTEMPTS,
  demoDeltaCurves,
  demoHistogram,
  demoLineStretches,
  demoRecordSteps,
  demoTrendEnds,
  demoTrendR,
  type StretchKind,
} from '../../lib/tourSectionDemo';
import { formatDecimal } from '@/shared/format';

const PANEL_HEIGHT = 64;
const PAD = 6;
const HISTOGRAM_BINS = 6;
const FAINT_OPACITY = 0.3;

/** The step of the map line's ramp each demo stretch is drawn in, as the section map bands it. */
const STRETCH_STEPS: Record<StretchKind, MapDivStep> = {
  won: 'cool-2',
  lost: 'warm-2',
  level: 'mid',
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
  // The demo line sits on a panel of the app theme, so it takes that base's ramp.
  const stretchRamp = mapPalette(isDark ? 'dark' : 'light').div;
  const gridColor = isDark
    ? colorWithOpacity(ink.white, opacity.tint4)
    : colorWithOpacity(ink.black, opacity.tint3);
  // Two panels to a row of the slide's own width, with the grid's gap between them.
  const panelWidth = Math.max(0, Math.floor((gridWidth - spacing.sm) / 2));
  const inner = panelWidth - PAD * 2;

  const pictures = useMemo(() => {
    const times = TOUR_DEMO_ATTEMPTS.map((a) => a.timeSecs);
    const slowest = Math.max(...times);
    const fastest = Math.min(...times);
    // Faster is higher, as the section page draws it.
    // The scatter is inset by the reticle's reach, so the marks round its newest attempt stay
    // inside the panel.
    const scatterInner = panelWidth - PAD - RETICLE_REACH;
    const timeY = (secs: number) =>
      RETICLE_REACH + ((secs - fastest) / (slowest - fastest)) * (PANEL_HEIGHT - RETICLE_REACH * 2);
    const points = times.map((secs, i) => ({
      x: PAD + (i / (times.length - 1)) * scatterInner,
      y: timeY(secs),
    }));
    const [trendFirst, trendLast] = demoTrendEnds();
    const recordSteps = demoRecordSteps().flatMap((i) => {
      const point = points[i];
      return point ? [point] : [];
    });

    const bins = demoHistogram(HISTOGRAM_BINS);
    const tallest = Math.max(...bins);
    const barWidth = inner / HISTOGRAM_BINS;

    const curves = demoDeltaCurves();
    const deltaMax = Math.max(...curves.flat().map(Math.abs));
    // Ahead of the reference is drawn above the zero line, as the delta chart does.
    const deltaPaths = curves.map((curve) => linePath(curve, panelWidth, -deltaMax, deltaMax));

    const stretches = demoLineStretches().map((stretch) => ({
      ...stretch,
      p1: sectionShape(stretch.from, panelWidth),
      p2: sectionShape(stretch.to, panelWidth),
    }));

    return {
      points,
      recordSteps,
      trendStart: vec(PAD, timeY(trendFirst)),
      trendEnd: vec(PAD + scatterInner, timeY(trendLast)),
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
  const scatterColour = directionColour('forward', isDark);
  const newest = pictures.points.at(-1);
  const captionColor = palette.textSecondary;

  return (
    <View style={styles.grid} testID="tour-section-pictures" onLayout={onLayout}>
      {panelWidth > 0 && (
        <>
          <Panel
            width={panelWidth}
            caption={t(PLOT_LABEL_KEYS.scatter)}
            captionColor={captionColor}
            background={background}
            overlay={
              <Text style={[styles.rLabel, { color: palette.textPrimary }]}>
                {t('whatsNew.v040.sectionPageTrendR', { r: r === null ? '' : formatDecimal(r, 2) })}
              </Text>
            }
          >
            {/* The section page's own marks: dots in the direction's colour, its trend, the
                record's staircase, and the newest attempt, which holds the record, carrying
                both the record ring and the reticle. */}
            <Line
              p1={pictures.trendStart}
              p2={pictures.trendEnd}
              color={scatterColour}
              strokeWidth={chartStroke.series}
              strokeCap="round"
            />
            <RecordStaircase steps={pictures.recordSteps} />
            {pictures.points.map((p, i) => (
              <ChartDot key={i} x={p.x} y={p.y} color={scatterColour} />
            ))}
            {newest ? (
              <>
                <RecordRing x={newest.x} y={newest.y} />
                <ReticleMark x={newest.x} y={newest.y} />
              </>
            ) : null}
          </Panel>
          <Panel
            width={panelWidth}
            caption={t(PLOT_LABEL_KEYS.histogram)}
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
                color={palette.actionPrimary}
              />
            ))}
          </Panel>
          <Panel
            width={panelWidth}
            caption={t(PLOT_LABEL_KEYS.delta)}
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
                    newest
                      ? palette.actionPrimary
                      : colorWithOpacity(palette.actionPrimary, FAINT_OPACITY)
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
                color={stretchRamp[STRETCH_STEPS[stretch.kind]]}
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
