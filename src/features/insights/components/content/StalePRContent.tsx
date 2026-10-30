import React, { useCallback, useMemo, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { sectionRowKey } from '../../lib/cardSport';
import { insightGraphicColour } from '../../lib/insightCategory';
import { useTheme } from '@/shared/app';
import { useSectionDetail } from '@/shared/native/useSectionDetail';
import { navigateTo } from '@/shared/app/navigation';
import { SectionMapView } from '@/features/routes';
import { fromInsightsPath } from '@/shared/app/sectionOrigin';
import { InsightSeriesChart } from '../InsightSeriesChart';
import { formatSeriesValue } from '../InsightHistoryChart';
import { useInsightSheet } from '../InsightSheetContext';
import {
  colorWithOpacity,
  colors,
  darkColors,
  ink,
  layout,
  opacity,
  spacing,
  typography,
} from '@/theme';
import type { HistorySeries, Insight, StalePrSheetSection } from '@/types';
import { ChartErrorBoundary, composeAccessibilityLabel, ErrorState, Row } from '@/shared/ui';
import { ToggleButton } from '@/shared/ui/Button';
import { Card } from '@/shared/ui/Card';
import { NameText } from '@/shared/ui/NameText';
import { SheetContext } from './SheetContext';

interface StalePRContentProps {
  insight: Insight;
}

const MAP_HEIGHT = 180;

/** The screen-reader action that opens the section the efforts were read from. */
const OPEN_PICTURED = 'openPictured';

/**
 * The selected section on a real basemap, still, one WebView whichever
 * section is selected. A tap opens the section on the record's activity.
 */
const SelectedSectionMap = React.memo(function SelectedSectionMap({
  entry,
  onOpen,
}: {
  entry: StalePrSheetSection;
  onOpen: (target: string) => void;
}) {
  const { t } = useTranslation();
  const { section, error, retry } = useSectionDetail(entry.sectionId);
  const open = useCallback(() => onOpen(entry.sectionTarget), [onOpen, entry.sectionTarget]);
  if (error !== undefined) {
    return (
      <ErrorState variant="inline" error={error} onRetry={retry} testID="section-read-failure" />
    );
  }
  if (!section) return null;
  return (
    <View testID="stale-pr-map" style={styles.map}>
      <SectionMapView
        section={section}
        sportType={entry.sportType}
        height={MAP_HEIGHT}
        interactive={false}
        onPress={open}
        pressLabel={t('insights.graphic.openTheSection')}
      />
    </View>
  );
});

/** The index of the point on the record's day, -1 when the series has none. */
function recordIndex(series: HistorySeries, prDate: number): number {
  return series.points.findIndex((point) => point.date === prDate);
}

/**
 * The selected section's fitness above its efforts, over one time axis that
 * runs to now. The record's day is marked on both, and the time since the
 * last visit is shaded.
 */
const StalePrChart = React.memo(function StalePrChart({
  entry,
  insight,
  onOpen,
}: {
  entry: StalePrSheetSection;
  insight: Insight;
  /** Opens a screen from the sheet; absent outside one, so nothing is offered. */
  onOpen?: ((target: string) => void) | undefined;
}) {
  const { isDark } = useTheme();
  const { t } = useTranslation();
  // A screen reader is offered the section the efforts were read from, as the
  // card's own history chart offers it.
  const actions = useMemo(
    () =>
      onOpen
        ? [
            {
              name: OPEN_PICTURED,
              label: t('insights.graphic.openSection', { name: entry.sectionName }),
              run: () => onOpen(entry.sectionTarget),
            },
          ]
        : undefined,
    [onOpen, entry.sectionName, entry.sectionTarget, t]
  );
  const color = insightGraphicColour(insight.category, isDark);
  const dotColor = isDark
    ? colorWithOpacity(ink.white, opacity.dim)
    : colorWithOpacity(ink.black, opacity.tint3);
  const fitnessAt = recordIndex(entry.fitness, entry.prDate);
  const effortAt = recordIndex(entry.efforts, entry.prDate);
  const format = (series: HistorySeries) => (value: number, decimals: number) =>
    series.format ? series.format(value) : formatSeriesValue(value, decimals, series.unit);

  return (
    <ChartErrorBoundary height={MAP_HEIGHT * 2}>
      <Card
        variant="flat"
        padding="sm"
        testID="insight-history-chart"
        title={entry.name}
        style={styles.chartStack}
      >
        {entry.fitness.points.length >= 2 ? (
          <View testID="stale-pr-fitness-chart">
            <InsightSeriesChart
              samples={entry.fitness.points}
              title={entry.fitness.label}
              color={color}
              formatValue={format(entry.fitness)}
              area={false}
              marker={fitnessAt >= 0 ? { index: fitnessAt, kind: 'this' } : null}
              band={entry.gap}
              xRange={entry.range}
            />
          </View>
        ) : null}
        {entry.efforts.points.length >= 2 ? (
          <View testID="stale-pr-efforts-chart">
            <InsightSeriesChart
              samples={entry.efforts.points}
              title={entry.efforts.label}
              color={color}
              formatValue={format(entry.efforts)}
              invert
              pointColor={dotColor}
              marker={effortAt >= 0 ? { index: effortAt, kind: 'record' } : null}
              band={entry.gap}
              xRange={entry.range}
              {...(actions ? { actions } : {})}
            />
          </View>
        ) : null}
        {entry.gap ? (
          <Text style={[styles.caption, isDark && styles.captionDark]}>{entry.gapLabel}</Text>
        ) : null}
      </Card>
    </ChartErrorBoundary>
  );
});

/**
 * Detail content for the stale-PR card: one section at a time. A group card
 * offers a chip per section, most visited first, and the chip drives the
 * map, the numbers, the chart and the links below it. Every figure is the
 * selected section's own. The rules sit under the sheet's "How was this
 * calculated?".
 */
export const StalePRContent = React.memo(function StalePRContent({ insight }: StalePRContentProps) {
  const { isDark } = useTheme();
  const { t } = useTranslation();
  const sheet = useInsightSheet();
  const entries = useMemo(
    () => insight.supportingData?.stalePrSections ?? [],
    [insight.supportingData?.stalePrSections]
  );
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const selected = entries.find((entry) => sectionRowKey(entry) === selectedKey) ?? entries[0];

  const open = useCallback(
    (target: string) => {
      sheet?.onLeave();
      navigateTo(fromInsightsPath(target));
    },
    [sheet]
  );

  if (!selected) return null;

  return (
    <View style={styles.container}>
      {entries.length > 1 ? (
        <View style={styles.chips} accessibilityRole="tablist">
          {entries.map((entry) => {
            const key = sectionRowKey(entry);
            return (
              <ToggleButton
                key={key}
                testID={`stale-pr-chip-${entry.sectionId}`}
                label={entry.name}
                count={entry.traversalCount}
                accessibilityLabel={composeAccessibilityLabel(entry.name, entry.visited)}
                selected={entry === selected}
                onPress={() => setSelectedKey(key)}
              />
            );
          })}
        </View>
      ) : null}

      <SelectedSectionMap key={sectionRowKey(selected)} entry={selected} onOpen={open} />

      <SheetContext body={selected.summary} meta={selected.effort} />

      <StalePrChart entry={selected} insight={insight} onOpen={sheet ? open : undefined} />

      <View>
        <Row
          behaviour="navigate"
          testID="stale-pr-open-section"
          accessibilityLabel={composeAccessibilityLabel(
            t('insights.graphic.openTheSection'),
            selected.name
          )}
          onPress={() => open(selected.sectionTarget)}
        >
          <View style={styles.link}>
            <Text style={[styles.linkText, isDark && styles.linkTextDark]}>
              {t('insights.graphic.openTheSection')}
            </Text>
            <NameText style={[styles.linkDetail, isDark && styles.linkDetailDark]}>
              {selected.name}
            </NameText>
          </View>
        </Row>
        {selected.activityTarget ? (
          <Row
            behaviour="navigate"
            testID="stale-pr-open-activity"
            accessibilityLabel={t('insights.stalePr.openActivity')}
            onPress={() => open(selected.activityTarget as string)}
          >
            <View style={styles.link}>
              <Text style={[styles.linkText, isDark && styles.linkTextDark]}>
                {t('insights.stalePr.openActivity')}
              </Text>
            </View>
          </Row>
        ) : null}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    gap: spacing.sm,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  map: {
    borderRadius: layout.borderRadiusMd,
    overflow: 'hidden',
  },
  chartStack: {
    gap: spacing.sm,
  },
  caption: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  captionDark: {
    color: darkColors.textSecondary,
  },
  link: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  linkText: {
    ...typography.bodySmallBold,
    flex: 1,
    color: colors.textPrimary,
  },
  linkDetail: {
    ...typography.bodySmall,
    flexShrink: 1,
    color: colors.textSecondary,
  },
  linkDetailDark: {
    color: darkColors.textSecondary,
  },
  linkTextDark: {
    color: darkColors.textPrimary,
  },
});
