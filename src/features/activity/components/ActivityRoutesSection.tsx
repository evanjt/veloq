import React from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { RoutePerformanceSection, DataRangeFooter } from '@/features/routes';
import { ComponentErrorBoundary, EmptyState, useBottomClearance } from '@/shared/ui';
import type { ActivityType } from '@/types';
import { spacing } from '@/theme';
import { usePagerPageScrollProps } from '@/shared/ui/pagerPageScroll';

interface ActivityRoutesSectionProps {
  activityId: string;
  activityType: ActivityType;
  hasMatchedRoute: boolean;
  /** Seconds this activity's route record beat the previous best by, when it is one. */
  routeImprovementSeconds: number | null;
  /** Seconds this activity was off the route best, from the engine's route highlight. */
  routeGapSeconds: number | null;
  cacheDays: number;
  isDark: boolean;
}

export const ActivityRoutesSection = React.memo(function ActivityRoutesSection({
  activityId,
  activityType,
  hasMatchedRoute,
  routeImprovementSeconds,
  routeGapSeconds,
  cacheDays,
  isDark,
}: ActivityRoutesSectionProps) {
  const { t } = useTranslation();
  const pageScroll = usePagerPageScrollProps();
  const bottomClearance = useBottomClearance();

  return (
    <ScrollView
      style={styles.tabScrollView}
      contentContainerStyle={[
        styles.tabScrollContent,
        { paddingBottom: spacing.xl + bottomClearance },
      ]}
      showsVerticalScrollIndicator={false}
      testID="activity-routes-list"
      {...pageScroll}
    >
      {hasMatchedRoute ? (
        <ComponentErrorBoundary part="routePerformance" debugName="Route Performance">
          <RoutePerformanceSection
            activityId={activityId}
            activityType={activityType}
            improvementSeconds={routeImprovementSeconds}
            gapToBestSeconds={routeGapSeconds}
          />
        </ComponentErrorBoundary>
      ) : (
        <EmptyState
          icon="map-marker-question"
          title={t('activityDetail.noRouteMatch')}
          description={t('activityDetail.noRouteMatchDescription')}
          variant="compact"
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
  },
});
