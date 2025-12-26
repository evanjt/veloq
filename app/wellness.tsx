import React, { useState, useCallback } from 'react';
import { View, ScrollView, StyleSheet, useColorScheme, RefreshControl, TouchableOpacity } from 'react-native';
import { Text, IconButton, ActivityIndicator } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { WellnessDashboard, WellnessTrendsChart } from '@/components/wellness';
import { useWellness, type TimeRange } from '@/hooks';
import { colors, darkColors, spacing, layout, typography, opacity } from '@/theme';

const TIME_RANGES: { id: TimeRange; label: string }[] = [
  { id: '7d', label: '1W' },
  { id: '1m', label: '1M' },
  { id: '3m', label: '3M' },
  { id: '6m', label: '6M' },
  { id: '1y', label: '1Y' },
];

export default function WellnessScreen() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [timeRange, setTimeRange] = useState<TimeRange>('1m');

  // isFetching is true during background refetches, isLoading only on initial load with no cache
  const { data: wellness, isLoading, isFetching, refetch } = useWellness(timeRange);

  const onRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await refetch();
    setIsRefreshing(false);
  }, [refetch]);

  // Only show full-page loading on very first load with no data at all
  const showFullPageLoading = isLoading && !wellness;
  // Show subtle indicator when fetching in background (time range change, etc)
  const showBackgroundLoading = isFetching && !isRefreshing && wellness;

  if (showFullPageLoading) {
    return (
      <SafeAreaView style={[styles.container, isDark && styles.containerDark]}>
        <View style={styles.header}>
          <IconButton
            icon="arrow-left"
            iconColor={isDark ? '#FFFFFF' : colors.textPrimary}
            onPress={() => router.back()}
          />
          <Text style={[styles.headerTitle, isDark && styles.textLight]}>Wellness</Text>
          <View style={{ width: 48 }} />
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, isDark && styles.containerDark]}>
      <View style={styles.header}>
        <IconButton
          icon="arrow-left"
          iconColor={isDark ? '#FFFFFF' : colors.textPrimary}
          onPress={() => router.back()}
        />
        <Text style={[styles.headerTitle, isDark && styles.textLight]}>Wellness</Text>
        {/* Subtle loading indicator in header when fetching in background */}
        <View style={{ width: 48, alignItems: 'center' }}>
          {showBackgroundLoading && (
            <ActivityIndicator size="small" color={colors.primary} />
          )}
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
        {/* Today's trends summary */}
        <View style={[styles.card, isDark && styles.cardDark]}>
          <WellnessDashboard data={wellness} />
        </View>

        {/* Time range selector */}
        <View style={styles.timeRangeContainer}>
          {TIME_RANGES.map((range) => (
            <TouchableOpacity
              key={range.id}
              style={[
                styles.timeRangeButton,
                isDark && styles.timeRangeButtonDark,
                timeRange === range.id && styles.timeRangeButtonActive,
              ]}
              onPress={() => setTimeRange(range.id)}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.timeRangeText,
                  isDark && styles.timeRangeTextDark,
                  timeRange === range.id && styles.timeRangeTextActive,
                ]}
              >
                {range.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Wellness Trends Chart */}
        <View style={[styles.card, isDark && styles.cardDark]}>
          <Text style={[styles.sectionTitle, isDark && styles.textLight]}>Wellness Trends</Text>
          <WellnessTrendsChart data={wellness} height={200} />
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
    backgroundColor: darkColors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: {
    fontSize: typography.cardTitle.fontSize,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  textLight: {
    color: colors.textOnDark,
  },
  textDark: {
    color: darkColors.textSecondary,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
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
  sectionTitle: {
    fontSize: typography.body.fontSize,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: spacing.md,
  },
  timeRangeContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  timeRangeButton: {
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: opacity.overlay.light,
  },
  timeRangeButtonDark: {
    backgroundColor: opacity.overlayDark.medium,
  },
  timeRangeButtonActive: {
    backgroundColor: colors.primary,
  },
  timeRangeText: {
    fontSize: typography.caption.fontSize,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  timeRangeTextDark: {
    color: darkColors.textSecondary,
  },
  timeRangeTextActive: {
    color: colors.textOnDark,
  },
});
