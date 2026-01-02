import React, { useState, useCallback, useMemo, useEffect } from "react";
import {
  View,
  ScrollView,
  StyleSheet,
  useColorScheme,
  TouchableOpacity,
  Dimensions,
  Modal,
  StatusBar,
  useWindowDimensions,
  Alert,
} from "react-native";
import { Text, IconButton, ActivityIndicator } from "react-native-paper";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { useLocalSearchParams, router, type Href } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useTranslation } from "react-i18next";
import * as ScreenOrientation from "expo-screen-orientation";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { useActivity, useActivityStreams, useWellnessForDate } from "@/hooks";
import { useCustomSections } from "@/hooks/routes/useCustomSections";
import { useRouteMatch } from "@/hooks/routes/useRouteMatch";
import {
  useSectionMatches,
  type SectionMatch,
} from "@/hooks/routes/useSectionMatches";
import {
  ActivityMapView,
  CombinedPlot,
  ChartTypeSelector,
  HRZonesChart,
  InsightfulStats,
  RoutePerformanceSection,
} from "@/components";
import { SwipeableTabs, type SwipeableTab } from "@/components/ui";
import type { SectionCreationResult } from "@/components/maps/ActivityMapView";
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
} from "@/lib";
import {
  colors,
  darkColors,
  spacing,
  typography,
  layout,
  opacity,
} from "@/theme";
import { DeviceAttribution, ComponentErrorBoundary } from "@/components/ui";
import type { ChartTypeId } from "@/lib";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");
const MAP_HEIGHT = Math.round(SCREEN_HEIGHT * 0.42); // 42% of screen - better data visibility

export default function ActivityDetailScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const insets = useSafeAreaInsets();
  // Use dynamic dimensions for fullscreen chart (updates after rotation)
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();

  const { data: activity, isLoading, error } = useActivity(id || "");
  const { data: streams } = useActivityStreams(id || "");

  // Get the activity date for wellness lookup
  const activityDate = activity?.start_date_local?.split("T")[0];
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

  // Section creation mode
  const [sectionCreationMode, setSectionCreationMode] = useState(false);
  const { createSection, sections } = useCustomSections();

  // Tab state for swipeable tabs
  type TabType = "charts" | "routes" | "sections";
  const [activeTab, setActiveTab] = useState<TabType>("charts");

  // Get matched route for this activity
  const { routeGroup: matchedRoute } = useRouteMatch(id);
  const matchedRouteCount = matchedRoute ? 1 : 0;

  // Get auto-detected sections from engine that include this activity
  const { sections: engineSectionMatches, count: engineSectionCount } =
    useSectionMatches(id);

  // Filter custom sections that match this activity
  const customMatchedSections = useMemo(() => {
    if (!id) return [];
    return sections.filter((section) =>
      section.matches.some((match) => match.activityId === id),
    );
  }, [sections, id]);

  // Total section count (auto-detected + custom)
  const totalSectionCount = engineSectionCount + customMatchedSections.length;

  // Tabs configuration
  const tabs = useMemo<SwipeableTab[]>(
    () => [
      {
        key: "charts",
        label: t("activityDetail.tabs.charts"),
        icon: "chart-line",
      },
      {
        key: "routes",
        label: t("activityDetail.tabs.routes"),
        icon: "map-marker-path",
        count: matchedRouteCount,
      },
      {
        key: "sections",
        label: t("activityDetail.tabs.sections"),
        icon: "road-variant",
        count: totalSectionCount,
      },
    ],
    [t, matchedRouteCount, totalSectionCount],
  );

  // Chart presets by activity type
  const CHART_PRESETS: Record<string, ChartTypeId[]> = {
    Ride: ["power", "heartrate", "cadence", "speed"],
    VirtualRide: ["power", "heartrate", "cadence", "speed"],
    MountainBikeRide: ["power", "heartrate", "cadence", "elevation"],
    GravelRide: ["power", "heartrate", "cadence", "speed"],
    EBikeRide: ["power", "heartrate", "cadence", "speed"],
    Run: ["pace", "heartrate", "cadence", "elevation"],
    VirtualRun: ["pace", "heartrate", "cadence"],
    TrailRun: ["pace", "heartrate", "elevation"],
    Swim: ["pace", "heartrate", "speed"],
    OpenWaterSwim: ["pace", "heartrate"],
    Walk: ["speed", "heartrate", "elevation"],
    Hike: ["speed", "heartrate", "elevation"],
    Workout: ["heartrate", "power"],
    WeightTraining: ["heartrate"],
    Yoga: ["heartrate"],
    Rowing: ["power", "heartrate", "cadence"],
    Kayaking: ["speed", "heartrate"],
    Canoeing: ["speed", "heartrate"],
  };

  // Get available chart types based on stream data
  const availableCharts = useMemo(() => {
    return getAvailableCharts(streams);
  }, [streams]);

  // Initialize selected charts with smart presets when data loads
  useEffect(() => {
    if (!chartsInitialized && availableCharts.length > 0 && activity) {
      // Get preset for this activity type
      const preset = CHART_PRESETS[activity.type];
      if (preset) {
        // Filter preset to only include charts that are available
        const validPreset = preset.filter((id) =>
          availableCharts.some((c) => c.id === id),
        );
        // Use preset if at least one chart is available, otherwise fallback to first available
        const initialCharts =
          validPreset.length > 0 ? validPreset : [availableCharts[0].id];
        setSelectedCharts(initialCharts);
      } else {
        // No preset for this activity type, use first available
        setSelectedCharts([availableCharts[0].id]);
      }
      setChartsInitialized(true);
    }
  }, [availableCharts, chartsInitialized, activity]);

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
    await ScreenOrientation.lockAsync(
      ScreenOrientation.OrientationLock.LANDSCAPE,
    );
  }, []);

  // Close fullscreen chart and restore portrait orientation
  const closeChartFullscreen = useCallback(async () => {
    await ScreenOrientation.lockAsync(
      ScreenOrientation.OrientationLock.PORTRAIT_UP,
    );
    setIsChartFullscreen(false);
  }, []);

  // Handle section creation completion
  const handleSectionCreated = useCallback(
    async (result: SectionCreationResult) => {
      if (!activity) return;
      setSectionCreationMode(false);

      try {
        await createSection({
          polyline: result.polyline,
          startIndex: result.startIndex,
          endIndex: result.endIndex,
          sourceActivityId: activity.id,
          sportType: activity.type,
          distanceMeters: result.distanceMeters,
        });
        Alert.alert(
          t("routes.sectionCreated"),
          t("routes.sectionCreatedDescription"),
        );
      } catch (error) {
        Alert.alert(t("common.error"), t("routes.sectionCreationFailed"));
      }
    },
    [activity, createSection, t],
  );

  // Handle section creation cancellation
  const handleSectionCreationCancelled = useCallback(() => {
    setSectionCreationMode(false);
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
          <Text style={styles.errorText}>
            {t("activityDetail.failedToLoad")}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const activityColor = getActivityColor(activity.type);
  const showPace = isRunningActivity(activity.type);

  return (
    <View
      testID="activity-detail-screen"
      style={[styles.container, isDark && styles.containerDark]}
    >
      {/* Hero Map Section - fixed at top */}
      <View style={styles.heroSection}>
        {/* Map - full bleed */}
        <View style={styles.mapContainer}>
          <ActivityMapView
            coordinates={coordinates}
            polyline={activity.polyline}
            activityType={activity.type}
            height={MAP_HEIGHT}
            showStyleToggle={!sectionCreationMode}
            highlightIndex={highlightIndex}
            enableFullscreen={!sectionCreationMode}
            on3DModeChange={handle3DModeChange}
            creationMode={sectionCreationMode}
            onSectionCreated={handleSectionCreated}
            onCreationCancelled={handleSectionCreationCancelled}
          />
        </View>

        {/* Gradient overlay at bottom */}
        <LinearGradient
          colors={["transparent", "rgba(0,0,0,0.7)"]}
          style={styles.mapGradient}
          pointerEvents="none"
        />

        {/* Floating header - just back button */}
        <View style={[styles.floatingHeader, { paddingTop: insets.top }]}>
          <TouchableOpacity
            testID="activity-detail-back"
            style={styles.backButton}
            onPress={() => router.back()}
            activeOpacity={0.7}
          >
            <MaterialCommunityIcons
              name="arrow-left"
              size={24}
              color="#FFFFFF"
            />
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
              <Text style={styles.inlineStat}>
                {formatDistance(activity.distance)}
              </Text>
              <Text style={styles.inlineStatDivider}>·</Text>
              <Text style={styles.inlineStat}>
                {formatDuration(activity.moving_time)}
              </Text>
              <Text style={styles.inlineStatDivider}>·</Text>
              <Text style={styles.inlineStat}>
                {formatElevation(activity.total_elevation_gain)}
              </Text>
            </View>
          </View>
        </View>
      </View>

      {/* Swipeable Tabs: Charts, Routes, Sections */}
      <SwipeableTabs
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={(key) => setActiveTab(key as TabType)}
        isDark={isDark}
      >
        {/* Tab 1: Charts */}
        <ScrollView
          style={styles.tabScrollView}
          contentContainerStyle={styles.tabScrollContent}
          showsVerticalScrollIndicator={false}
          scrollEnabled={!chartInteracting}
        >
          {availableCharts.length > 0 && (
            <View style={styles.chartSection}>
              <View style={styles.chartControls}>
                <TouchableOpacity
                  style={[
                    styles.expandButton,
                    isDark && styles.expandButtonDark,
                  ]}
                  onPress={() => setChartsExpanded(!chartsExpanded)}
                  activeOpacity={0.7}
                  accessibilityLabel="Chart display options"
                  accessibilityRole="button"
                >
                  <MaterialCommunityIcons
                    name="cog"
                    size={20}
                    color={isDark ? "#FFF" : "#333"}
                  />
                </TouchableOpacity>
                <View style={styles.chartSelectorContainer}>
                  <ChartTypeSelector
                    available={availableCharts}
                    selected={selectedCharts}
                    onToggle={handleChartToggle}
                  />
                </View>
                <TouchableOpacity
                  style={[
                    styles.fullscreenButton,
                    isDark && styles.expandButtonDark,
                  ]}
                  onPress={openChartFullscreen}
                  activeOpacity={0.7}
                  accessibilityLabel="Fullscreen chart"
                  accessibilityRole="button"
                >
                  <MaterialCommunityIcons
                    name="fullscreen"
                    size={20}
                    color={isDark ? "#FFF" : "#333"}
                  />
                </TouchableOpacity>
              </View>

              {/* Charts - consistent height for both views */}
              {streams &&
                selectedCharts.length > 0 &&
                (chartsExpanded ? (
                  // Expanded view - stacked individual charts
                  selectedCharts.map((chartId) => {
                    const config = CHART_CONFIGS[chartId];
                    if (!config) return null;
                    const chartData = config.getStream(streams);
                    if (!chartData || chartData.length === 0) return null;

                    return (
                      <View
                        key={chartId}
                        style={[styles.chartCard, isDark && styles.cardDark]}
                      >
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
                ))}

              {/* Compact Stats Row - averages */}
              <View style={[styles.compactStats, isDark && styles.cardDark]}>
                {showPace ? (
                  <CompactStat
                    label={t("activityDetail.avgPace")}
                    value={formatPace(activity.average_speed)}
                    isDark={isDark}
                  />
                ) : (
                  <CompactStat
                    label={t("activityDetail.avgSpeed")}
                    value={formatSpeed(activity.average_speed)}
                    isDark={isDark}
                  />
                )}
                {(activity.average_heartrate || activity.icu_average_hr) && (
                  <CompactStat
                    label={t("activityDetail.avgHR")}
                    value={formatHeartRate(
                      activity.average_heartrate || activity.icu_average_hr!,
                    )}
                    isDark={isDark}
                    color="#E91E63"
                  />
                )}
                {(activity.average_watts || activity.icu_average_watts) && (
                  <CompactStat
                    label={t("activityDetail.avgPower")}
                    value={formatPower(
                      activity.average_watts || activity.icu_average_watts!,
                    )}
                    isDark={isDark}
                    color="#9C27B0"
                  />
                )}
                {activity.average_cadence && (
                  <CompactStat
                    label={t("activity.cadence")}
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

          {/* Device attribution with Garmin branding when applicable */}
          {activity.device_name && (
            <View style={styles.deviceAttributionContainer}>
              <DeviceAttribution deviceName={activity.device_name} />
            </View>
          )}
        </ScrollView>

        {/* Tab 2: Routes */}
        <ScrollView
          style={styles.tabScrollView}
          contentContainerStyle={styles.tabScrollContent}
          showsVerticalScrollIndicator={false}
        >
          <ComponentErrorBoundary componentName="Route Performance">
            <RoutePerformanceSection
              activityId={activity.id}
              activityType={activity.type}
            />
          </ComponentErrorBoundary>
        </ScrollView>

        {/* Tab 3: Sections */}
        <ScrollView
          style={styles.tabScrollView}
          contentContainerStyle={styles.tabScrollContent}
          showsVerticalScrollIndicator={false}
        >
          {totalSectionCount > 0 ? (
            <>
              {/* Auto-detected sections from engine */}
              {engineSectionMatches.map((match) => (
                <TouchableOpacity
                  key={`engine-${match.section.id}`}
                  style={[styles.sectionCard, isDark && styles.cardDark]}
                  onPress={() =>
                    router.push(`/section/${match.section.id}` as Href)
                  }
                  activeOpacity={0.7}
                >
                  <View style={styles.sectionHeader}>
                    <MaterialCommunityIcons
                      name="road-variant"
                      size={20}
                      color={colors.primary}
                    />
                    <Text
                      style={[styles.sectionName, isDark && styles.textLight]}
                    >
                      {match.section.name || t("routes.autoDetected")}
                    </Text>
                    <View
                      style={[
                        styles.autoDetectedBadge,
                        isDark && styles.autoDetectedBadgeDark,
                      ]}
                    >
                      <Text style={styles.autoDetectedText}>
                        {t("routes.autoDetected")}
                      </Text>
                    </View>
                  </View>
                  <Text
                    style={[styles.sectionMeta, isDark && styles.textMuted]}
                  >
                    {formatDistance(match.distance)} ·{" "}
                    {match.section.visitCount} {t("routes.visits")}
                  </Text>
                </TouchableOpacity>
              ))}

              {/* Custom sections */}
              {customMatchedSections.map((section) => (
                <TouchableOpacity
                  key={`custom-${section.id}`}
                  style={[styles.sectionCard, isDark && styles.cardDark]}
                  onPress={() => router.push(`/section/${section.id}` as Href)}
                  activeOpacity={0.7}
                >
                  <View style={styles.sectionHeader}>
                    <MaterialCommunityIcons
                      name="road-variant"
                      size={20}
                      color={colors.primary}
                    />
                    <Text
                      style={[styles.sectionName, isDark && styles.textLight]}
                    >
                      {section.name}
                    </Text>
                    <View
                      style={[
                        styles.customBadge,
                        isDark && styles.customBadgeDark,
                      ]}
                    >
                      <Text style={styles.customBadgeText}>
                        {t("routes.custom")}
                      </Text>
                    </View>
                  </View>
                  <Text
                    style={[styles.sectionMeta, isDark && styles.textMuted]}
                  >
                    {formatDistance(section.distanceMeters)} ·{" "}
                    {section.matches.length} {t("routes.visits")}
                  </Text>
                </TouchableOpacity>
              ))}
            </>
          ) : (
            <View style={styles.emptyStateContainer}>
              <MaterialCommunityIcons
                name="road-variant"
                size={48}
                color={isDark ? "#444" : "#CCC"}
              />
              <Text
                style={[styles.emptyStateTitle, isDark && styles.textLight]}
              >
                {t("activityDetail.noMatchedSections")}
              </Text>
              <Text
                style={[
                  styles.emptyStateDescription,
                  isDark && styles.textMuted,
                ]}
              >
                {t("activityDetail.noMatchedSectionsDescription")}
              </Text>
            </View>
          )}

          {/* Create Section Button */}
          {coordinates.length > 0 && !sectionCreationMode && (
            <TouchableOpacity
              style={[
                styles.createSectionButton,
                isDark && styles.createSectionButtonDark,
              ]}
              onPress={() => setSectionCreationMode(true)}
              activeOpacity={0.7}
            >
              <MaterialCommunityIcons
                name="plus"
                size={20}
                color={colors.textOnPrimary}
              />
              <Text style={styles.createSectionButtonText}>
                {t("routes.createSection")}
              </Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      </SwipeableTabs>

      {/* Fullscreen Chart Modal - Landscape */}
      <Modal
        visible={isChartFullscreen}
        animationType="fade"
        statusBarTranslucent
        onRequestClose={closeChartFullscreen}
      >
        <GestureHandlerRootView style={{ flex: 1 }}>
          <StatusBar hidden />
          <View
            style={[
              styles.fullscreenContainer,
              isDark && styles.fullscreenContainerDark,
            ]}
          >
            {/* Close button */}
            <TouchableOpacity
              style={styles.fullscreenCloseButton}
              onPress={closeChartFullscreen}
              activeOpacity={0.7}
            >
              <MaterialCommunityIcons
                name="close"
                size={24}
                color={isDark ? "#FFF" : "#333"}
              />
            </TouchableOpacity>

            {/* Chart type selector in fullscreen */}
            <View style={styles.fullscreenControls}>
              <TouchableOpacity
                style={[
                  styles.fullscreenExpandButton,
                  isDark && styles.expandButtonDark,
                ]}
                onPress={() => setChartsExpanded(!chartsExpanded)}
                activeOpacity={0.7}
                accessibilityLabel="Chart options"
                accessibilityRole="button"
              >
                <MaterialCommunityIcons
                  name="cog"
                  size={20}
                  color={isDark ? "#FFF" : "#333"}
                />
              </TouchableOpacity>
              <View style={styles.chartSelectorContainer}>
                <ChartTypeSelector
                  available={availableCharts}
                  selected={selectedCharts}
                  onToggle={handleChartToggle}
                />
              </View>
            </View>

            {/* Chart area - proper landscape sizing */}
            {streams && selectedCharts.length > 0 && (
              <View style={styles.fullscreenChartWrapper}>
                <CombinedPlot
                  streams={streams}
                  selectedCharts={selectedCharts}
                  chartConfigs={CHART_CONFIGS}
                  height={windowHeight - 100}
                  onPointSelect={handlePointSelect}
                  onInteractionChange={handleInteractionChange}
                />
              </View>
            )}
          </View>
        </GestureHandlerRootView>
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
      <Text
        style={[
          styles.compactStatValue,
          isDark && styles.textLight,
          color && { color },
        ]}
      >
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
    backgroundColor: darkColors.background,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: spacing.xl,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  errorText: {
    ...typography.body,
    color: colors.error,
  },

  // Hero section
  heroSection: {
    height: MAP_HEIGHT,
    position: "relative",
  },
  mapContainer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  mapGradient: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 160,
  },

  // Floating header
  floatingHeader: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.sm,
    zIndex: 10,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
  },

  // Info overlay at bottom of map
  infoOverlay: {
    position: "absolute",
    left: spacing.md,
    right: spacing.md,
    bottom: spacing.md,
    zIndex: 5,
  },
  activityName: {
    fontSize: typography.statsValue.fontSize,
    fontWeight: "700",
    color: colors.textOnDark,
    textShadowColor: "rgba(0,0,0,0.6)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing.xs,
  },
  activityDate: {
    fontSize: typography.bodyCompact.fontSize,
    color: "rgba(255,255,255,0.85)",
  },
  inlineStats: {
    flexDirection: "row",
    alignItems: "center",
  },
  inlineStat: {
    fontSize: typography.bodyCompact.fontSize,
    fontWeight: "600",
    color: colors.textOnDark,
    textShadowColor: "rgba(0,0,0,0.5)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  inlineStatDivider: {
    fontSize: typography.bodyCompact.fontSize,
    color: "rgba(255,255,255,0.5)",
    marginHorizontal: 6,
  },

  // Chart section
  chartSection: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  chartControls: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing.sm,
  },
  chartSelectorContainer: {
    flex: 1,
    marginHorizontal: spacing.xs,
  },
  expandButton: {
    width: 44, // Accessibility minimum
    height: 44, // Accessibility minimum
    borderRadius: layout.borderRadius,
    backgroundColor: opacity.overlay.light,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 6,
  },
  expandButtonDark: {
    backgroundColor: opacity.overlayDark.heavy,
  },
  chartCard: {
    backgroundColor: colors.surface,
    borderRadius: layout.cardPadding,
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.xs,
    paddingBottom: spacing.sm,
    marginBottom: spacing.sm,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: spacing.sm,
    elevation: 2,
  },
  cardDark: {
    backgroundColor: darkColors.surface,
  },
  textLight: {
    color: colors.textOnDark,
  },

  // Compact stats
  compactStats: {
    flexDirection: "row",
    justifyContent: "space-around",
    backgroundColor: colors.surface,
    marginBottom: spacing.sm,
    borderRadius: layout.cardPadding,
    paddingVertical: spacing.md,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: spacing.sm,
    elevation: 2,
  },
  compactStatItem: {
    alignItems: "center",
    flex: 1,
  },
  compactStatValue: {
    fontSize: typography.cardTitle.fontSize,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  compactStatLabel: {
    fontSize: typography.label.fontSize,
    color: colors.textSecondary,
    marginTop: 2,
  },

  // Device attribution container
  deviceAttributionContainer: {
    alignItems: "center",
    marginTop: spacing.lg,
    paddingVertical: spacing.sm,
  },

  // Fullscreen button
  fullscreenButton: {
    width: 44, // Accessibility minimum
    height: 44, // Accessibility minimum
    borderRadius: layout.borderRadius,
    backgroundColor: opacity.overlay.light,
    justifyContent: "center",
    alignItems: "center",
    marginLeft: "auto",
  },

  // Fullscreen chart modal
  fullscreenContainer: {
    flex: 1,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  fullscreenContainerDark: {
    backgroundColor: darkColors.surface,
  },
  fullscreenCloseButton: {
    position: "absolute",
    top: spacing.md,
    left: spacing.md,
    width: 44, // Accessibility minimum
    height: 44, // Accessibility minimum
    borderRadius: 22,
    backgroundColor: opacity.overlay.medium,
    justifyContent: "center",
    alignItems: "center",
    zIndex: 10,
  },
  fullscreenControls: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  fullscreenExpandButton: {
    width: 44, // Accessibility minimum
    height: 44, // Accessibility minimum
    borderRadius: layout.borderRadius,
    backgroundColor: opacity.overlay.light,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 6,
  },
  fullscreenChartWrapper: {
    flex: 1,
    justifyContent: "center",
    paddingBottom: spacing.md,
  },
  // Tab content styles
  tabScrollView: {
    flex: 1,
  },
  tabScrollContent: {
    paddingBottom: spacing.xl,
  },

  // Section card styles
  sectionCard: {
    backgroundColor: colors.surface,
    borderRadius: layout.cardPadding,
    padding: spacing.md,
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: spacing.sm,
    elevation: 2,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  sectionName: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.textPrimary,
    flex: 1,
  },
  sectionMeta: {
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: spacing.xs,
    marginLeft: 28,
  },
  textMuted: {
    color: "#888",
  },

  // Empty state styles
  emptyStateContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: spacing.xl * 2,
    paddingHorizontal: spacing.lg,
  },
  emptyStateTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: colors.textPrimary,
    marginTop: spacing.md,
    textAlign: "center",
  },
  emptyStateDescription: {
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: spacing.sm,
    textAlign: "center",
    lineHeight: 20,
  },

  // Create Section button styles
  createSectionButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary,
    borderRadius: 24,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    marginHorizontal: spacing.md,
    marginTop: spacing.lg,
    marginBottom: spacing.md,
    gap: spacing.xs,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
  },
  createSectionButtonDark: {
    backgroundColor: colors.primary,
  },
  createSectionButtonText: {
    color: colors.textOnPrimary,
    fontSize: 15,
    fontWeight: "600",
  },

  // Badge styles for section types
  autoDetectedBadge: {
    backgroundColor: "rgba(76, 175, 80, 0.15)",
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: 4,
  },
  autoDetectedBadgeDark: {
    backgroundColor: "rgba(76, 175, 80, 0.25)",
  },
  autoDetectedText: {
    fontSize: 10,
    fontWeight: "600",
    color: "#4CAF50",
  },
  customBadge: {
    backgroundColor: "rgba(156, 39, 176, 0.15)",
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: 4,
  },
  customBadgeDark: {
    backgroundColor: "rgba(156, 39, 176, 0.25)",
  },
  customBadgeText: {
    fontSize: 10,
    fontWeight: "600",
    color: "#9C27B0",
  },
});
