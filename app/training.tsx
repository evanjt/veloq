import React, { useMemo } from 'react';
import { View, ScrollView, StyleSheet, useColorScheme } from 'react-native';
import { Text, IconButton, ActivityIndicator } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { WeeklySummary, ActivityHeatmap, SeasonComparison, EventPlanner, WorkoutLibrary } from '@/components/stats';
import { useActivities } from '@/hooks';
import { colors, spacing, layout } from '@/theme';

export default function TrainingScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  // Fetch activities for the past 2 years (for all comparisons including year-over-year)
  const currentYear = new Date().getFullYear();
  const { data: activities, isLoading } = useActivities({
    oldest: `${currentYear - 1}-01-01`,
    newest: `${currentYear}-12-31`,
    includeStats: true,
  });

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

        {/* Upcoming Events */}
        <View style={[styles.card, isDark && styles.cardDark]}>
          <EventPlanner />
        </View>

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
});
