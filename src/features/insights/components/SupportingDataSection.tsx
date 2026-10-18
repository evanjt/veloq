import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { Canvas, Path } from '@shopify/react-native-skia';
import { chartStroke, LINE_CAP, LINE_JOIN } from '@/shared/charts';
import { useTranslation } from 'react-i18next';
import type { InsightCategory, TFunc } from '../types';
import { sectionRowKey, sectionWithSport } from '../lib/cardSport';
import { rowTrendColor, rowTrendIcon, rowTrendWord } from '../lib/rowTrend';
import { navigateTo } from '@/shared/app/navigation';
import { useTheme } from '@/shared/app';
import {
  colors,
  darkColors,
  iconSize,
  layout,
  opacity,
  spacing,
  typography,
  verdictColor,
  verdictFill,
  themePalette,
} from '@/theme';
import { InsightHistoryChart } from './InsightHistoryChart';
import { formatDuration } from '@/shared/format/format';
import type { InsightSupportingData } from '@/types';
import { composeAccessibilityLabel, Row } from '@/shared/ui';
import { Icon } from '@/shared/ui/Icon';
import { TrackPreview, normaliseTrackPoints } from '@/shared/ui/TrackPreview';
import { spokenVerdict } from '@/shared/format/spoken';
import { verdictIcon, verdictRung } from '@/shared/format/trend';
import type { LatLngShort } from '@/shared/geo/distance';
import { NameText } from '@/shared/ui/NameText';

const SPARKLINE_HEIGHT = 60;

interface SupportingDataSectionProps {
  data: InsightSupportingData;
  /** The card's category, which names the colour its history is drawn in. */
  category: InsightCategory;
}

/**
 * The section the record was set on, as a thumbnail. A name like "Section 6"
 * says nothing about which stretch of road it is, and the engine hands the
 * line over with the row rather than the card reading geometry of its own.
 */
function SectionPreview({
  sectionId,
  points,
}: {
  sectionId: string;
  points?: LatLngShort[] | undefined;
}) {
  const { isDark } = useTheme();
  const palette = themePalette(isDark);
  const normalised = useMemo(() => normaliseTrackPoints(points ?? []), [points]);
  if (normalised.length < 2) return null;
  return (
    <TrackPreview
      testID={`section-preview-${sectionId}`}
      points={normalised}
      color={palette.actionPrimary}
      isDark={isDark}
    />
  );
}

function buildSparklinePath(
  data: number[],
  width: number,
  height: number,
  padding: number
): string {
  if (data.length < 2) return '';
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const drawH = height - padding * 2;
  const stepX = width / (data.length - 1);

  const points = data.map((v, i) => ({
    x: i * stepX,
    y: padding + drawH - ((v - min) / range) * drawH,
  }));

  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    d += ` L ${points[i].x} ${points[i].y}`;
  }
  return d;
}

export const SupportingDataSection = React.memo(function SupportingDataSection({
  data,
  category,
}: SupportingDataSectionProps) {
  const { isDark } = useTheme();
  const { t } = useTranslation();

  const comparison = data.comparisonData ?? null;
  const sections = data.sections?.length ? data.sections : null;

  // The generator judged the series where the metric is known, so a falling
  // efficiency ratio arrives as an improvement. The sparkline and the
  // comparison both draw that one move. A move with no verdict is drawn on the
  // neutral rung: the sparkline draws no arrow for it, since its first and last
  // points say which way it went and not whether that was good, and the
  // comparison draws a dash.
  const trend = data.trend;
  const trendRung = trend ? verdictRung(trend.verdict) : 'neutral';
  const trendColor = verdictColor(trendRung, isDark);
  const trendGlyph = trend ? verdictIcon(trend.verdict, trend.direction) : null;

  return (
    <View style={styles.container}>
      <InsightHistoryChart
        history={data.history}
        category={category}
        accessory={
          trendGlyph && trendGlyph !== 'minus' ? (
            <Icon
              name={trendGlyph}
              size={iconSize.md}
              color={trendColor}
              accessibilityLabel={trend ? spokenVerdict(trend.verdict, trend.direction) : undefined}
            />
          ) : null
        }
      />

      {/* Comparison Card */}
      {comparison ? (
        <View
          style={[
            styles.comparisonCard,
            isDark && styles.comparisonCardDark,
            trendRung !== 'neutral' && { backgroundColor: verdictFill(trendRung, isDark) },
          ]}
        >
          <View style={styles.comparisonColumns}>
            <View style={styles.comparisonColumn}>
              <Text style={[styles.comparisonHeader, isDark && styles.comparisonHeaderDark]}>
                {t('insights.current', 'Current')}
              </Text>
              <Text style={[styles.comparisonValue, isDark && styles.comparisonValueDark]}>
                {String(comparison.current.value)}
                {comparison.current.unit ? ` ${comparison.current.unit}` : ''}
              </Text>
              <Text style={[styles.comparisonLabel, isDark && styles.comparisonLabelDark]}>
                {comparison.current.label}
              </Text>
            </View>
            <View style={styles.comparisonDivider} />
            <View style={styles.comparisonColumn}>
              <Text style={[styles.comparisonHeader, isDark && styles.comparisonHeaderDark]}>
                {t('insights.previous', 'Previous')}
              </Text>
              <Text style={[styles.comparisonValue, isDark && styles.comparisonValueDark]}>
                {String(comparison.previous.value)}
                {comparison.previous.unit ? ` ${comparison.previous.unit}` : ''}
              </Text>
              <Text style={[styles.comparisonLabel, isDark && styles.comparisonLabelDark]}>
                {comparison.previous.label}
              </Text>
            </View>
          </View>
          <View style={styles.comparisonChange}>
            <Icon name={trendGlyph ?? 'minus'} size={iconSize.md} color={trendColor} />
            <Text style={[styles.comparisonChangeText, { color: trendColor }]}>
              {String(comparison.change.value)}
              {comparison.change.unit ? ` ${comparison.change.unit}` : ''}
            </Text>
          </View>
        </View>
      ) : null}

      {/* Section Links */}
      {sections ? (
        <View style={styles.sectionsContainer}>
          {sections.map((section) => {
            const name = sectionWithSport(
              section.sectionName,
              section.sportType,
              t as unknown as TFunc
            );
            const bestTime = section.bestTime != null ? formatDuration(section.bestTime) : null;
            const traversals =
              section.traversalCount != null
                ? t('sections.traversalsCount', { count: section.traversalCount })
                : null;
            return (
              <Row
                key={sectionRowKey(section)}
                behaviour="navigate"
                accessibilityLabel={composeAccessibilityLabel(
                  name,
                  bestTime,
                  traversals,
                  rowTrendWord(section.trend)
                )}
                onPress={() => navigateTo(`/section/${section.sectionId}`)}
              >
                <SectionPreview sectionId={section.sectionId} points={section.previewPoints} />
                <View style={styles.sectionContent}>
                  <NameText style={[styles.sectionName, isDark && styles.sectionNameDark]}>
                    {name}
                  </NameText>
                  <View style={styles.sectionMeta}>
                    {bestTime != null ? (
                      <Text style={[styles.sectionBestTime, isDark && styles.sectionBestTimeDark]}>
                        {bestTime}
                      </Text>
                    ) : null}
                    {traversals != null ? (
                      <Text
                        style={[styles.sectionTraversals, isDark && styles.sectionTraversalsDark]}
                      >
                        {traversals}
                      </Text>
                    ) : null}
                    <Icon
                      name={rowTrendIcon(section.trend)}
                      size={iconSize.sm}
                      color={rowTrendColor(section.trend, isDark)}
                    />
                  </View>
                </View>
              </Row>
            );
          })}
        </View>
      ) : null}
    </View>
  );
});

/** Inline Skia sparkline, a bare line on the data's own range */
export const SparklineChart = React.memo(function SparklineChart({
  data,
  color,
  width = 280,
  height = SPARKLINE_HEIGHT,
}: {
  data: number[];
  color: string;
  width?: number;
  height?: number;
}) {
  const WIDTH = width;
  const PADDING = 4;

  const linePath = useMemo(
    () => buildSparklinePath(data, WIDTH, height, PADDING),
    [data, WIDTH, height]
  );

  if (!linePath) return null;

  return (
    <Canvas style={{ width: WIDTH, height }}>
      <Path
        path={linePath}
        style="stroke"
        strokeWidth={chartStroke.series}
        strokeJoin={LINE_JOIN}
        strokeCap={LINE_CAP}
        color={color}
      />
    </Canvas>
  );
});

const styles = StyleSheet.create({
  container: {
    marginTop: spacing.sm,
  },
  // Comparison
  comparisonCard: {
    borderRadius: layout.borderRadiusMd,
    padding: spacing.md,
    marginTop: spacing.sm,
    backgroundColor: opacity.overlay.subtle,
  },
  comparisonCardDark: {
    backgroundColor: opacity.overlayDark.light,
  },
  comparisonColumns: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  comparisonColumn: {
    flex: 1,
    alignItems: 'center',
  },
  comparisonDivider: {
    width: 1,
    height: 48,
    backgroundColor: opacity.overlay.light,
    marginHorizontal: spacing.sm,
  },
  comparisonHeader: {
    ...typography.label,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  comparisonHeaderDark: {
    color: darkColors.textSecondary,
  },
  comparisonValue: {
    ...typography.metricValue,
    color: colors.textPrimary,
  },
  comparisonValueDark: {
    color: darkColors.textPrimary,
  },
  comparisonLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.xxs,
  },
  comparisonLabelDark: {
    color: darkColors.textSecondary,
  },
  comparisonChange: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.sm,
    gap: spacing.xs,
  },
  comparisonChangeText: {
    ...typography.bodySmallBold,
    color: colors.textSecondary,
  },
  // Sections
  sectionsContainer: {
    marginTop: spacing.sm,
  },
  sectionContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionName: {
    ...typography.bodySmallBold,
    flex: 1,
    color: colors.textPrimary,
    marginRight: spacing.sm,
  },
  sectionNameDark: {
    color: darkColors.textPrimary,
  },
  sectionMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  sectionBestTime: {
    ...typography.bodyCompactBold,
    color: colors.textPrimary,
  },
  sectionBestTimeDark: {
    color: darkColors.textPrimary,
  },
  sectionTraversals: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  sectionTraversalsDark: {
    color: darkColors.textSecondary,
  },
});
