import React, { useMemo, useState, useCallback, useEffect } from 'react';
import { View, ScrollView, StyleSheet, TouchableOpacity, RefreshControl } from 'react-native';
import { Text, IconButton, ActivityIndicator } from 'react-native-paper';
import { ScreenSafeAreaView } from '@/components/ui';
import { router, Href } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import {
  WeeklySummary,
  ActivityHeatmap,
  SeasonComparison,
  EventPlanner,
  WorkoutLibrary,
} from '@/components/stats';
import { useActivities, useRouteGroups, useRouteProcessing, useTheme } from '@/hooks';
import { useRouteSettings } from '@/providers';
import { colors, darkColors, spacing, layout, typography, opacity } from '@/theme';
import { createSharedStyles } from '@/styles';
import { logMount, logUnmount, logRender } from '@/lib/debug/renderTimer';

export default function TrainingScreen() {
  // DEBUG: Track render timing
  logRender('TrainingScreen');
  useEffect(() => {
    logMount('TrainingScreen');
    return () => logUnmount('TrainingScreen');
  }, []);

  const { t } = useTranslation();
  const { isDark, colors: themeColors } = useTheme();
  const shared = createSharedStyles(isDark);

  // Check if route matching is enabled
  const { settings: routeSettings } = useRouteSettings();
  const isRouteMatchingEnabled = routeSettings.enabled;

  // Refresh state for pull-to-refresh
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Fetch activities for rolling year comparison (last 24 months)
  const today = new Date();
  const twoYearsAgo = new Date(today);
  twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
  const {
    data: activities,
    isLoading,
    isFetching,
    refetch,
  } = useActivities({
    oldest: twoYearsAgo.toISOString().split('T')[0],
    newest: today.toISOString().split('T')[0],
    includeStats: true,
  });

  // Handle pull-to-refresh
  const onRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await refetch();
    setIsRefreshing(false);
  }, [refetch]);

  // Get route groups count and processing status
  const { groups: routeGroups, processedCount } = useRouteGroups({
    minActivities: 2,
  });
  const { progress: routeProgress, isProcessing: isRouteProcessing } = useRouteProcessing();

  // Split activities by rolling year for season comparison
  // Current period: last 12 months ending today
  // Previous period: the 12 months before that
  const { currentYearActivities, previousYearActivities } = useMemo(() => {
    if (!activities) return { currentYearActivities: [], previousYearActivities: [] };

    const now = new Date();
    const oneYearAgo = new Date(now);
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const twoYearsAgo = new Date(now);
    twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);

    const current: typeof activities = [];
    const previous: typeof activities = [];

    for (const activity of activities) {
      const activityDate = new Date(activity.start_date_local);
      if (activityDate >= oneYearAgo && activityDate <= now) {
        current.push(activity);
      } else if (activityDate >= twoYearsAgo && activityDate < oneYearAgo) {
        previous.push(activity);
      }
    }

    return { currentYearActivities: current, previousYearActivities: previous };
  }, [activities]);

  return (
    <ScreenSafeAreaView style={shared.container} testID="training-screen">
      <View style={styles.header}>
        <IconButton icon="arrow-left" iconColor={themeColors.text} onPress={() => router.back()} />
        <Text style={shared.headerTitle}>{t('trainingScreen.title')}</Text>
        {/* Subtle loading indicator in header when fetching in background */}
        <View style={{ width: 48, alignItems: 'center' }}>
          {isFetching && !isRefreshing && <ActivityIndicator size="small" color={colors.primary} />}
        </View>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >
        {/* Summary with time range selector */}
        <View style={[styles.card, isDark && styles.cardDark]}>
          {isLoading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="small" color={colors.primary} />
            </View>
          ) : (
            <WeeklySummary activities={activities} />
          )}
        </View>

        {/* Routes Section */}
        <TouchableOpacity
          style={[styles.card, isDark && styles.cardDark]}
          onPress={() => router.push('/routes' as Href)}
          activeOpacity={0.7}
        >
          <View style={styles.routesSectionRow}>
            <View style={[styles.routesIcon, isDark && styles.routesIconDark]}>
              <MaterialCommunityIcons name="map-marker-path" size={22} color={colors.primary} />
            </View>
            <View style={styles.routesSectionInfo}>
              <Text style={[styles.routesSectionTitle, isDark && styles.routesSectionTitleDark]}>
                {t('trainingScreen.routes')}
              </Text>
              <Text
                style={[styles.routesSectionSubtitle, isDark && styles.routesSectionSubtitleDark]}
              >
                {!isRouteMatchingEnabled
                  ? t('trainingScreen.disabledInSettings')
                  : isRouteProcessing
                    ? t('trainingScreen.fetchingGps', {
                        current: routeProgress.current,
                        total: routeProgress.total,
                      })
                    : routeGroups.length > 0
                      ? t('trainingScreen.routesFromActivities', {
                          routes: routeGroups.length,
                          activities: processedCount,
                        })
                      : t('trainingScreen.discoverRoutes')}
              </Text>
            </View>
            {isRouteProcessing ? (
              <View style={styles.routesProgressContainer}>
                <ActivityIndicator size="small" color={colors.primary} />
              </View>
            ) : (
              <MaterialCommunityIcons
                name="chevron-right"
                size={22}
                color={themeColors.textSecondary}
              />
            )}
          </View>
          {/* Progress bar when processing */}
          {isRouteProcessing && routeProgress.total > 0 && (
            <View style={styles.routesProgressBar}>
              <View
                style={[
                  styles.routesProgressFill,
                  {
                    width: `${(routeProgress.current / routeProgress.total) * 100}%`,
                  },
                ]}
              />
            </View>
          )}
        </TouchableOpacity>

        {/* Activity Heatmap - using real activities data */}
        <View style={[styles.card, isDark && styles.cardDark]}>
          {isLoading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="small" color={colors.primary} />
            </View>
          ) : (
            <ActivityHeatmap activities={activities} />
          )}
        </View>

        {/* Season Comparison */}
        <View style={[styles.card, isDark && styles.cardDark]}>
          {isLoading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="small" color={colors.primary} />
            </View>
          ) : (
            <SeasonComparison
              height={180}
              currentYearActivities={currentYearActivities}
              previousYearActivities={previousYearActivities}
            />
          )}
        </View>

        {/* Upcoming Events */}
        <View style={[styles.card, isDark && styles.cardDark]}>
          <EventPlanner />
        </View>

        {/* Workout Library */}
        <View style={[styles.card, isDark && styles.cardDark]}>
          <WorkoutLibrary />
        </View>
      </ScrollView>
    </ScreenSafeAreaView>
  );
}

const styles = StyleSheet.create({
  // Note: container, headerTitle now use shared styles
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: layout.screenPadding,
    paddingTop: spacing.sm,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: layout.borderRadius,
    padding: layout.cardPadding,
    marginBottom: spacing.md,
  },
  cardDark: {
    backgroundColor: darkColors.surface,
  },
  loadingContainer: {
    padding: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  routesSectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  routesIcon: {
    width: 44,
    height: 44,
    borderRadius: layout.borderRadiusSm + 4,
    backgroundColor: colors.primary + '15',
    justifyContent: 'center',
    alignItems: 'center',
  },
  routesIconDark: {
    backgroundColor: colors.primary + '25',
  },
  routesSectionInfo: {
    flex: 1,
  },
  routesSectionTitle: {
    ...typography.body,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  routesSectionTitleDark: {
    color: darkColors.textPrimary,
  },
  routesSectionSubtitle: {
    ...typography.bodyCompact,
    color: colors.textSecondary,
    marginTop: 2,
  },
  routesSectionSubtitleDark: {
    color: darkColors.textSecondary,
  },
  routesProgressContainer: {
    width: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  routesProgressBar: {
    height: 3,
    backgroundColor: opacity.overlay.light,
    borderRadius: 1.5,
    marginTop: spacing.md,
    overflow: 'hidden',
  },
  routesProgressFill: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: 1.5,
  },
});
