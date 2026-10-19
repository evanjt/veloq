import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/shared/app';
import { navigateTo } from '@/shared/app/navigation';
import { getActivityIcon } from '@/shared/activity/activityUtils';
import { formatDuration, formatShortDate } from '@/shared/format/format';
import { Sparkline, type SparklinePoint } from '@/shared/charts';
import { brand, colors, darkColors, iconSize, spacing, typography } from '@/theme';
import type { Insight, SupportingRoute } from '@/types';
import { SheetContext } from './SheetContext';
import { composeAccessibilityLabel, Row } from '@/shared/ui';
import { Icon } from '@/shared/ui/Icon';
import type { TFunc } from '../../types';
import { sectionWithSport } from '../../lib/cardSport';
import { rowTrendColor, rowTrendIcon } from '../../lib/rowTrend';
import { NameText } from '@/shared/ui/NameText';

const STRIP_WIDTH = 96;
const STRIP_HEIGHT = 28;

const formatEffort = (seconds: number) => formatDuration(Math.round(seconds));

const RouteRow = React.memo(function RouteRow({ route }: { route: SupportingRoute }) {
  const { isDark } = useTheme();
  const { t } = useTranslation();
  const points = useMemo<SparklinePoint[]>(
    () =>
      (route.recentEfforts ?? []).map((p) => ({
        label: formatShortDate(new Date(p.date * 1000)),
        key: String(p.date),
        value: p.value,
        date: p.date,
      })),
    [route.recentEfforts]
  );
  const efforts = points.map((p) => p.value);
  const trendColor = rowTrendColor(route.trend, isDark);
  const label = sectionWithSport(route.routeName, route.sportType, t as unknown as TFunc);
  // The line draws the efforts in the series colour and spans their own range,
  // so the row prints and speaks that range; the verdict stays on the glyph.
  const range =
    efforts.length >= 3
      ? `${formatDuration(Math.min(...efforts))}-${formatDuration(Math.max(...efforts))}`
      : null;

  return (
    <Row
      testID={`route-insight-row-${route.rowKey}`}
      behaviour="navigate"
      onPress={() => navigateTo(route.navigationTarget)}
      accessibilityLabel={composeAccessibilityLabel(label, range)}
    >
      <View style={styles.rowMain}>
        <View style={styles.nameRow}>
          <Icon
            name={getActivityIcon(route.sportType)}
            size={iconSize.sm}
            color={isDark ? darkColors.textSecondary : colors.textSecondary}
            style={styles.sportIcon}
          />
          <NameText style={[styles.name, isDark && styles.nameDark]}>{label}</NameText>
          {route.isRecentRecord ? (
            <Icon name="trophy" size={iconSize.sm} color={brand.gold} />
          ) : null}
        </View>
        <Text style={[styles.meta, isDark && styles.metaDark]}>
          {[
            route.direction === 'forward' ? t('insights.route.direction.forward') : null,
            route.direction === 'reverse' ? t('insights.route.direction.reverse') : null,
            route.isRecentRecord ? t('insights.recentPersonalRecord') : null,
            route.trend > 0 ? t('insights.route.trendFaster') : null,
            route.trend < 0 ? t('insights.route.trendSlower') : null,
            t('routes.activitiesCount', { count: route.attemptCount }),
          ]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      </View>
      {range ? (
        // A time is better lower, so the fastest effort sits at the top, as the
        // section timelines draw times.
        <Sparkline
          testID={`route-insight-sparkline-${route.rowKey}`}
          name={t('insights.data.recentEfforts')}
          points={points}
          format={formatEffort}
          width={STRIP_WIDTH}
          height={STRIP_HEIGHT}
          color={isDark ? darkColors.chartSeries : colors.chartSeries}
          summary={range}
          showRange
          invert
        />
      ) : null}
      <View style={styles.rowEnd}>
        <Text style={[styles.bestTime, isDark && styles.bestTimeDark]}>
          {formatDuration(route.bestTime)}
        </Text>
        {route.trend !== 0 ? (
          <Icon name={rowTrendIcon(route.trend)} size={iconSize.sm} color={trendColor} />
        ) : null}
      </View>
    </Row>
  );
});

interface RouteInsightContentProps {
  insight: Insight;
}

/** Every route the card carries, one row per route, sport and direction. */
export const RouteInsightContent = React.memo(function RouteInsightContent({
  insight,
}: RouteInsightContentProps) {
  const { t } = useTranslation();
  const routes = insight.supportingData?.routes;
  if (!routes || routes.length === 0) return null;

  return (
    <View style={styles.container}>
      <SheetContext meta={t('insights.route.sheetMeta')} />
      {routes.map((route) => (
        <RouteRow key={route.rowKey} route={route} />
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  container: { gap: spacing.xs },
  rowMain: { flex: 1, gap: spacing.xxs },
  nameRow: { flexDirection: 'row', alignItems: 'center' },
  sportIcon: { marginRight: spacing.xs },
  name: {
    ...typography.bodySmallBold,
    flexShrink: 1,
    marginRight: spacing.xs,
    color: colors.textPrimary,
  },
  nameDark: { color: darkColors.textPrimary },
  meta: { ...typography.caption, color: colors.textSecondary },
  metaDark: { color: darkColors.textSecondary },
  rowEnd: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  bestTime: {
    ...typography.bodyCompactBold,
    color: colors.textPrimary,
  },
  bestTimeDark: { color: darkColors.textPrimary },
});
