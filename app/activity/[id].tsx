import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { View, ScrollView, StyleSheet, useColorScheme, TouchableOpacity } from 'react-native';
import { Text, IconButton, ActivityIndicator } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useActivity, useActivityStreams } from '@/hooks';
import { ActivityMapView, ActivityDataChart, ChartTypeSelector, CombinedDataChart } from '@/components';
import {
  formatDistance,
  formatDuration,
  formatElevation,
  formatHeartRate,
  formatPower,
  formatSpeed,
  formatPace,
  formatDateTime,
  getActivityIcon,
  getActivityColor,
  isRunningActivity,
  decodePolyline,
  convertLatLngTuples,
  getAvailableCharts,
  CHART_CONFIGS,
} from '@/lib';
import { colors, spacing, layout, typography } from '@/theme';
import type { ChartTypeId } from '@/lib/chartConfig';

export default function ActivityDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  const { data: activity, isLoading, error } = useActivity(id || '');
  const { data: streams } = useActivityStreams(id || '');

  // Track the selected point index from charts for map highlight
  const [highlightIndex, setHighlightIndex] = useState<number | null>(null);
  // Track whether any chart is being interacted with to disable ScrollView
  const [chartInteracting, setChartInteracting] = useState(false);
  // Track which chart types are selected (multi-select) - initialized dynamically
  const [selectedCharts, setSelectedCharts] = useState<ChartTypeId[]>([]);
  // Track if charts are expanded (stacked) or combined (overlay)
  const [chartsExpanded, setChartsExpanded] = useState(false);
  // Track if we've initialized the default chart selection
  const [chartsInitialized, setChartsInitialized] = useState(false);

  // Get available chart types based on stream data
  const availableCharts = useMemo(() => {
    return getAvailableCharts(streams);
  }, [streams]);

  // Initialize selected charts to first available when data loads
  useEffect(() => {
    if (!chartsInitialized && availableCharts.length > 0) {
      setSelectedCharts([availableCharts[0].id]);
      setChartsInitialized(true);
    }
  }, [availableCharts, chartsInitialized]);

  // Toggle a chart type on/off
  const handleChartToggle = useCallback((chartId: string) => {
    setSelectedCharts((prev) => {
      if (prev.includes(chartId as ChartTypeId)) {
        // Don't allow deselecting the last chart
        if (prev.length === 1) return prev;
        return prev.filter((id) => id !== chartId);
      }
      return [...prev, chartId as ChartTypeId];
    });
  }, []);

  // Handle chart point selection (shared by all charts)
  const handlePointSelect = useCallback((index: number | null) => {
    setHighlightIndex(index);
  }, []);

  // Handle chart interaction state changes
  const handleInteractionChange = useCallback((isInteracting: boolean) => {
    setChartInteracting(isInteracting);
  }, []);

  // Get coordinates from streams or polyline (must be before early returns)
  const coordinates = useMemo(() => {
    if (streams?.latlng) {
      return convertLatLngTuples(streams.latlng);
    }
    if (activity?.polyline) {
      return decodePolyline(activity.polyline);
    }
    return [];
  }, [streams?.latlng, activity?.polyline]);

  if (isLoading) {
    return (
      <SafeAreaView style={[styles.container, isDark && styles.containerDark]}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (error || !activity) {
    return (
      <SafeAreaView style={[styles.container, isDark && styles.containerDark]}>
        <View style={styles.header}>
          <IconButton icon="arrow-left" onPress={() => router.back()} />
        </View>
        <View style={styles.loadingContainer}>
          <Text style={styles.errorText}>Failed to load activity</Text>
        </View>
      </SafeAreaView>
    );
  }

  const activityColor = getActivityColor(activity.type);
  const iconName = getActivityIcon(activity.type);
  const showPace = isRunningActivity(activity.type);

  return (
    <SafeAreaView style={[styles.container, isDark && styles.containerDark]}>
      {/* Header */}
      <View style={styles.header}>
        <IconButton
          icon="arrow-left"
          iconColor={isDark ? '#FFFFFF' : colors.textPrimary}
          onPress={() => router.back()}
        />
        <View style={styles.headerTitle}>
          <Text
            style={[styles.activityName, isDark && styles.textLight]}
            numberOfLines={1}
          >
            {activity.name}
          </Text>
          <Text style={styles.date}>{formatDateTime(activity.start_date_local)}</Text>
        </View>
        <View style={[styles.iconContainer, { backgroundColor: activityColor }]}>
          <MaterialCommunityIcons
            name={iconName as any}
            size={20}
            color="#FFFFFF"
          />
        </View>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        scrollEnabled={!chartInteracting}
      >
        {/* Interactive Map - tap to go fullscreen */}
        <ActivityMapView
          coordinates={coordinates}
          polyline={activity.polyline}
          activityType={activity.type}
          height={280}
          showStyleToggle={true}
          highlightIndex={highlightIndex}
          enableFullscreen={true}
        />

        {/* Primary stats */}
        <View style={[styles.statsCard, isDark && styles.cardDark]}>
          <View style={styles.statRow}>
            <StatItem
              label="Distance"
              value={formatDistance(activity.distance)}
              isDark={isDark}
            />
            <StatItem
              label="Time"
              value={formatDuration(activity.moving_time)}
              isDark={isDark}
            />
            <StatItem
              label="Elevation"
              value={formatElevation(activity.total_elevation_gain)}
              isDark={isDark}
            />
          </View>
        </View>

        {/* Chart Type Selector with expand toggle */}
        {availableCharts.length > 0 && (
          <View style={styles.chartControls}>
            <TouchableOpacity
              style={[styles.expandButton, isDark && styles.expandButtonDark]}
              onPress={() => setChartsExpanded(!chartsExpanded)}
              activeOpacity={0.7}
            >
              <MaterialCommunityIcons
                name={chartsExpanded ? 'view-stream' : 'chart-multiple'}
                size={20}
                color={isDark ? '#FFF' : '#333'}
              />
            </TouchableOpacity>
            <ChartTypeSelector
              available={availableCharts}
              selected={selectedCharts}
              onToggle={handleChartToggle}
            />
          </View>
        )}

        {/* Combined or Expanded Charts */}
        {streams && selectedCharts.length > 0 && (
          chartsExpanded ? (
            // Expanded view - stacked charts
            selectedCharts.map((chartId) => {
              const config = CHART_CONFIGS[chartId];
              if (!config) return null;

              const chartData = config.getStream(streams);
              if (!chartData || chartData.length === 0) return null;

              return (
                <View key={chartId} style={[styles.statsCard, isDark && styles.cardDark]}>
                  <Text style={[styles.sectionTitle, isDark && styles.textLight]}>
                    {config.label}
                  </Text>
                  <ActivityDataChart
                    data={chartData}
                    distance={streams.distance || []}
                    height={150}
                    label={config.label}
                    unit={config.unit}
                    color={config.color}
                    formatValue={config.formatValue}
                    convertToImperial={config.convertToImperial}
                    onPointSelect={handlePointSelect}
                    onInteractionChange={handleInteractionChange}
                  />
                </View>
              );
            })
          ) : (
            // Combined view - overlay chart
            <View style={[styles.statsCard, isDark && styles.cardDark]}>
              <CombinedDataChart
                streams={streams}
                selectedCharts={selectedCharts}
                chartConfigs={CHART_CONFIGS}
                height={240}
                onPointSelect={handlePointSelect}
                onInteractionChange={handleInteractionChange}
              />
            </View>
          )
        )}

        {/* Performance stats */}
        <View style={[styles.statsCard, isDark && styles.cardDark]}>
          <Text style={[styles.sectionTitle, isDark && styles.textLight]}>
            Performance
          </Text>
          <View style={styles.statRow}>
            {showPace ? (
              <>
                <StatItem
                  label="Avg Pace"
                  value={formatPace(activity.average_speed)}
                  isDark={isDark}
                />
                <StatItem
                  label="Max Pace"
                  value={formatPace(activity.max_speed)}
                  isDark={isDark}
                />
              </>
            ) : (
              <>
                <StatItem
                  label="Avg Speed"
                  value={formatSpeed(activity.average_speed)}
                  isDark={isDark}
                />
                <StatItem
                  label="Max Speed"
                  value={formatSpeed(activity.max_speed)}
                  isDark={isDark}
                />
              </>
            )}
          </View>
          {(activity.icu_average_hr || activity.average_heartrate || activity.average_watts || activity.icu_average_watts) && (
            <View style={styles.statRow}>
              {(activity.average_heartrate || activity.icu_average_hr) && (
                <StatItem
                  label="Avg HR"
                  value={formatHeartRate(activity.average_heartrate || activity.icu_average_hr!)}
                  isDark={isDark}
                />
              )}
              {(activity.max_heartrate || activity.icu_max_hr) && (
                <StatItem
                  label="Max HR"
                  value={formatHeartRate(activity.max_heartrate || activity.icu_max_hr!)}
                  isDark={isDark}
                />
              )}
              {(activity.average_watts || activity.icu_average_watts) && (
                <StatItem
                  label="Avg Power"
                  value={formatPower(activity.average_watts || activity.icu_average_watts!)}
                  isDark={isDark}
                />
              )}
              {activity.max_watts && (
                <StatItem
                  label="Max Power"
                  value={formatPower(activity.max_watts)}
                  isDark={isDark}
                />
              )}
            </View>
          )}
          {activity.average_cadence && (
            <View style={styles.statRow}>
              <StatItem
                label="Avg Cadence"
                value={`${Math.round(activity.average_cadence)} ${showPace ? 'spm' : 'rpm'}`}
                isDark={isDark}
              />
              {activity.calories && (
                <StatItem
                  label="Calories"
                  value={`${Math.round(activity.calories)} kcal`}
                  isDark={isDark}
                />
              )}
            </View>
          )}
        </View>

        {/* Time stats */}
        <View style={[styles.statsCard, isDark && styles.cardDark]}>
          <Text style={[styles.sectionTitle, isDark && styles.textLight]}>
            Time
          </Text>
          <View style={styles.statRow}>
            <StatItem
              label="Moving Time"
              value={formatDuration(activity.moving_time)}
              isDark={isDark}
            />
            <StatItem
              label="Elapsed Time"
              value={formatDuration(activity.elapsed_time)}
              isDark={isDark}
            />
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function StatItem({
  label,
  value,
  isDark,
}: {
  label: string;
  value: string;
  isDark: boolean;
}) {
  return (
    <View style={styles.statItem}>
      <Text style={[styles.statValue, isDark && styles.textLight]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
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
    paddingRight: spacing.md,
  },
  headerTitle: {
    flex: 1,
  },
  activityName: {
    ...typography.cardTitle,
    color: colors.textPrimary,
  },
  textLight: {
    color: '#FFFFFF',
  },
  date: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
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
  statsCard: {
    backgroundColor: colors.surface,
    borderRadius: layout.borderRadius,
    padding: layout.cardPadding,
    marginTop: spacing.md,
  },
  cardDark: {
    backgroundColor: '#1E1E1E',
  },
  sectionTitle: {
    ...typography.body,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: spacing.md,
  },
  statRow: {
    flexDirection: 'row',
    marginBottom: spacing.sm,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statValue: {
    ...typography.statsValue,
    color: colors.textPrimary,
  },
  statLabel: {
    ...typography.statsLabel,
    color: colors.textSecondary,
    marginTop: 2,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorText: {
    ...typography.body,
    color: colors.error,
  },
  chartControls: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.md,
  },
  expandButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.sm,
  },
  expandButtonDark: {
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
  },
});
