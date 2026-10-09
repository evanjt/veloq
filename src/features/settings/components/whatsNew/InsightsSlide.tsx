/**
 * Two example insights, a section record and an eFTP step, drawn by the list card the Insights tab
 * uses. The generators that build the real cards build these from fixed inputs, so the titles and
 * numbers read as they would on the tab, in the athlete's language.
 */

import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/shared/app';
import { demoRoutes } from '@/shared/demo/routes/routes';
import {
  InsightListCard,
  generateFitnessMilestoneInsights,
  generateSectionPRInsights,
  type Insight,
  type SectionPR,
  type SeriesPoint,
  type TFunc,
} from '@/features/insights';
import { colors, darkColors, spacing, typography } from '@/theme';

const EXAMPLE_ROUTE_ID = 'route-valais-ride-2';
const DAY_SECONDS = 86_400;

/** A dated series ending today, one point per `stepDays`, oldest first. */
function series(values: number[], nowSeconds: number, stepDays: number): SeriesPoint[] {
  return values.map((value, i) => ({
    value,
    date: nowSeconds - (values.length - 1 - i) * stepDays * DAY_SECONDS,
  }));
}

function exampleRecord(nowSeconds: number): SectionPR | null {
  const route = demoRoutes.find((r) => r.id === EXAMPLE_ROUTE_ID);
  if (!route) return null;
  return {
    sectionId: EXAMPLE_ROUTE_ID,
    sectionName: route.name,
    bestTime: 1104,
    daysAgo: 1,
    sportType: 'Ride',
    traversalCount: 12,
    recentEfforts: series([1188, 1162, 1171, 1139, 1104], nowSeconds, 9),
  };
}

/** Dated from now, so the record reads as yesterday's and the eFTP step as this month's. */
function exampleInsights(t: TFunc): Insight[] {
  const now = Date.now();
  const nowSeconds = Math.floor(now / 1000);
  const record = exampleRecord(nowSeconds);
  const [sectionPr] = record ? generateSectionPRInsights([record], now, t) : [];
  const [ftp] = generateFitnessMilestoneInsights(
    {
      latestFtp: 262,
      latestDate: nowSeconds,
      previousFtp: 251,
      previousDate: nowSeconds - 30 * DAY_SECONDS,
      deltaWatts: 11,
      sampleCount: 30,
      history: series([248, 251, 250, 255, 258, 262], nowSeconds, 6),
    },
    null,
    null,
    now,
    t
  );
  return [sectionPr, ftp].filter((insight): insight is Insight => insight !== undefined);
}

const noop = () => {};

export function InsightsSlide() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const insights = useMemo(() => exampleInsights(t as TFunc), [t]);

  return (
    <View style={styles.container}>
      {/* Examples, so nothing here opens a sheet. */}
      <View pointerEvents="none" style={styles.cards}>
        {insights.map((insight) => (
          <InsightListCard key={insight.id} insight={insight} onPress={noop} />
        ))}
      </View>
      <Text
        style={[styles.how, { color: isDark ? darkColors.textSecondary : colors.textSecondary }]}
      >
        {t('whatsNew.v030.insightsHow')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    gap: spacing.md,
    paddingHorizontal: spacing.sm,
  },
  cards: {
    gap: spacing.sm,
  },
  how: {
    fontSize: typography.bodySmall.fontSize,
    textAlign: 'center',
  },
});
