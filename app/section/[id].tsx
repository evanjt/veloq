/**
 * Section detail page.
 * Shows a frequently-traveled section with all activities that traverse it.
 */

import React, {
  useMemo,
  useCallback,
  useState,
  useEffect,
  useRef,
} from "react";
import {
  View,
  ScrollView,
  StyleSheet,
  useColorScheme,
  Pressable,
  Dimensions,
  StatusBar,
  TouchableOpacity,
  TextInput,
  Keyboard,
} from "react-native";
import { Text, ActivityIndicator } from "react-native-paper";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, router } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { LinearGradient } from "expo-linear-gradient";
import {
  useActivities,
  useFrequentSections,
  useSectionPerformances,
  useCustomSection,
  type ActivitySectionRecord,
} from "@/hooks";
import { SectionMapView, MiniTraceView } from "@/components/routes";
import { UnifiedPerformanceChart } from "@/components/routes/performance";
import { getGpsTracks } from "@/lib/storage/gpsStorage";

// Lazy load native module to avoid bundler errors
function getRouteEngine() {
  try {
    return require("route-matcher-native").routeEngine;
  } catch {
    return null;
  }
}
import {
  formatDistance,
  formatRelativeDate,
  getActivityIcon,
  getActivityColor,
  formatDuration,
  formatSpeed,
  formatPace,
  isRunningActivity,
} from "@/lib";
import { getGpsTrack } from "@/lib";
import {
  colors,
  darkColors,
  spacing,
  layout,
  typography,
  opacity,
} from "@/theme";
import type {
  Activity,
  ActivityType,
  RoutePoint,
  FrequentSection,
  PerformanceDataPoint,
} from "@/types";

const { height: SCREEN_HEIGHT } = Dimensions.get("window");
const MAP_HEIGHT = Math.round(SCREEN_HEIGHT * 0.45);

// Direction colors - using theme for consistency
const REVERSE_COLOR = colors.reverseDirection;
const SAME_COLOR_DEFAULT = colors.sameDirection;

interface ActivityRowProps {
  activity: Activity;
  isDark: boolean;
  direction?: string;
  /** Activity's trace points for the section */
  activityPoints?: RoutePoint[];
  /** Section polyline for reference */
  sectionPoints?: RoutePoint[];
  isHighlighted?: boolean;
  /** Distance of this activity's section traversal */
  sectionDistance?: number;
  /** Number of laps/traversals (for multi-lap display) */
  lapCount?: number;
  /** Actual section time in seconds (from stream data) */
  actualSectionTime?: number;
  /** Actual section pace in m/s (from stream data) */
  actualSectionPace?: number;
}

function ActivityRow({
  activity,
  isDark,
  direction,
  activityPoints,
  sectionPoints,
  isHighlighted,
  sectionDistance,
  lapCount,
  actualSectionTime,
  actualSectionPace,
}: ActivityRowProps) {
  const handlePress = () => {
    router.push(`/activity/${activity.id}`);
  };

  const isReverse = direction === "reverse";
  const traceColor = isHighlighted
    ? "#00BCD4"
    : isReverse
      ? REVERSE_COLOR
      : "#2196F3";
  const activityColor = getActivityColor(activity.type);

  // Use actual section time/pace if available, otherwise fall back to proportional estimate
  const displayDistance = sectionDistance || activity.distance;
  let sectionTime: number;
  let sectionSpeed: number;

  if (actualSectionTime !== undefined && actualSectionPace !== undefined) {
    // Use actual measured values
    sectionTime = Math.round(actualSectionTime);
    sectionSpeed = actualSectionPace;
  } else {
    // Fall back to proportional estimate
    sectionTime =
      sectionDistance && activity.distance > 0
        ? Math.round(
            activity.moving_time * (sectionDistance / activity.distance),
          )
        : activity.moving_time;
    sectionSpeed = sectionTime > 0 ? displayDistance / sectionTime : 0;
  }

  const showPace = isRunningActivity(activity.type);
  const showLapCount = lapCount !== undefined && lapCount > 1;

  return (
    <Pressable
      onPress={handlePress}
      style={({ pressed }) => [
        styles.activityRow,
        isDark && styles.activityRowDark,
        isHighlighted && styles.activityRowHighlighted,
        pressed && styles.activityRowPressed,
      ]}
    >
      {activityPoints && activityPoints.length > 1 ? (
        <MiniTraceView
          primaryPoints={activityPoints}
          referencePoints={sectionPoints}
          primaryColor={traceColor}
          referenceColor={colors.consensusRoute}
          isHighlighted={isHighlighted}
        />
      ) : (
        <View
          style={[styles.activityIcon, { backgroundColor: traceColor + "20" }]}
        >
          <MaterialCommunityIcons
            name={getActivityIcon(activity.type)}
            size={18}
            color={traceColor}
          />
        </View>
      )}
      <View style={styles.activityInfo}>
        <View style={styles.activityNameRow}>
          <Text
            style={[styles.activityName, isDark && styles.textLight]}
            numberOfLines={1}
          >
            {activity.name}
          </Text>
          {isReverse && (
            <View
              style={[
                styles.directionBadge,
                { backgroundColor: REVERSE_COLOR + "15" },
              ]}
            >
              <MaterialCommunityIcons
                name="swap-horizontal"
                size={10}
                color={REVERSE_COLOR}
              />
            </View>
          )}
          {showLapCount && (
            <View style={[styles.lapBadge, isDark && styles.lapBadgeDark]}>
              <Text
                style={[styles.lapBadgeText, isDark && styles.lapBadgeTextDark]}
              >
                {lapCount}x
              </Text>
            </View>
          )}
        </View>
        <Text style={[styles.activityDate, isDark && styles.textMuted]}>
          {formatRelativeDate(activity.start_date_local)}
        </Text>
      </View>
      <View style={styles.activityStats}>
        <Text style={[styles.activityDistance, isDark && styles.textLight]}>
          {showPace ? formatPace(sectionSpeed) : formatSpeed(sectionSpeed)}
        </Text>
        <Text style={[styles.activityTime, isDark && styles.textMuted]}>
          {formatDuration(sectionTime)}
        </Text>
      </View>
      <MaterialCommunityIcons
        name="chevron-right"
        size={20}
        color={isDark ? "#555" : "#CCC"}
      />
    </Pressable>
  );
}

export default function SectionDetailScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const insets = useSafeAreaInsets();

  const [highlightedActivityId, setHighlightedActivityId] = useState<
    string | null
  >(null);
  const [highlightedActivityPoints, setHighlightedActivityPoints] = useState<
    RoutePoint[] | undefined
  >(undefined);
  const [shadowTrack, setShadowTrack] = useState<
    [number, number][] | undefined
  >(undefined);
  // Activity traces computed from GPS tracks (for custom sections)
  const [computedActivityTraces, setComputedActivityTraces] = useState<
    Record<string, RoutePoint[]>
  >({});

  // State for section renaming
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [customName, setCustomName] = useState<string | null>(null);
  const nameInputRef = useRef<TextInput>(null);

  // Get section from engine (auto-detected) or custom sections storage
  // Custom section IDs start with "custom_" (e.g., "custom_1767268142052_qyfoos8")
  const isCustomId = id?.startsWith("custom_");

  const { sections: allSections } = useFrequentSections({ minVisits: 1 });
  // Pass the full ID - custom sections are stored with the "custom_" prefix
  const { section: customSection } = useCustomSection(
    isCustomId ? id : undefined,
  );

  // Check both sources - custom sections and engine-detected sections
  const section = useMemo(() => {
    // First check engine sections (only if not a custom_ prefixed ID)
    if (!isCustomId) {
      const engineSection = allSections.find((sec) => sec.id === id);
      if (engineSection) return engineSection;
    }

    // Check if it's a custom section and convert to FrequentSection shape
    if (customSection) {
      return {
        id: customSection.id,
        sportType: customSection.sportType,
        polyline: customSection.polyline,
        activityIds: customSection.matches.map((m) => m.activityId),
        activityPortions: customSection.matches.map((m) => ({
          activityId: m.activityId,
          startIndex: m.startIndex,
          endIndex: m.endIndex,
          distanceMeters: m.distanceMeters ?? customSection.distanceMeters,
          direction: m.direction,
        })),
        routeIds: [],
        visitCount: customSection.matches.length,
        distanceMeters: customSection.distanceMeters,
        name: customSection.name,
      } as FrequentSection;
    }

    // Fallback: check engine sections even for custom_ prefixed IDs (shouldn't happen but safe)
    if (isCustomId) {
      const engineSection = allSections.find((sec) => sec.id === id);
      if (engineSection) return engineSection;
    }

    return null;
  }, [allSections, customSection, id, isCustomId]);

  // Merge computed activity traces into the section (for custom sections)
  const sectionWithTraces = useMemo(() => {
    if (!section) return null;

    // For engine sections, activityTraces are pre-computed
    if (section.activityTraces) return section;

    // For custom sections, merge in the computed traces
    if (Object.keys(computedActivityTraces).length > 0) {
      return {
        ...section,
        activityTraces: computedActivityTraces,
      };
    }

    return section;
  }, [section, computedActivityTraces]);

  // For custom sections: load GPS tracks and compute activity traces
  useEffect(() => {
    if (!customSection || !customSection.matches.length) {
      setComputedActivityTraces({});
      return;
    }

    const loadActivityTraces = async () => {
      const activityIds = customSection.matches.map((m) => m.activityId);
      const tracks = await getGpsTracks(activityIds);

      const traces: Record<string, RoutePoint[]> = {};
      for (const match of customSection.matches) {
        const track = tracks.get(match.activityId);
        if (track && track.length > 0) {
          // Extract the portion of the GPS track that matches this section
          const startIdx = Math.max(0, match.startIndex);
          const endIdx = Math.min(track.length - 1, match.endIndex);
          if (endIdx > startIdx) {
            traces[match.activityId] = track
              .slice(startIdx, endIdx + 1)
              .map(([lat, lng]) => ({
                lat,
                lng,
              }));
          }
        }
      }
      setComputedActivityTraces(traces);
    };

    loadActivityTraces();
  }, [customSection]);

  // Load custom section name from Rust engine on mount
  useEffect(() => {
    if (id) {
      const engine = getRouteEngine();
      const name = engine?.getSectionName(id);
      if (name) {
        setCustomName(name);
      }
    }
  }, [id]);

  // Handle starting to edit the section name
  const handleStartEditing = useCallback(() => {
    const currentName = customName || section?.name || "";
    setEditName(currentName);
    setIsEditing(true);
    setTimeout(() => {
      nameInputRef.current?.focus();
    }, 100);
  }, [customName, section?.name]);

  // Handle saving the edited section name
  const handleSaveName = useCallback(() => {
    const trimmedName = editName.trim();
    if (trimmedName && id) {
      const engine = getRouteEngine();
      if (engine) engine.setSectionName(id, trimmedName);
      setCustomName(trimmedName);
    }
    setIsEditing(false);
    Keyboard.dismiss();
  }, [editName, id]);

  // Handle canceling the edit
  const handleCancelEdit = useCallback(() => {
    setIsEditing(false);
    setEditName("");
    Keyboard.dismiss();
  }, []);

  // Load full GPS track when an activity is highlighted (for shadow display)
  useEffect(() => {
    if (!highlightedActivityId) {
      setShadowTrack(undefined);
      return;
    }

    // Load the full GPS track for the highlighted activity
    getGpsTrack(highlightedActivityId)
      .then((track) => {
        if (track && track.length > 0) {
          setShadowTrack(track);
        } else {
          setShadowTrack(undefined);
        }
      })
      .catch(() => {
        setShadowTrack(undefined);
      });
  }, [highlightedActivityId]);

  const handleActivitySelect = useCallback(
    (activityId: string | null, activityPoints?: RoutePoint[]) => {
      setHighlightedActivityId(activityId);
      setHighlightedActivityPoints(activityPoints);
    },
    [],
  );

  // Get date range for fetching activities
  const { oldest, newest } = useMemo(() => {
    if (!section?.activityIds.length)
      return { oldest: undefined, newest: undefined };
    // We need to load all activities in the section
    // Use a wide date range since we'll filter by IDs
    return {
      oldest: "2020-01-01",
      newest: new Date().toISOString().split("T")[0],
    };
  }, [section?.activityIds]);

  const { data: allActivities, isLoading } = useActivities({
    oldest,
    newest,
    includeStats: false,
  });

  // Filter to only activities in this section
  const sectionActivities = useMemo(() => {
    if (!section || !allActivities) return [];
    const idsSet = new Set(section.activityIds);
    const seen = new Set<string>();
    return allActivities.filter((a) => {
      if (!idsSet.has(a.id) || seen.has(a.id)) return false;
      seen.add(a.id);
      return true;
    });
  }, [section, allActivities]);

  // Fetch actual section performance times from activity streams
  const { records: performanceRecords, isLoading: isLoadingRecords } =
    useSectionPerformances(section, sectionActivities);

  // Map of activity portions for direction lookup
  const portionMap = useMemo(() => {
    if (!section?.activityPortions) return new Map();
    return new Map(section.activityPortions.map((p) => [p.activityId, p]));
  }, [section?.activityPortions]);

  // Prepare chart data for UnifiedPerformanceChart
  // Uses actual section times from records when available, otherwise proportional estimate
  const { chartData, minSpeed, maxSpeed, bestIndex, hasReverseRuns } =
    useMemo(() => {
      if (!section)
        return {
          chartData: [],
          minSpeed: 0,
          maxSpeed: 1,
          bestIndex: 0,
          hasReverseRuns: false,
        };

      const dataPoints: (PerformanceDataPoint & { x: number })[] = [];

      // Create a map of records by activity ID for quick lookup
      const recordMap = new Map(
        performanceRecords?.map((r) => [r.activityId, r]) || [],
      );

      // Sort activities by date
      const sortedActivities = [...sectionActivities].sort(
        (a, b) =>
          new Date(a.start_date_local).getTime() -
          new Date(b.start_date_local).getTime(),
      );

      let hasAnyReverse = false;

      for (const activity of sortedActivities) {
        const portion = portionMap.get(activity.id);
        const tracePoints = sectionWithTraces?.activityTraces?.[activity.id];
        const record = recordMap.get(activity.id);

        // Use actual data from record if available, otherwise use proportional estimate
        const sectionDistance =
          record?.sectionDistance ||
          portion?.distanceMeters ||
          section.distanceMeters;
        const direction =
          record?.direction ||
          (portion?.direction as "same" | "reverse") ||
          "same";

        if (direction === "reverse") hasAnyReverse = true;

        // Use actual section pace/time from record, or fall back to proportional estimate
        let sectionSpeed: number;
        let sectionTime: number;
        let lapCount = 1;

        if (record) {
          // Use actual measured values from stream data
          sectionSpeed = record.bestPace;
          sectionTime = Math.round(record.bestTime);
          lapCount = record.lapCount;
        } else {
          // Fall back to proportional estimate
          sectionSpeed =
            activity.moving_time > 0
              ? activity.distance / activity.moving_time
              : 0;
          sectionTime =
            activity.distance > 0
              ? Math.round(
                  activity.moving_time * (sectionDistance / activity.distance),
                )
              : 0;
        }

        dataPoints.push({
          x: 0,
          id: activity.id,
          activityId: activity.id,
          speed: sectionSpeed,
          date: new Date(activity.start_date_local),
          activityName: activity.name,
          direction,
          lapPoints: tracePoints,
          sectionTime,
          sectionDistance,
          lapCount,
        });
      }

      const indexed = dataPoints.map((d, idx) => ({ ...d, x: idx }));

      const speeds = indexed.map((d) => d.speed);
      const min = speeds.length > 0 ? Math.min(...speeds) : 0;
      const max = speeds.length > 0 ? Math.max(...speeds) : 1;
      const padding = (max - min) * 0.15 || 0.5;

      let bestIdx = 0;
      for (let i = 1; i < indexed.length; i++) {
        if (indexed[i].speed > indexed[bestIdx].speed) {
          bestIdx = i;
        }
      }

      return {
        chartData: indexed,
        minSpeed: Math.max(0, min - padding),
        maxSpeed: max + padding,
        bestIndex: bestIdx,
        hasReverseRuns: hasAnyReverse,
      };
    }, [
      section,
      sectionWithTraces,
      sectionActivities,
      performanceRecords,
      portionMap,
    ]);

  if (!section) {
    return (
      <View style={[styles.container, isDark && styles.containerDark]}>
        <View style={[styles.floatingHeader, { paddingTop: insets.top }]}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => router.back()}
            activeOpacity={0.7}
          >
            <MaterialCommunityIcons
              name="arrow-left"
              size={24}
              color={isDark ? "#FFFFFF" : colors.textPrimary}
            />
          </TouchableOpacity>
        </View>
        <View style={styles.emptyContainer}>
          <MaterialCommunityIcons
            name="map-marker-question-outline"
            size={48}
            color={isDark ? "#444" : "#CCC"}
          />
          <Text style={[styles.emptyText, isDark && styles.textLight]}>
            {t("sections.sectionNotFound")}
          </Text>
        </View>
      </View>
    );
  }

  const activityColor = getActivityColor(section.sportType as ActivityType);
  const iconName = getActivityIcon(section.sportType as ActivityType);

  return (
    <View style={[styles.container, isDark && styles.containerDark]}>
      <StatusBar barStyle="light-content" />
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero Map Section */}
        <View style={styles.heroSection}>
          <View style={styles.mapContainer}>
            <SectionMapView
              section={section}
              height={MAP_HEIGHT}
              interactive={false}
              enableFullscreen={true}
              shadowTrack={shadowTrack}
              highlightedActivityId={highlightedActivityId}
              highlightedLapPoints={highlightedActivityPoints}
            />
          </View>

          <LinearGradient
            colors={["transparent", "rgba(0,0,0,0.7)"]}
            style={styles.mapGradient}
            pointerEvents="none"
          />

          <View style={[styles.floatingHeader, { paddingTop: insets.top }]}>
            <TouchableOpacity
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

          <View style={styles.infoOverlay}>
            <View style={styles.sectionNameRow}>
              <View
                style={[styles.typeIcon, { backgroundColor: activityColor }]}
              >
                <MaterialCommunityIcons
                  name={iconName}
                  size={16}
                  color="#FFFFFF"
                />
              </View>
              {isEditing ? (
                <View style={styles.editNameContainer}>
                  <TextInput
                    ref={nameInputRef}
                    style={styles.editNameInput}
                    value={editName}
                    onChangeText={setEditName}
                    onSubmitEditing={handleSaveName}
                    placeholder={t("sections.sectionNamePlaceholder")}
                    placeholderTextColor="rgba(255,255,255,0.5)"
                    returnKeyType="done"
                    autoFocus
                    selectTextOnFocus
                  />
                  <TouchableOpacity
                    onPress={handleSaveName}
                    style={styles.editNameButton}
                  >
                    <MaterialCommunityIcons
                      name="check"
                      size={20}
                      color="#4CAF50"
                    />
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={handleCancelEdit}
                    style={styles.editNameButton}
                  >
                    <MaterialCommunityIcons
                      name="close"
                      size={20}
                      color="#FF5252"
                    />
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity
                  onPress={handleStartEditing}
                  style={styles.nameEditTouchable}
                  activeOpacity={0.7}
                >
                  <Text style={styles.heroSectionName} numberOfLines={1}>
                    {customName ||
                      section.name ||
                      `Section ${section.id.split("_").pop()}`}
                  </Text>
                  <MaterialCommunityIcons
                    name="pencil"
                    size={14}
                    color="rgba(255,255,255,0.6)"
                    style={styles.editIcon}
                  />
                </TouchableOpacity>
              )}
            </View>

            <View style={styles.heroStatsRow}>
              <Text style={styles.heroStat}>
                {formatDistance(section.distanceMeters)}
              </Text>
              <Text style={styles.heroStatDivider}>·</Text>
              <Text style={styles.heroStat}>
                {section.visitCount} {t("sections.traversals")}
              </Text>
              <Text style={styles.heroStatDivider}>·</Text>
              <Text style={styles.heroStat}>
                {section.routeIds.length} {t("sections.routesCount")}
              </Text>
            </View>
          </View>
        </View>

        {/* Content below hero */}
        <View style={styles.contentSection}>
          {/* Performance chart */}
          {chartData.length >= 2 && (
            <View style={styles.chartSection}>
              <UnifiedPerformanceChart
                chartData={chartData}
                activityType={section.sportType as ActivityType}
                isDark={isDark}
                minSpeed={minSpeed}
                maxSpeed={maxSpeed}
                bestIndex={bestIndex}
                hasReverseRuns={hasReverseRuns}
                tooltipBadgeType="time"
                onActivitySelect={handleActivitySelect}
                selectedActivityId={highlightedActivityId}
              />
            </View>
          )}

          {/* Activities list */}
          <View style={styles.activitiesSection}>
            <Text style={[styles.sectionTitle, isDark && styles.textLight]}>
              {t("sections.activities")}
            </Text>

            {isLoading ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="small" color={colors.primary} />
              </View>
            ) : sectionActivities.length === 0 ? (
              <Text
                style={[styles.emptyActivities, isDark && styles.textMuted]}
              >
                {t("sections.noActivitiesFound")}
              </Text>
            ) : (
              <View
                style={[
                  styles.activitiesCard,
                  isDark && styles.activitiesCardDark,
                ]}
              >
                {sectionActivities.map((activity, index) => {
                  const portion = portionMap.get(activity.id);
                  const tracePoints =
                    sectionWithTraces?.activityTraces?.[activity.id];
                  const isHighlighted = highlightedActivityId === activity.id;
                  // Look up actual performance record for this activity
                  const record = performanceRecords?.find(
                    (r: ActivitySectionRecord) => r.activityId === activity.id,
                  );

                  return (
                    <React.Fragment key={activity.id}>
                      <Pressable
                        onPressIn={() => setHighlightedActivityId(activity.id)}
                        onPressOut={() => setHighlightedActivityId(null)}
                      >
                        <ActivityRow
                          activity={activity}
                          isDark={isDark}
                          direction={record?.direction || portion?.direction}
                          activityPoints={tracePoints}
                          sectionPoints={section.polyline}
                          isHighlighted={isHighlighted}
                          sectionDistance={
                            record?.sectionDistance || portion?.distanceMeters
                          }
                          lapCount={record?.lapCount}
                          actualSectionTime={record?.bestTime}
                          actualSectionPace={record?.bestPace}
                        />
                      </Pressable>
                      {index < sectionActivities.length - 1 && (
                        <View
                          style={[styles.divider, isDark && styles.dividerDark]}
                        />
                      )}
                    </React.Fragment>
                  );
                })}
              </View>
            )}
          </View>
        </View>
      </ScrollView>
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
  textLight: {
    color: colors.textOnDark,
  },
  textMuted: {
    color: darkColors.textSecondary,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: spacing.xl,
  },
  heroSection: {
    height: MAP_HEIGHT,
    position: "relative",
  },
  mapContainer: {
    flex: 1,
  },
  mapGradient: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: 120,
  },
  floatingHeader: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.sm,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(0, 0, 0, 0.4)",
    justifyContent: "center",
    alignItems: "center",
  },
  infoOverlay: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
  },
  sectionNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  typeIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    justifyContent: "center",
    alignItems: "center",
  },
  heroSectionName: {
    flex: 1,
    fontSize: typography.statsValue.fontSize,
    fontWeight: "700",
    color: colors.textOnDark,
    textShadowColor: "rgba(0, 0, 0, 0.5)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  nameEditTouchable: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  editIcon: {
    marginLeft: 4,
  },
  editNameContainer: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(0, 0, 0, 0.4)",
    borderRadius: 8,
    paddingHorizontal: spacing.sm,
    gap: spacing.xs,
  },
  editNameInput: {
    flex: 1,
    fontSize: typography.cardTitle.fontSize,
    fontWeight: "600",
    color: colors.textOnDark,
    paddingVertical: spacing.sm,
  },
  editNameButton: {
    padding: 6,
    borderRadius: 6,
    backgroundColor: "rgba(255, 255, 255, 0.15)",
  },
  heroStatsRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 6,
    flexWrap: "wrap",
  },
  heroStat: {
    fontSize: typography.bodySmall.fontSize,
    color: "rgba(255, 255, 255, 0.9)",
    textShadowColor: "rgba(0, 0, 0, 0.5)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  heroStatDivider: {
    fontSize: typography.bodySmall.fontSize,
    color: "rgba(255, 255, 255, 0.5)",
    marginHorizontal: spacing.xs,
  },
  contentSection: {
    padding: layout.screenPadding,
    paddingTop: spacing.lg,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  emptyText: {
    fontSize: typography.body.fontSize,
    color: colors.textPrimary,
    marginTop: spacing.md,
  },
  chartSection: {
    marginBottom: spacing.lg,
  },
  activitiesSection: {
    marginBottom: spacing.xl,
  },
  sectionTitle: {
    fontSize: typography.body.fontSize,
    fontWeight: "600",
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  loadingContainer: {
    padding: spacing.xl,
    alignItems: "center",
  },
  emptyActivities: {
    fontSize: typography.bodySmall.fontSize,
    color: colors.textSecondary,
    textAlign: "center",
    paddingVertical: spacing.lg,
  },
  activitiesCard: {
    backgroundColor: colors.surface,
    borderRadius: layout.borderRadius,
    overflow: "hidden",
  },
  activitiesCardDark: {
    backgroundColor: darkColors.surface,
  },
  activityRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.md,
    gap: spacing.md,
  },
  activityRowDark: {},
  activityRowHighlighted: {
    backgroundColor: "rgba(0, 188, 212, 0.1)",
  },
  activityRowPressed: {
    opacity: 0.7,
  },
  activityIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
  },
  activityInfo: {
    flex: 1,
  },
  activityNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  activityName: {
    fontSize: typography.bodySmall.fontSize + 1,
    fontWeight: "500",
    color: colors.textPrimary,
    flex: 1,
  },
  directionBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: layout.borderRadiusSm,
    gap: 2,
  },
  lapBadge: {
    backgroundColor: colors.primary + "15",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: layout.borderRadiusSm,
    marginLeft: 4,
  },
  lapBadgeDark: {
    backgroundColor: colors.primary + "25",
  },
  lapBadgeText: {
    fontSize: 10,
    fontWeight: "600",
    color: colors.primary,
  },
  lapBadgeTextDark: {
    color: colors.primaryLight,
  },
  activityDate: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
  },
  activityStats: {
    alignItems: "flex-end",
  },
  activityDistance: {
    fontSize: typography.bodySmall.fontSize,
    fontWeight: "600",
    color: colors.textPrimary,
  },
  activityTime: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
  },
  divider: {
    height: 1,
    backgroundColor: opacity.overlay.light,
    marginLeft: 36 + spacing.md + spacing.md,
  },
  dividerDark: {
    backgroundColor: opacity.overlayDark.light,
  },
});
