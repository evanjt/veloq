import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { View, ScrollView, StyleSheet, useColorScheme, TouchableOpacity, Dimensions, Modal, StatusBar } from 'react-native';
import { Text, IconButton, ActivityIndicator } from 'react-native-paper';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useActivity, useActivityStreams, useWellnessForDate } from '@/hooks';
import { ActivityMapView, CombinedPlot, ChartTypeSelector, HRZonesChart, InsightfulStats } from '@/components';
import {
  formatDistance,
  formatDuration,
  formatElevation,
  formatHeartRate,
  formatPower,
  formatSpeed,
  formatPace,
  formatDateTime,
  getActivityColor,
  isRunningActivity,
  decodePolyline,
  convertLatLngTuples,
  getAvailableCharts,
  CHART_CONFIGS,
} from '@/lib';
import { colors, spacing, typography } from '@/theme';
import type { ChartTypeId } from '@/lib/chartConfig';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const MAP_HEIGHT = Math.round(SCREEN_HEIGHT * 0.55); // 55% of screen

export default function ActivityDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const insets = useSafeAreaInsets();

  const { data: activity, isLoading, error } = useActivity(id || '');
  const { data: streams } = useActivityStreams(id || '');

  // Get the activity date for wellness lookup
  const activityDate = activity?.start_date_local?.split('T')[0];
  const { data: activityWellness } = useWellnessForDate(activityDate);

  // Track the selected point index from charts for map highlight
  const [highlightIndex, setHighlightIndex] = useState<number | null>(null);
  // Track whether any chart is being interacted with to disable ScrollView
  const [chartInteracting, setChartInteracting] = useState(false);
  // Track whether 3D map mode is active to disable ScrollView
  const [is3DMapActive, setIs3DMapActive] = useState(false);
  // Track which chart types are selected (multi-select)
  const [selectedCharts, setSelectedCharts] = useState<ChartTypeId[]>([]);
  // Track if charts are expanded (stacked) or combined (overlay)
  const [chartsExpanded, setChartsExpanded] = useState(false);
  // Track if we've initialized the default chart selection
  const [chartsInitialized, setChartsInitialized] = useState(false);
  // Track fullscreen chart mode
  const [isChartFullscreen, setIsChartFullscreen] = useState(false);

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
        if (prev.length === 1) return prev;
        return prev.filter((cid) => cid !== chartId);
      }
      return [...prev, chartId as ChartTypeId];
    });
  }, []);

  // Handle chart point selection
  const handlePointSelect = useCallback((index: number | null) => {
    setHighlightIndex(index);
  }, []);

  // Handle chart interaction state changes
  const handleInteractionChange = useCallback((isInteracting: boolean) => {
    setChartInteracting(isInteracting);
  }, []);

  // Handle 3D map mode changes
  const handle3DModeChange = useCallback((is3D: boolean) => {
    setIs3DMapActive(is3D);
  }, []);

  // Open fullscreen chart with landscape orientation
  const openChartFullscreen = useCallback(async () => {
    setIsChartFullscreen(true);
    await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
  }, []);

  // Close fullscreen chart and restore portrait orientation
  const closeChartFullscreen = useCallback(async () => {
    await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
    setIsChartFullscreen(false);
  }, []);

  // Get coordinates from streams or polyline
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
        <View style={[styles.floatingHeader, { paddingTop: insets.top }]}>
          <IconButton
            icon="arrow-left"
            iconColor="#FFFFFF"
            onPress={() => router.back()}
          />
        </View>
        <View style={styles.loadingContainer}>
          <Text style={styles.errorText}>Failed to load activity</Text>
        </View>
      </SafeAreaView>
    );
  }

  const activityColor = getActivityColor(activity.type);
  const showPace = isRunningActivity(activity.type);

  return (
    <View style={[styles.container, isDark && styles.containerDark]}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        scrollEnabled={!chartInteracting && !is3DMapActive}
      >
        {/* Hero Map Section */}
        <View style={styles.heroSection}>
          {/* Map - full bleed */}
          <View style={styles.mapContainer}>
            <ActivityMapView
              coordinates={coordinates}
              polyline={activity.polyline}
              activityType={activity.type}
              height={MAP_HEIGHT}
              showStyleToggle={true}
              highlightIndex={highlightIndex}
              enableFullscreen={true}
              on3DModeChange={handle3DModeChange}
            />
          </View>

          {/* Gradient overlay at bottom */}
          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.7)']}
            style={styles.mapGradient}
            pointerEvents="none"
          />

          {/* Floating header - just back button */}
          <View style={[styles.floatingHeader, { paddingTop: insets.top }]}>
            <TouchableOpacity
              style={styles.backButton}
              onPress={() => router.back()}
              activeOpacity={0.7}
            >
              <MaterialCommunityIcons name="arrow-left" size={24} color="#FFFFFF" />
            </TouchableOpacity>
          </View>

          {/* Activity info overlay at bottom */}
          <View style={styles.infoOverlay}>
            <Text style={styles.activityName} numberOfLines={1}>
              {activity.name}
            </Text>

            {/* Date and inline stats */}
            <View style={styles.metaRow}>
              <Text style={styles.activityDate}>
                {formatDateTime(activity.start_date_local)}
              </Text>
              <View style={styles.inlineStats}>
                <Text style={styles.inlineStat}>{formatDistance(activity.distance)}</Text>
                <Text style={styles.inlineStatDivider}>·</Text>
                <Text style={styles.inlineStat}>{formatDuration(activity.moving_time)}</Text>
                <Text style={styles.inlineStatDivider}>·</Text>
                <Text style={styles.inlineStat}>{formatElevation(activity.total_elevation_gain)}</Text>
              </View>
            </View>
          </View>
        </View>

        {/* Chart Section */}
        {availableCharts.length > 0 && (
          <View style={styles.chartSection}>
            <View style={styles.chartControls}>
              <TouchableOpacity
                style={[styles.expandButton, isDark && styles.expandButtonDark]}
                onPress={() => setChartsExpanded(!chartsExpanded)}
                activeOpacity={0.7}
              >
                <MaterialCommunityIcons
                  name={chartsExpanded ? 'view-stream' : 'chart-multiple'}
                  size={12}
                  color={isDark ? '#FFF' : '#333'}
                />
              </TouchableOpacity>
              <ChartTypeSelector
                available={availableCharts}
                selected={selectedCharts}
                onToggle={handleChartToggle}
              />
              <TouchableOpacity
                style={[styles.fullscreenButton, isDark && styles.expandButtonDark]}
                onPress={openChartFullscreen}
                activeOpacity={0.7}
              >
                <MaterialCommunityIcons
                  name="fullscreen"
                  size={16}
                  color={isDark ? '#FFF' : '#333'}
                />
              </TouchableOpacity>
            </View>

            {/* Charts - consistent height for both views */}
            {streams && selectedCharts.length > 0 && (
              chartsExpanded ? (
                // Expanded view - stacked individual charts
                selectedCharts.map((chartId) => {
                  const config = CHART_CONFIGS[chartId];
                  if (!config) return null;
                  const chartData = config.getStream(streams);
                  if (!chartData || chartData.length === 0) return null;

                  return (
                    <View key={chartId} style={[styles.chartCard, isDark && styles.cardDark]}>
                      <CombinedPlot
                        streams={streams}
                        selectedCharts={[chartId]}
                        chartConfigs={CHART_CONFIGS}
                        height={180}
                        onPointSelect={handlePointSelect}
                        onInteractionChange={handleInteractionChange}
                      />
                    </View>
                  );
                })
              ) : (
                // Combined view - overlay chart
                <View style={[styles.chartCard, isDark && styles.cardDark]}>
                  <CombinedPlot
                    streams={streams}
                    selectedCharts={selectedCharts}
                    chartConfigs={CHART_CONFIGS}
                    height={180}
                    onPointSelect={handlePointSelect}
                    onInteractionChange={handleInteractionChange}
                  />
                </View>
              )
            )}

            {/* Compact Stats Row - averages */}
            <View style={[styles.compactStats, isDark && styles.cardDark]}>
              {showPace ? (
                <CompactStat
                  label="Avg Pace"
                  value={formatPace(activity.average_speed)}
                  isDark={isDark}
                />
              ) : (
                <CompactStat
                  label="Avg Speed"
                  value={formatSpeed(activity.average_speed)}
                  isDark={isDark}
                />
              )}
              {(activity.average_heartrate || activity.icu_average_hr) && (
                <CompactStat
                  label="Avg HR"
                  value={formatHeartRate(activity.average_heartrate || activity.icu_average_hr!)}
                  isDark={isDark}
                  color="#E91E63"
                />
              )}
              {(activity.average_watts || activity.icu_average_watts) && (
                <CompactStat
                  label="Avg Power"
                  value={formatPower(activity.average_watts || activity.icu_average_watts!)}
                  isDark={isDark}
                  color="#9C27B0"
                />
              )}
              {activity.average_cadence && (
                <CompactStat
                  label="Cadence"
                  value={`${Math.round(activity.average_cadence)}`}
                  isDark={isDark}
                />
              )}
            </View>

            {/* HR Zones Chart - show if heart rate data available */}
            {streams?.heartrate && streams.heartrate.length > 0 && (
              <View style={[styles.chartCard, isDark && styles.cardDark]}>
                <HRZonesChart
                  streams={streams}
                  activityType={activity.type}
                  activity={activity}
                />
              </View>
            )}
          </View>
        )}

        {/* Insightful Stats - Interactive stats with context and explanations */}
        <InsightfulStats activity={activity} wellness={activityWellness} />

        {/* Device attribution */}
        {activity.device_name && (
          <View style={styles.deviceAttribution}>
            <MaterialCommunityIcons
              name="watch"
              size={14}
              color={isDark ? '#666' : colors.textSecondary}
            />
            <Text style={[styles.deviceText, isDark && styles.deviceTextDark]}>
              {activity.device_name}
            </Text>
          </View>
        )}
      </ScrollView>

      {/* Fullscreen Chart Modal - Landscape */}
      <Modal
        visible={isChartFullscreen}
        animationType="fade"
        statusBarTranslucent
        onRequestClose={closeChartFullscreen}
      >
        <StatusBar hidden />
        <View style={[styles.fullscreenContainer, isDark && styles.fullscreenContainerDark]}>
          <TouchableOpacity
            style={styles.fullscreenCloseButton}
            onPress={closeChartFullscreen}
            activeOpacity={0.7}
          >
            <MaterialCommunityIcons name="close" size={24} color="#FFF" />
          </TouchableOpacity>
          {streams && selectedCharts.length > 0 && (
            <View style={styles.fullscreenChartWrapper}>
              <CombinedPlot
                streams={streams}
                selectedCharts={selectedCharts}
                chartConfigs={CHART_CONFIGS}
                height={Dimensions.get('window').width - 60}
                onPointSelect={handlePointSelect}
                onInteractionChange={handleInteractionChange}
              />
            </View>
          )}
        </View>
      </Modal>
    </View>
  );
}

// Compact inline stat
function CompactStat({
  label,
  value,
  isDark,
  color,
}: {
  label: string;
  value: string;
  isDark: boolean;
  color?: string;
}) {
  return (
    <View style={styles.compactStatItem}>
      <Text style={[styles.compactStatValue, isDark && styles.textLight, color && { color }]}>
        {value}
      </Text>
      <Text style={styles.compactStatLabel}>{label}</Text>
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
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: spacing.xl,
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

  // Hero section
  heroSection: {
    height: MAP_HEIGHT,
    position: 'relative',
  },
  mapContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  mapGradient: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 160,
  },

  // Floating header
  floatingHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    zIndex: 10,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Info overlay at bottom of map
  infoOverlay: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    bottom: spacing.md,
    zIndex: 5,
  },
  activityName: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FFFFFF',
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  activityDate: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.85)',
  },
  inlineStats: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  inlineStat: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FFFFFF',
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  inlineStatDivider: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.5)',
    marginHorizontal: 6,
  },

  // Chart section
  chartSection: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  chartControls: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  expandButton: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.08)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 6,
  },
  expandButtonDark: {
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
  },
  chartCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.xs,
    paddingBottom: spacing.sm,
    marginBottom: spacing.sm,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  cardDark: {
    backgroundColor: '#1E1E1E',
  },
  textLight: {
    color: '#FFFFFF',
  },

  // Compact stats
  compactStats: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    backgroundColor: colors.surface,
    marginBottom: spacing.sm,
    borderRadius: 16,
    paddingVertical: spacing.md,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  compactStatItem: {
    alignItems: 'center',
    flex: 1,
  },
  compactStatValue: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  compactStatLabel: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 2,
  },

  // Device attribution
  deviceAttribution: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: spacing.lg,
    paddingVertical: spacing.sm,
  },
  deviceText: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  deviceTextDark: {
    color: '#666',
  },

  // Fullscreen button
  fullscreenButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(0, 0, 0, 0.08)',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 'auto',
  },

  // Fullscreen chart modal
  fullscreenContainer: {
    flex: 1,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  fullscreenContainerDark: {
    backgroundColor: '#1E1E1E',
  },
  fullscreenCloseButton: {
    position: 'absolute',
    top: spacing.lg,
    right: spacing.lg,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  fullscreenChartWrapper: {
    flex: 1,
    justifyContent: 'center',
  },
});
