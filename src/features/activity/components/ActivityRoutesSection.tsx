import React from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { RoutePerformanceSection } from '@/features/routes/components/performance/RoutePerformanceSection';
import { ComponentErrorBoundary, EmptyState } from '@/shared/ui';
import { DataRangeFooter } from '@/features/routes';
import { TAB_BAR_SAFE_PADDING } from '@/shared/ui';
import type { ActivityType } from '@/types';
import { spacing } from '@/theme';

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
      testID="activity-routes-list"
    >
      {hasMatchedRoute ? (
        <ComponentErrorBoundary componentName="Route Performance">
          <RoutePerformanceSection activityId={activityId} activityType={activityType} />
        </ComponentErrorBoundary>
      ) : (
        <EmptyState
          icon="map-marker-question"
          title={t('activityDetail.noRouteMatch')}
          description={t('activityDetail.noRouteMatchDescription')}
          compact
        />
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
    paddingTop: spacing.md,
    paddingBottom: spacing.xl + TAB_BAR_SAFE_PADDING,
  },
});
