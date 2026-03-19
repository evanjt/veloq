import React from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { RoutePerformanceSection } from '@/components/routes/performance/RoutePerformanceSection';
import { ComponentErrorBoundary } from '@/components/ui';
import { DataRangeFooter } from '@/components/routes';
import { TAB_BAR_SAFE_PADDING } from '@/components/ui';
import type { ActivityType } from '@/types';
import { colors, spacing } from '@/theme';

interface ActivityRoutesSectionProps {
  activityId: string;
  activityType: ActivityType;
  hasMatchedRoute: boolean;
  cacheDays: number;
  isDark: boolean;
}

export const ActivityRoutesSection = React.memo(function ActivityRoutesSection({
  activityId,
  activityType,
  hasMatchedRoute,
  cacheDays,
  isDark,
}: ActivityRoutesSectionProps) {
  const { t } = useTranslation();

  return (
    <ScrollView
      style={styles.tabScrollView}
      contentContainerStyle={styles.tabScrollContent}
      showsVerticalScrollIndicator={false}
    >
      {hasMatchedRoute ? (
        <ComponentErrorBoundary componentName="Route Performance">
          <RoutePerformanceSection activityId={activityId} activityType={activityType} />
        </ComponentErrorBoundary>
      ) : (
        <View style={styles.noMatchContainer}>
          <MaterialCommunityIcons
            name="map-marker-question"
            size={48}
            color={isDark ? '#555' : '#CCC'}
          />
          <Text style={[styles.noMatchTitle, isDark && styles.textLight]}>
            {t('activityDetail.noRouteMatch')}
          </Text>
          <Text style={[styles.noMatchDescription, isDark && styles.textMuted]}>
            {t('activityDetail.noRouteMatchDescription')}
          </Text>
        </View>
      )}

      <DataRangeFooter days={cacheDays} isDark={isDark} />
    </ScrollView>
  );
});

const styles = StyleSheet.create({
  tabScrollView: {
    flex: 1,
  },
  tabScrollContent: {
    paddingBottom: spacing.xl + TAB_BAR_SAFE_PADDING,
  },
  noMatchContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xl * 2,
    paddingHorizontal: spacing.lg,
  },
  noMatchTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
    marginTop: spacing.md,
    textAlign: 'center',
  },
  noMatchDescription: {
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: spacing.sm,
    textAlign: 'center',
    lineHeight: 20,
  },
  textLight: {
    color: colors.textOnDark,
  },
  textMuted: {
    color: '#999',
  },
});
