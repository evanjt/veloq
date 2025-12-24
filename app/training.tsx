import React, { useMemo } from 'react';
import { View, ScrollView, StyleSheet, useColorScheme, TouchableOpacity } from 'react-native';
import { Text, IconButton, ActivityIndicator } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, Href } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { WeeklySummary, ActivityHeatmap, SeasonComparison, EventPlanner, WorkoutLibrary } from '@/components/stats';
import { useActivities, useRouteGroups, useRouteProcessing } from '@/hooks';
import { useRouteSettings } from '@/providers';
import { colors, spacing, layout } from '@/theme';

export default function TrainingScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  // Check if route matching is enabled
  const { settings: routeSettings } = useRouteSettings();
  const isRouteMatchingEnabled = routeSettings.enabled;

  // Fetch activities for the past 2 years (for all comparisons including year-over-year)
  const currentYear = new Date().getFullYear();
  const { data: activities, isLoading } = useActivities({
    oldest: `${currentYear - 1}-01-01`,
    newest: `${currentYear}-12-31`,
    includeStats: true,
  });

  // Get route groups count and processing status
  const { groups: routeGroups, processedCount } = useRouteGroups({ minActivities: 2 });
  const { progress: routeProgress, isProcessing: isRouteProcessing } = useRouteProcessing();

  // Split activities by year for season comparison
  const { currentYearActivities, previousYearActivities } = useMemo(() => {
    if (!activities) return { currentYearActivities: [], previousYearActivities: [] };

    const current: typeof activities = [];
    const previous: typeof activities = [];

    for (const activity of activities) {
      const year = new Date(activity.start_date_local).getFullYear();
      if (year === currentYear) {
        current.push(activity);
      } else if (year === currentYear - 1) {
        previous.push(activity);
      }
    }

    return { currentYearActivities: current, previousYearActivities: previous };
  }, [activities, currentYear]);

  return (
    <SafeAreaView style={[styles.container, isDark && styles.containerDark]}>
      <View style={styles.header}>
        <IconButton
          icon="arrow-left"
          iconColor={isDark ? '#FFFFFF' : colors.textPrimary}
          onPress={() => router.back()}
        />
        <Text style={[styles.headerTitle, isDark && styles.textLight]}>Training</Text>
        <View style={{ width: 48 }} />
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
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
              <MaterialCommunityIcons
                name="map-marker-path"
                size={22}
                color={colors.primary}
              />
            </View>
            <View style={styles.routesSectionInfo}>
              <Text style={[styles.routesSectionTitle, isDark && styles.textLight]}>
                Routes
              </Text>
              <Text style={[styles.routesSectionSubtitle, isDark && styles.textMuted]}>
                {!isRouteMatchingEnabled
                  ? 'Disabled - Enable in Settings'
                  : isRouteProcessing
                    ? routeProgress.status === 'filtering'
                      ? routeProgress.candidatesFound !== undefined
                        ? `Found ${routeProgress.candidatesFound} potential matches`
                        : `Checking ${routeProgress.total} activities...`
                      : routeProgress.status === 'matching'
                        ? 'Grouping routes...'
                        : `Fetching GPS: ${routeProgress.current}/${routeProgress.total}`
                    : routeGroups.length > 0
                      ? `${routeGroups.length} routes from ${processedCount} activities`
                      : 'Discover your common routes'}
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
                color={isDark ? '#666' : colors.textSecondary}
              />
            )}
          </View>
          {/* Progress bar when processing */}
          {isRouteProcessing && routeProgress.total > 0 && (
            <View style={styles.routesProgressBar}>
              <View
                style={[
                  styles.routesProgressFill,
                  { width: `${(routeProgress.current / routeProgress.total) * 100}%` },
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
            <ActivityHeatmap activities={activities} weeks={26} />
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  containerDark: {
    backgroundColor: '#121212',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  textLight: {
    color: '#FFFFFF',
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
    backgroundColor: '#1E1E1E',
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
    borderRadius: 12,
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
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  routesSectionSubtitle: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 2,
  },
  textMuted: {
    color: '#888',
  },
  routesProgressContainer: {
    width: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  routesProgressBar: {
    height: 3,
    backgroundColor: 'rgba(0, 0, 0, 0.08)',
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
