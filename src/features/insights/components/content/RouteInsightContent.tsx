import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/shared/app';
import { navigateTo } from '@/shared/app/navigation';
import { getActivityIcon } from '@/shared/activity/activityUtils';
import { formatDuration } from '@/shared/format/format';
import { brand, colors, darkColors, spacing, typography, verdictColor } from '@/theme';
import type { Insight, SupportingRoute } from '@/types';
import { Row } from '@/shared/ui';
import type { TFunc } from '../../types';
import { sectionWithSport } from '../../lib/cardSport';
import { SparklineChart } from '../SupportingDataSection';

const STRIP_WIDTH = 96;
const STRIP_HEIGHT = 28;

function trendIcon(trend: number): string {
  if (trend > 0) return 'trending-up';
  if (trend < 0) return 'trending-down';
  return 'minus';
}

function trendColor(trend: number, isDark: boolean): string {
  if (trend > 0) return verdictColor('positive', isDark);
  if (trend < 0) return verdictColor('negative', isDark);
  return verdictColor('neutral', isDark);
}

const RouteRow = React.memo(function RouteRow({ route }: { route: SupportingRoute }) {
  const { isDark } = useTheme();
  const { t } = useTranslation();
  const efforts = route.recentEfforts?.map((p) => p.value) ?? [];
  const lineColor = trendColor(route.trend, isDark);
  const label = sectionWithSport(route.routeName, route.sportType, t as unknown as TFunc);

  return (
    <Row
      testID={`route-insight-row-${route.rowKey}`}
      onPress={() => navigateTo(route.navigationTarget)}
      accessibilityLabel={label}
    >
      <View style={styles.rowMain}>
        <View style={styles.nameRow}>
          <MaterialCommunityIcons
            name={getActivityIcon(route.sportType)}
            size={14}
            color={isDark ? darkColors.textSecondary : colors.textSecondary}
            style={styles.sportIcon}
          />
          <Text style={[styles.name, isDark && styles.nameDark]} numberOfLines={1}>
            {label}
          </Text>
          {route.isRecentRecord ? (
            <MaterialCommunityIcons name="trophy" size={14} color={brand.gold} />
          ) : null}
        </View>
        <Text style={[styles.meta, isDark && styles.metaDark]}>
          {[
            route.direction === 'forward' ? t('insights.route.direction.forward') : null,
            route.direction === 'reverse' ? t('insights.route.direction.reverse') : null,
            route.isRecentRecord ? t('insights.recentPersonalRecord') : null,
            route.trend > 0 ? t('insights.route.trendFaster') : null,
            route.trend < 0 ? t('insights.route.trendSlower') : null,
            t('insights.route.attempts', { count: route.attemptCount }),
          ]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      </View>
      {efforts.length >= 3 ? (
        <SparklineChart
          data={efforts}
          color={lineColor}
          width={STRIP_WIDTH}
          height={STRIP_HEIGHT}
        />
      ) : null}
      <View style={styles.rowEnd}>
        <Text style={[styles.bestTime, isDark && styles.bestTimeDark]}>
          {formatDuration(route.bestTime)}
        </Text>
        {route.trend !== 0 ? (
          <MaterialCommunityIcons
            name={trendIcon(route.trend) as never}
            size={16}
            color={lineColor}
          />
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
  const { isDark } = useTheme();
  const { t } = useTranslation();
  const routes = insight.supportingData?.routes;
  if (!routes || routes.length === 0) return null;

  return (
    <View style={styles.container}>
      <View style={styles.context}>
        <Text style={[styles.contextMeta, isDark && styles.metaDark]}>
          {t('insights.route.sheetMeta')}
        </Text>
      </View>
      {routes.map((route) => (
        <RouteRow key={route.rowKey} route={route} />
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  container: { gap: spacing.xs },
  context: { marginBottom: spacing.xs },
  contextMeta: { fontSize: typography.caption.fontSize, color: colors.textSecondary },
  rowMain: { flex: 1, gap: spacing.xxs },
  nameRow: { flexDirection: 'row', alignItems: 'center' },
  sportIcon: { marginRight: spacing.xs },
  name: {
    flexShrink: 1,
    marginRight: spacing.xs,
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  nameDark: { color: darkColors.textPrimary },
  meta: { fontSize: typography.caption.fontSize, color: colors.textSecondary },
  metaDark: { color: darkColors.textSecondary },
  rowEnd: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  bestTime: {
    fontSize: typography.bodyCompact.fontSize,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  bestTimeDark: { color: darkColors.textPrimary },
});
